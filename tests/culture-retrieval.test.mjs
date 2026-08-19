import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../lib/config.mjs';
import { loadKnowledge } from '../lib/loaders.mjs';
import { retrieveKnowledge } from '../lib/retrieval.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = getConfig(root);
const kb = loadKnowledge(config, 'cultural');

const cases = [
  ['campanilismo', 'What does campanilismo mean and why does it matter in Italy?', ['culture-003']],
  ['email', 'How formal should an email to an Italian professor be?', ['culture-018']],
  ['church', 'What should I wear when entering a church in Italy?', ['culture-001', 'culture-007']],
  ['dialects', 'Is Sardinian just an Italian dialect?', ['culture-002']],
  ['coffee', 'Will ordering a cappuccino after lunch make me look like a tourist?', ['culture-015', 'culture-012', 'culture-019']],
  ['family', 'Why is Sunday family lunch such a big deal in Italy?', ['culture-016', 'culture-019']],
  ['hierarchy', 'What does bella figura have to do with social status and hierarchy?', ['culture-020']],
  ['biennale', 'What is In Minor Keys at the 2026 Venice Biennale?', ['culture-008', 'culture-004']],
  ['foreigners', 'How are foreigners generally received in Italy?', ['culture-009']],
  ['greetings', 'When should I say buongiorno instead of ciao?', ['culture-023']]
];

for (const [id, query, expectedIds] of cases) {
  test(`retrieval: ${id}`, () => {
    const result = retrieveKnowledge(kb, query);
    assert.ok(result.selected.length > 0, 'expected at least one retrieved chunk');
    const topFiles = result.selected.slice(0, 4).map(x => x.file);
    assert.ok(expectedIds.some(expected => topFiles.some(file => file.includes(expected))), `expected one of ${expectedIds.join(', ')} in top 4; got ${topFiles.join(', ')}`);
  });
}
