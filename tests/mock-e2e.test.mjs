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

test('culture corpus is loaded while business corpus is intentionally absent', () => {
  const { giulia } = makeGiulia();
  const status = giulia.status();
  assert.equal(status.available.cultural, true);
  assert.equal(status.available.business, false);
  assert.equal(status.cultural.documents, 25);
  assert.ok(status.cultural.chunks > 25);
  assert.equal(status.business.documents, 0);
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

test('business route is testable before the business corpus arrives', async () => {
  const { giulia } = makeGiulia();
  const result = await giulia.chat([{ role: 'user', content: 'What should I know about Italian corporate tax compliance?' }]);
  assert.equal(result.route, 'business');
  assert.match(result.reply, /Business knowledge corpus is not loaded yet/);
  assert.deepEqual(result.trace.calls.map(c => c.role), ['router']);
});

test('both route returns the cultural half plus an explicit internal incompleteness note', async () => {
  const { giulia } = makeGiulia();
  const result = await giulia.chat([{ role: 'user', content: 'How could Italian campanilismo affect supplier selection and market expansion?' }]);
  assert.equal(result.route, 'both');
  assert.match(result.reply, /Giulia cultural answer/);
  assert.match(result.reply, /Business corpus is not loaded yet/);
  assert.deepEqual(result.trace.calls.map(c => c.role), ['router', 'cultural']);
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
