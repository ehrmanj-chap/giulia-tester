import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getConfig } from '../lib/config.mjs';
import { createGiulia } from '../lib/giulia.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));

test('relocated deployment loads all persona files and both corpora into specialist requests',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'giulia-deployment-'));
  try {
    for(const entry of ['lib','prompts','knowledge']) fs.cpSync(path.join(root,entry),path.join(dir,entry),{recursive:true});
    const {createGiulia:relocated}=await import(pathToFileURL(path.join(dir,'lib/giulia.mjs')));
    const config={...getConfig(dir),provider:'qwen',traceWrites:false};
    const requests=[];
    const provider={name:'fixture',complete:async request=>{
      requests.push(request);
      return {content:requests.length===1?'{"route":"cultural"}':'Grounded fixture reply',model:'fixture'};
    }};
    const giulia=relocated({config,provider});
    const status=giulia.status();
    assert.equal(status.ready,true);
    assert.equal(status.cultural.documents,25);assert.equal(status.business.documents,25);
    assert.equal(Object.keys(status.prompts).length,5);
    assert.ok(Object.values(status.prompts).every(p=>p.chars>0));
    const result=await giulia.chat([{role:'user',content:'Explain campanilismo and local identity in Italy.'}]);
    assert.ok(result.trace.calls.find(c=>c.role==='cultural').retrieval.length>0);
    assert.match(requests[1].messages[0].content,/===== SOURCE:/);
    assert.ok(requests[1].messages[0].content.includes(fs.readFileSync(path.join(dir,'prompts/core.md'),'utf8')));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('missing knowledge or prompts blocks model spending and reports unready status',async()=>{
  let calls=0;
  const provider={name:'fixture',complete:async()=>{calls++;throw new Error('Must not call provider');}};
  for(const missing of ['knowledgeDir','promptsDir']){
    const config={...getConfig(root),[missing]:path.join(root,'absent-deployment-assets'),traceWrites:false};
    const giulia=createGiulia({config,provider});
    assert.equal(giulia.status().ready,false);
    await assert.rejects(giulia.chat([{role:'user',content:'Explain Italy.'}]),e=>e.statusCode===503&&/missing required/.test(e.message));
  }
  assert.equal(calls,0);
});
