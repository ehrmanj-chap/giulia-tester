import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const corpusDir = path.join(root, 'evals', 'corpus-v1');
const files = [
  'cultural.json',
  'business.json',
  'both.json',
  'out-of-scope.json',
  'boundaries-and-guardrails.json'
];
const allowedRoutes = new Set(['cultural', 'business', 'both', 'out_of_scope']);

function loadCorpus() {
  return files.flatMap(file => {
    const value = JSON.parse(fs.readFileSync(path.join(corpusDir, file), 'utf8'));
    assert.ok(Array.isArray(value), `${file} must contain an array`);
    return value.map(item => ({ ...item, sourceFile: file }));
  });
}

test('evaluation corpus has 120 valid uniquely identified cases', () => {
  const cases = loadCorpus();
  assert.equal(cases.length, 120);
  assert.equal(new Set(cases.map(item => item.id)).size, 120, 'case ids must be unique');

  for (const item of cases) {
    assert.ok(item.id && typeof item.id === 'string', `${item.sourceFile}: missing id`);
    assert.ok(allowedRoutes.has(item.expectedRoute), `${item.id}: invalid expectedRoute`);
    const messages = Array.isArray(item.messages)
      ? item.messages
      : [{ role: 'user', content: item.question }];
    assert.ok(messages.some(message => message?.role === 'user' && String(message?.content || '').trim()), `${item.id}: missing user message`);
    assert.ok(Array.isArray(item.tags), `${item.id}: tags must be an array`);
    assert.ok(typeof item.evalFocus === 'string' && item.evalFocus.trim(), `${item.id}: missing evalFocus`);
    assert.ok(Array.isArray(item.expectedBehavior) && item.expectedBehavior.length, `${item.id}: expectedBehavior must be non-empty`);
  }
});

test('evaluation corpus keeps a useful route distribution', () => {
  const counts = loadCorpus().reduce((acc, item) => {
    acc[item.expectedRoute] = (acc[item.expectedRoute] || 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, {
    cultural: 41,
    business: 42,
    both: 20,
    out_of_scope: 17
  });
});
