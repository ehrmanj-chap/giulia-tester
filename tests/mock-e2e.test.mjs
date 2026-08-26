import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../lib/config.mjs';
import { MockProvider } from '../lib/provider-mock.mjs';
import { createGiulia } from '../lib/giulia.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function testConfig() {
  const config = getConfig(projectRoot);
  config.provider = 'mock';
  config.traceWrites = false;
  return config;
}
function makeGiulia() { const config = testConfig(); return { config, giulia: createGiulia({ config, provider: new MockProvider(config) }) }; }

test('both current lab corpora are loaded', () => {
  const { giulia } = makeGiulia();
  const status = giulia.status();
  assert.equal(status.available.cultural, true);
  assert.equal(status.available.business, true);
  assert.equal(status.cultural.documents, 25);
  assert.ok(status.cultural.chunks > 25);
  assert.equal(status.business.documents, 25);
  assert.equal(status.business.chunks, 267);
});

test('routes a cultural question and calls only Cultural Giulia internally', async () => {
  const { giulia } = makeGiulia();
  const result = await giulia.chat([{ role: 'user', content: 'What Italian etiquette should I know at dinner?' }]);
  assert.equal(result.route, 'cultural');
  assert.match(result.reply, /Giulia cultural answer/);
  assert.doesNotMatch(result.reply, /Giulia C/);
  assert.deepEqual(result.trace.calls.map(c => c.role), ['router', 'cultural']);
  assert.ok(result.trace.calls[1].retrieval.length > 0);
});

test('business route retrieves evidence and calls Business Giulia', async () => {
  const { giulia } = makeGiulia();
  const result = await giulia.chat([{ role: 'user', content: 'What should I know about Italian corporate tax compliance?' }]);
  assert.equal(result.route, 'business');
  assert.match(result.reply, /Giulia business answer/);
  assert.deepEqual(result.trace.calls.map(c => c.role), ['router', 'business']);
  assert.ok(result.trace.calls[1].retrieval.length > 0);
});

test('both route retrieves from both corpora and synthesizes one answer', async () => {
  const { giulia } = makeGiulia();
  const result = await giulia.chat([{ role: 'user', content: 'How could Italian campanilismo affect supplier selection and market expansion?' }]);
  assert.equal(result.route, 'both');
  assert.match(result.reply, /unified Giulia synthesis/);
  assert.deepEqual(result.trace.calls.map(c => c.role), ['router', 'cultural', 'business', 'synthesis']);
  assert.ok(result.trace.calls[1].retrieval.length > 0);
  assert.ok(result.trace.calls[2].retrieval.length > 0);
});

test('professional context can still route cultural when the practical task is social meaning', async () => {
  const { giulia } = makeGiulia();
  const result = await giulia.chat([{ role: 'user', content: 'In Italy, what does using ciao instead of buongiorno signal socially with a coworker?' }]);
  assert.equal(result.route, 'cultural');
});

test('business follow-up inherits Italy context from conversation history', async () => {
  const { giulia } = makeGiulia();
  const result = await giulia.chat([
    { role: 'user', content: 'I am considering an Italian market entry strategy for my company.' },
    { role: 'assistant', content: 'Tell me what part you want to examine.' },
    { role: 'user', content: 'What about Milan specifically?' }
  ]);
  assert.equal(result.route, 'business');
});

test('refuses unrelated out-of-scope request', async () => {
  const { giulia } = makeGiulia();
  const result = await giulia.chat([{ role: 'user', content: 'What language family does Bhutanese belong to?' }]);
  assert.equal(result.route, 'out_of_scope');
  assert.match(result.reply, /Italian cultural and business intelligence/);
});
