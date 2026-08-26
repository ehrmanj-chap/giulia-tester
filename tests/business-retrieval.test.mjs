import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../lib/config.mjs';
import { loadKnowledge } from '../lib/loaders.mjs';
import { retrieveKnowledge } from '../lib/retrieval.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = getConfig(root);
const kb = loadKnowledge(config, 'business');

test('loads the complete deduplicated Business corpus with provenance', () => {
  assert.equal(kb.documents.length, 25);
  assert.equal(kb.index.count, 267);
  assert.equal(new Set(kb.documents.map(doc => doc.sourceSha256)).size, 25);
  assert.ok(kb.documents.every(doc => doc.sourcePdf && doc.sourceSha256 && doc.title && doc.text));
});

const cases = [
  ['company-law', 'What are the differences between an Italian SRL and SPA company?', ['business-002']],
  ['consumer-protection', 'What role does AGCM play in Italian consumer protection?', ['business-013', 'business-024']],
  ['government-accountability', 'How does a confidence vote make the Italian government accountable to Parliament?', ['business-001', 'business-008']],
  ['anti-corruption', 'What anti-corruption obligations should a company operating in Italy understand?', ['business-018']],
  ['meetings', 'How should I prepare for business meetings and negotiations in Italy?', ['business-021']],
  ['sovereign-debt', 'How does sovereign debt affect the Italian business environment?', ['business-004']],
  ['regional-autonomy', 'How does Italian regional autonomy affect business regulation?', ['business-003']],
  ['constitutional-court', 'What does the Italian Constitutional Court do?', ['business-015']],
  ['electoral-system', 'How does the Italian electoral system work?', ['business-011']],
  ['manufacturing', 'What are Italy’s manufacturing and export strengths?', ['business-006']],
  ['civil-code', 'What does the Italian Civil Code say about companies and contracts?', ['business-022']],
  ['communication', 'How formal should business communication be in Italy?', ['business-019']]
];

for (const [id, query, expectedIds] of cases) {
  test(`business retrieval: ${id}`, () => {
    const result = retrieveKnowledge(kb, query);
    assert.ok(result.selected.length > 0, 'expected at least one retrieved chunk');
    const topFiles = result.selected.slice(0, 4).map(item => item.file);
    assert.ok(
      expectedIds.some(expected => topFiles.some(file => file.includes(expected))),
      `expected one of ${expectedIds.join(', ')} in top 4; got ${topFiles.join(', ')}`
    );
  });
}
