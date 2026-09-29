import test from 'node:test';
import assert from 'node:assert/strict';
import {assessRetrieval,giuliaPreflightError,ragLabel} from '../public/dual-lab/verity-retrieval.js';

test('absent diagnostics and incomplete mixed-route diagnostics are unknown, not zero',()=>{
  assert.equal(assessRetrieval(null,'cultural').retrievalPresent,null);
  assert.equal(assessRetrieval({calls:[{role:'router',retrieval:null}]},'cultural').retrievalObserved,false);
  assert.equal(assessRetrieval({calls:[{role:'cultural',retrieval:[]}]},'both').retrievalObserved,false);
  assert.match(ragLabel({actualRoute:'business',diagnostics:null,retrieval:[]}),/unknown/);
  assert.equal(ragLabel({actualRoute:'out_of_scope'}),'RAG n/a');
});
test('reported empty retrieval is zero; actual sources are counted and matched by file or Drive ID',()=>{
  const empty={calls:[{role:'business',retrieval:[]}]};
  assert.equal(assessRetrieval(empty,'business').retrievalPresent,false);
  assert.equal(ragLabel({actualRoute:'business',diagnostics:empty}),'RAG 0');
  const diag={calls:[{role:'router',retrieval:null},{role:'business',retrieval:[{file:'tax.md',id:'drive-id'}]}]};
  for(const source of ['tax.md','drive-id']){
    const a=assessRetrieval(diag,'business',[source]);
    assert.equal(a.retrievalPresent,true);assert.equal(a.retrieval.length,1);assert.equal(a.sourceHintPass,true);
  }
});
test('Giulia evaluation preflight rejects hidden diagnostics or missing corpus',()=>{
  const ready={diagnostics:true,knowledge:{cultural:{documents:25,chunks:10},business:{documents:25,chunks:10}}};
  assert.equal(giuliaPreflightError(ready),null);
  assert.match(giuliaPreflightError({...ready,diagnostics:false}),/GIULIA_DEV_DIAGNOSTICS/);
  assert.match(giuliaPreflightError({...ready,knowledge:{}}),/corpus/);
});
