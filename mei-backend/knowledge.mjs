import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

const STOP = new Set('a an the and or of to in on for is are be as at by with from that this it its i me my you your we our they their can could would should do does how what why when where which about explain practical terms newcomer give concise factual account including nuance people often miss know want avoid stereotypes common misunderstanding correct walk through important limits exceptions summarize key points flag gaps knowledge instead inventing specifics japan japanese'.split(' '));
export function tokens(text) {
  const normalized = String(text).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  return (normalized.match(/[\p{L}\p{N}]+/gu) || []).filter(t => t.length > 1 && !STOP.has(t));
}
function chunkText(text, size = 1800, overlap = 220) {
  const out = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf('\n', end);
      if (boundary > start + size / 2) end = boundary;
    }
    out.push({ start, end, text: text.slice(start, end) });
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return out;
}
const corpusBytes = {
  cultural: fs.readFileSync(new URL('./knowledge/cultural/drive-corpus.json.gz', import.meta.url)),
  business: fs.readFileSync(new URL('./knowledge/business/drive-corpus.json.gz', import.meta.url))
};
export const corpora = Object.fromEntries(['cultural','business'].map(domain => {
  const data = JSON.parse(gunzipSync(corpusBytes[domain]));
  if (!data.documents.length || data.documents.some(d => d.domain !== domain || !d.text)) throw new Error(`Invalid ${domain} corpus`);
  return [domain, data];
}));
export const documents = Object.values(corpora).flatMap(c => c.documents);
const indexes = Object.fromEntries(Object.entries(corpora).map(([domain, corpus]) => {
  const chunks = corpus.documents.flatMap(doc => chunkText(doc.text).map((piece, chunk) => {
    const words = tokens(piece.text), frequency = new Map();
    words.forEach(t => frequency.set(t, (frequency.get(t) || 0) + 1));
    return { doc, ...piece, chunk, frequency, length: words.length, titleTokens:new Set(tokens(`${doc.topic} ${doc.title}`)) };
  }));
  const df = new Map();
  chunks.forEach(c => c.frequency.forEach((_, t) => df.set(t, (df.get(t)||0)+1)));
  return [domain, {chunks, df, avg:chunks.reduce((n,c)=>n+c.length,0)/chunks.length}];
}));
export function knowledgeStatus() {
  return Object.fromEntries(Object.entries(corpora).map(([domain, corpus]) => [domain, {
    documents:corpus.documents.length, topics:new Set(corpus.documents.map(d=>d.topic)).size,
    chunks:indexes[domain].chunks.length, version:corpus.version
  }]));
}
export function retrieve(domain, query, limit = 4, maxChars = 9000) {
  const index = indexes[domain];
  if (!index) throw new Error(`Unknown knowledge domain: ${domain}`);
  const terms = [...new Set(tokens(query))];
  const ranked = index.chunks.map(c => {
    let score = 0;
    for (const t of terms) {
      const tf = c.frequency.get(t)||0;
      const idf = Math.log(1 + (index.chunks.length - (index.df.get(t)||0) + .5)/((index.df.get(t)||0)+.5));
      if (tf) score += idf * (tf * 2.2)/(tf + 1.2*(.25+.75*c.length/index.avg));
      if (c.titleTokens.has(t)) score += idf*2.5;
    }
    return {...c,score};
  }).filter(c=>c.score>0).sort((a,b)=>b.score-a.score || a.doc.id.localeCompare(b.doc.id) || a.chunk-b.chunk);
  const picked = [], perDoc = new Map();
  let chars = 0;
  for (const c of ranked) {
    if (picked.length >= limit) break;
    if ((perDoc.get(c.doc.id)||0)>=2) continue;
    // Adjacent overlapping passages should not spend the entire evidence budget.
    if (picked.some(p=>p.doc.id===c.doc.id && Math.abs(p.chunk-c.chunk)<2)) continue;
    const header = `SOURCE: ${c.doc.title}\nURL: ${c.doc.sourceUrl}\nPASSAGE: ${c.chunk+1}\n`;
    if (chars + header.length + c.text.length + 10 > maxChars) continue;
    picked.push(c); perDoc.set(c.doc.id,(perDoc.get(c.doc.id)||0)+1); chars += header.length+c.text.length+10;
  }
  return {
    selected:picked.map(c=>({id:c.doc.id,file:`drive:${c.doc.id}`,title:c.doc.title,sourceUrl:c.doc.sourceUrl,chunk:c.chunk,start:c.start,end:c.end,score:Number(c.score.toFixed(4))})),
    compiled:picked.map(c=>`SOURCE: ${c.doc.title}\nURL: ${c.doc.sourceUrl}\nPASSAGE: ${c.chunk+1}\n${c.text}`).join('\n\n---\n\n')
  };
}
