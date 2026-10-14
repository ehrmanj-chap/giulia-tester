/** Local, conservative language segmentation for voice rendering.
 *  Does not alter the canonical agent transcript or call an external service.
 *  Explicit [[it]], [[ja]], [[en-us]], [[en-gb]] tags override heuristics.
 */
import { speechSegments } from './core.js';

const JP_SCRIPT = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}々ー]/u;
const JP_RUN = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}々ー]+(?:[、。！？]+)?/gu;
const LATIN_WORD = /[\p{Script=Latin}\p{M}]+(?:['’][\p{Script=Latin}\p{M}]+)*/gu;
const TAGS = /\[\[(en-us|en-gb|it|ja)\]\]([\s\S]*?)\[\[\/\1\]\]/gi;
const LIMIT = 260;

const IT_STRONG = new Set(
  'buongiorno buonasera buonanotte buongiornissimo grazie prego arrivederci ciao salve benvenuto benvenuti benvenuta piacere perche perché allora subito certo scusi scusa scusami buongusto buonissimo buongiorno come stai stai parlando buongustaio perfetto ottimo magari davvero bellissimo bellissima buongustaia moltissimo arrivederla signora signore ragazzo ragazza buongiornata buongiorno ragazzi tutte tutti buona buono sera giorno notte bello bella amici amico amica mondo famiglia lavoro viaggiare mangiare mangiamo parlare parliamo italiano italiana italiani italiane italia sì siamo sono abbiamo vorrei posso voglio grazie mille'.split(' ')
);
const IT_GRAMMAR = new Set(
  'il lo la gli le un una uno di da del della dello delle degli al alla alle agli nel nella nello nelle negli per con tra fra sul sulla sui sulle mi ti ci vi ne io tu lui lei noi voi loro questo questa questi queste quello quella quelli quelle che chi cosa quale quando dove quanto mia mio tuoi tua nostro vostra vostra vostro oggi domani ieri bene male molto molti molta molte sempre mai anche ancora invece e oppure oppure ma non sì c è sia era erano sarò sarà andiamo perché come buongiorno suoi degli lui altri altro altra siamo ho hai ha hanno abbiamo siete sto sei sta stanno'
    .split(' ')
);
const EN_STRONG = new Set(
  'the and you your are were they their them this that these those with will would should could have has had hello welcome morning evening thank thanks please speaking speak say says said not only from into about what when where which why how each then also here there something think thought indeed because everybody everyone discuss would please wonderful together however although hello yes no okay okay from of hello we he she it is was his her my our theirs us its if for by after before language words just first second today tomorrow yesterday how much very really in english let lets talking said continuing'
    .split(' ')
);
const IT_SUFFIX = /(?:zione|zioni|mente|issimo|issima|issimi|issime|iamo|iscono|bbero|aggio|aggia|abile|ibile)$/u;

const normalize = text => String(text).toLocaleLowerCase('it').replace(/[’]/g, "'");
export function italianEvidence(word) {
  const value = normalize(word);
  if (!value) return 0;
  if (/[àèéìòù]/u.test(value)) return 8;
  if (IT_STRONG.has(value)) return 7.5;
  if (EN_STRONG.has(value)) return -7;
  if (IT_GRAMMAR.has(value)) return 1.6;
  if (IT_SUFFIX.test(value)) return 2.2;
  return 0;
}
function englishLanguage(fallback) {
  return fallback === 'en-gb' ? 'en-gb' : 'en-us';
}
function scoredLatin(text, fallback) {
  const words = [...text.matchAll(LATIN_WORD)].map(m => ({ word:m[0], pos:m.index }));
  if (!words.length) return text.trim() ? [{text, language:fallback, source:'fallback'}] : [];
  const english=englishLanguage(fallback);
  // Italian vs English Viterbi path with transitions discouraged for lone
  // ambiguous function words. A strong greeting or native orthography wins.
  const initialItalian = fallback === 'it' ? 1.2 : -1.2;
  const scores=[];
  for(let i=0;i<words.length;i++){
    const weight=italianEvidence(words[i].word);
    const it=weight, en=-weight;
    if(i===0){scores.push([en, it+initialItalian]);continue;}
    const gap=text.slice(words[i-1].pos+words[i-1].word.length,words[i].pos);
    const switchCost=/[.!?;\n]/u.test(gap)?1.0:2.8;
    const prev=scores[i-1];
    scores.push([Math.max(prev[0],prev[1]-switchCost)+en,
                 Math.max(prev[1],prev[0]-switchCost)+it]);
  }
  const labels=new Array(words.length);
  let state=scores.at(-1)[1]>scores.at(-1)[0]?'it':english;
  for(let i=words.length-1;i>=0;i--){
    labels[i]=state;
    if(i===0)break;
    const gap=text.slice(words[i-1].pos+words[i-1].word.length,words[i].pos);
    const switchCost=/[.!?;\n]/u.test(gap)?1.0:2.8;
    const now=state==='it'?1:0,previous=scores[i-1];
    state=previous[now]>=previous[1-now]-switchCost?state:(state==='it'?english:'it');
  }
  const segments=[];let start=0,language=labels[0];
  for(let i=1;i<words.length;i++){
    if(labels[i]===language)continue;
    const cut=words[i].pos;
    segments.push({text:text.slice(start,cut),language,source:'detected'});
    start=cut;language=labels[i];
  }
  segments.push({text:text.slice(start),language,source:'detected'});
  return segments;
}
function mergeConsecutive(parts){
  const merged=[];
  for(const part of parts){
    if(!part.text)continue;
    const previous=merged.at(-1);
    if(previous && previous.language===part.language && previous.source===part.source){
      previous.text+=part.text;
    }else merged.push({...part});
  }
  return merged;
}
function detectUntagged(text, fallback){
  const parts=[];let position=0;
  for(const match of text.matchAll(JP_RUN)){
    if(match.index>position)parts.push(...scoredLatin(text.slice(position,match.index),fallback));
    // The model does not infer Chinese from Han characters in this
    // two-persona Italian/Japanese lab. Explicit tags override this.
    parts.push({text:match[0],language:'ja',source:'script'});
    position=match.index+match[0].length;
  }
  if(position<text.length)parts.push(...scoredLatin(text.slice(position),fallback));
  return mergeConsecutive(parts);
}
export function detectLanguageSpans(input, fallback='en-us'){
  if(!['en-us','en-gb','it','ja'].includes(fallback))throw Error('Unknown fallback speech language.');
  if(typeof input!=='string')throw Error('Speech requires plain text.');
  const parts=[];let cursor=0;
  for(const match of input.matchAll(TAGS)){
    if(match.index>cursor)parts.push(...detectUntagged(input.slice(cursor,match.index),fallback));
    parts.push({text:match[2],language:match[1].toLowerCase(),source:'explicit'});
    cursor=match.index+match[0].length;
  }
  if(cursor<input.length)parts.push(...detectUntagged(input.slice(cursor),fallback));
  return mergeConsecutive(parts);
}
export function languageAwareSpeechSegments(text,fallback='en-us'){
  const spans=detectLanguageSpans(text,fallback),results=[];
  for(const item of spans){
    for(const part of speechSegments(item.text,item.language,LIMIT)){
      results.push({...part,source:item.source});
    }
  }
  return results;
}
export function spokenLanguages(text,fallback='en-us'){
  return [...new Set(languageAwareSpeechSegments(text,fallback).map(x=>x.language))];
}
