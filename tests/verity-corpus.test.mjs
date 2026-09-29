import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVerityCases, VERITY_META } from '../public/dual-lab/verity-cases.js';

test('dual verity corpus is exactly 400 unique cases split 200/200', () => {
  const cases=buildVerityCases();
  assert.equal(cases.length,400); assert.equal(new Set(cases.map(x=>x.id)).size,400);
  assert.equal(cases.filter(x=>x.agent==='giulia').length,200); assert.equal(cases.filter(x=>x.agent==='mei').length,200);
  assert.equal(VERITY_META.total,400); assert.equal(VERITY_META.perAgent,200);
  for(const x of cases){ assert.ok(['cultural','business','both','out_of_scope'].includes(x.expectedRoute)); assert.ok(x.question); assert.ok(Array.isArray(x.reviewLens)); }
});
