import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../lib/config.mjs';
import { MockProvider } from '../lib/provider-mock.mjs';
import { createGiulia } from '../lib/giulia.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function testConfig() { const config = getConfig(projectRoot); config.provider = 'mock'; config.traceWrites = false; return config; }

test('routes a cultural question and returns Cultural response', async () => {
  const config = testConfig(); const giulia = createGiulia({ config, provider: new MockProvider(config) });
  const result = await giulia.chat([{ role: 'user', content: 'What Italian etiquette should I know at dinner?' }]);
  assert.equal(result.route, 'cultural'); assert.match(result.reply, /Cultural Giulia/);
});

test('routes a business-cultural workplace question through synthesis', async () => {
  const config = testConfig(); const giulia = createGiulia({ config, provider: new MockProvider(config) });
  const result = await giulia.chat([{ role: 'user', content: 'How should an intern speak to a manager at an Italian company?' }]);
  assert.equal(result.route, 'both'); assert.match(result.reply, /unified Giulia synthesis/);
});

test('routes a mixed question through both specialists and synthesis', async () => {
  const config = testConfig(); const giulia = createGiulia({ config, provider: new MockProvider(config) });
  const result = await giulia.chat([{ role: 'user', content: 'How do Italian workplace hierarchy and social etiquette interact?' }]);
  assert.equal(result.route, 'both');
  assert.deepEqual(result.trace.calls.map(c => c.role), ['router', 'cultural', 'business', 'synthesis']);
});

test('refuses unrelated out-of-scope request', async () => {
  const config = testConfig(); const giulia = createGiulia({ config, provider: new MockProvider(config) });
  const result = await giulia.chat([{ role: 'user', content: 'What language family does Bhutanese belong to?' }]);
  assert.equal(result.route, 'out_of_scope'); assert.match(result.reply, /Italian cultural and business contexts/);
});
