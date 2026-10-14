import test from 'node:test';
import assert from 'node:assert/strict';
import {detectLanguageSpans, languageAwareSpeechSegments, italianEvidence, spokenLanguages} from '../public/dual-lab/voice/language-detect.js';

test('English / Italian / Japanese / English is detected without server model calls',()=>{
 const text='Welcome, friends! Buongiorno a tutti. こんにちは、みなさん。 We can begin.';
 const parts=languageAwareSpeechSegments(text,'en-us');
 const languages=parts.map(p=>p.language);
 assert.ok(languages.includes('en-us'));
 assert.ok(languages.includes('it'));
 assert.ok(languages.includes('ja'));
 assert.match(parts.find(p=>p.language==='it')?.text||'',/Buongiorno/u);
 assert.match(parts.find(p=>p.language==='ja')?.text||'',/こんにちは/u);
 assert.equal(parts.map(p=>p.text).join('').replace(/\s/gu,''),text.replace(/\s/gu,''));
});
test('native Japanese runs, including kana mixed with kanji, override the English fallback',()=>{
 const parts=detectLanguageSpans('Hello. 今日はいい天気ですね。 Thank you!', 'en-us');
 assert.ok(parts.some(p=>p.language==='ja'&&p.text.includes('今日は')));
 assert.ok(parts.some(p=>p.language==='en-us'&&p.text.includes('Thank')));
});
test('a naturally embedded Italian greeting is segmented without changing the original transcript',()=>{
 const message='She says buongiorno a tutti, and then proceeds to the agenda.';
 const spans=detectLanguageSpans(message,'en-us');
 assert.ok(spans.some(x=>x.language==='it'&&x.text.includes('buongiorno')));
 assert.equal(spans.map(x=>x.text).join(''),message);
});
test('Italian sentences, accented words and suffixes score as Italian',()=>{
 assert.ok(italianEvidence('grazie')>5);
 assert.ok(italianEvidence('è')>5);
 assert.ok(italianEvidence('velocemente')>0);
 assert.ok(italianEvidence('the')<0);
 const languages=spokenLanguages('Grazie mille. Buona sera!', 'en-us');
 assert.ok(languages.includes('it'));
});
test('explicit language tags win even when the spelling is ambiguous',()=>{
 const text='The word [[it]]come[[/it]] is Italian, then [[ja]]よろしくお願いします[[/ja]].';
 const parts=detectLanguageSpans(text,'en-us');
 assert.ok(parts.some(x=>x.source==='explicit'&&x.language==='it'&&x.text==='come'));
 assert.ok(parts.some(x=>x.source==='explicit'&&x.language==='ja'));
 assert.ok(!parts.map(p=>p.text).join('').includes('[['));
});
test('explicit English tags prevent accidental native-language interpretation',()=>{
 const parts=detectLanguageSpans('[[en-us]]Pizza is delicious.[[/en-us]]', 'it');
 assert.deepEqual(parts.map(x=>x.language),['en-us']);
 assert.equal(parts[0].text,'Pizza is delicious.');
});
test('spoken chunks never exceed 260 chars and do not drop phonetic content',()=>{
 const original=('We have an introduction. Buongiorno a tutti. ありがとうございます。 ').repeat(35);
 const spans=languageAwareSpeechSegments(original);
 assert.ok(spans.length>15);
 assert.ok(spans.every(x=>x.text.length<=260));
 assert.equal(spans.map(x=>x.text).join('').replace(/\s/gu,''),original.replace(/\s/gu,''));
});
test('a single Italian borrowed word does not necessarily flip whole English sentence',()=>{
 const parts=detectLanguageSpans('The Italian word pasta is often used in English.', 'en-us');
 assert.ok(parts.some(x=>x.language==='en-us'&&x.text.includes('The')));
});
test('unsupported default language is rejected, not silently reinterpreted',()=>{
 assert.throws(()=>detectLanguageSpans('hello','hi'),/Unknown fallback/);
});
