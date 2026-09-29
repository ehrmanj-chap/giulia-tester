import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {documents,knowledgeStatus,retrieve} from '../mei-backend/knowledge.mjs';
import {MEI_TOPICS} from '../public/dual-lab/mei-topics.js';
import {buildVerityCases} from '../public/dual-lab/verity-cases.js';

test('all 154 Drive documents preserve source identity and full-text hashes',()=>{
 assert.equal(documents.length,154);assert.equal(new Set(documents.map(d=>d.id)).size,154);
 assert.equal(knowledgeStatus().cultural.documents,74);assert.equal(knowledgeStatus().business.documents,80);
 for(const d of documents){assert.equal(createHash('sha256').update(d.text).digest('hex'),d.sha256);assert.ok(d.sourceUrl.includes(d.id));assert.ok(d.text.length>200);}
 assert.equal(new Set(documents.map(d=>d.topic)).size,77);
});
test('all 77 topics can retrieve their source within a bounded prompt budget',()=>{
 for(const t of MEI_TOPICS){const r=retrieve(t.domain,`What should I know about ${t.topic}?`);assert.ok(r.selected.some(s=>t.sourceIds.includes(s.id)),t.topic);assert.ok(r.compiled.length<=9000,t.topic);for(const s of r.selected){const d=documents.find(d=>d.id===s.id);assert.ok(r.compiled.includes(d.text.slice(s.start,s.end)));}}
});
const probes=[
 ['cultural','Where can an international student set up a bank account?','Opening a Bank Account'],
 ['cultural','What should I do during an earthquake or tsunami?','Safety, Earthquakes'],
 ['cultural','How do Suica and PASMO transit cards work?','Getting Around'],
 ['business','How many hours can a student visa holder work part-time?','Student Visa'],
 ['business','What is the difference between nemawashi and ringi approval?','Nemawashi'],
 ['business','Where do I register my zairyu residence card after moving?','Residence Card']
];
for(const [domain,question,hint] of probes)test(`Mei paraphrase retrieval: ${hint}`,()=>assert.ok(retrieve(domain,question).selected.some(d=>d.title.includes(hint))));
test('Mei evaluation covers all imported topics and retains 200 cases',()=>{
 const cases=buildVerityCases().filter(t=>t.agent==='mei');assert.equal(cases.length,200);
 for(const t of MEI_TOPICS)assert.equal(cases.filter(c=>c.expectedSources.some(id=>t.sourceIds.includes(id))).length,2,t.topic);
 assert.ok(cases.some(c=>c.expectedRoute==='out_of_scope'));assert.ok(cases.some(c=>c.expectedRoute==='both'));
});
