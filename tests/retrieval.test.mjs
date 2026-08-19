import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeIndex, retrieveKnowledge } from '../lib/retrieval.mjs';

function kb(documents) {
  return { index: buildKnowledgeIndex(documents) };
}

test('retrieves dining source for cappuccino query', () => {
  const knowledge = kb([
    { file: 'food.md', title: 'Italian Food Culture', text: 'Cappuccino is generally associated with breakfast and the morning. Espresso is common throughout the day.' },
    { file: 'email.md', title: 'Italian Email Etiquette', text: 'First-contact professional emails are normally formal and structured.' }
  ]);
  const result = retrieveKnowledge(knowledge, 'Is it weird to order a cappuccino after lunch in Italy?');
  assert.equal(result.selected[0].file, 'food.md');
});

test('retrieves regional identity for campanilismo', () => {
  const knowledge = kb([
    { file: 'regional.md', title: 'Italian Regional Identity and Campanilismo', text: 'Campanilismo describes intense local pride and loyalty to one town or region.' },
    { file: 'religion.md', title: 'Catholic Influence', text: 'Catholic traditions continue to influence the social calendar.' }
  ]);
  const result = retrieveKnowledge(knowledge, 'What does campanilismo mean?');
  assert.equal(result.selected[0].file, 'regional.md');
});

test('caps repeated chunks from a single source', () => {
  const long = Array.from({ length: 20 }, () => 'Italian business culture relationships trust meeting negotiation.').join('\n\n');
  const knowledge = kb([{ file: 'long.md', title: 'Business Culture', text: long }]);
  const result = retrieveKnowledge(knowledge, 'Italian business relationships and meetings');
  assert.ok(result.selected.length <= 2);
});
