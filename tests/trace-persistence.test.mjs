import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from '../lib/config.mjs';
import { writeTrace } from '../lib/trace.mjs';
import { createGiulia } from '../lib/giulia.mjs';
import { MockProvider } from '../lib/provider-mock.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

test('Vercel disables trace files by default and explicit opt-in uses temporary storage', () => {
  const saved = { VERCEL: process.env.VERCEL, GIULIA_TRACE_WRITES: process.env.GIULIA_TRACE_WRITES };
  try {
    process.env.VERCEL = '1';
    delete process.env.GIULIA_TRACE_WRITES;
    assert.equal(getConfig(root).traceWrites, false);
    process.env.GIULIA_TRACE_WRITES = 'true';
    const config = getConfig(root);
    assert.equal(config.traceWrites, true);
    assert.equal(config.runsDir, path.join(os.tmpdir(), 'giulia-runs'));
    delete process.env.VERCEL;
    delete process.env.GIULIA_TRACE_WRITES;
    assert.equal(getConfig(root).traceWrites, true);
    assert.equal(getConfig(root).runsDir, path.join(root, 'runs'));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('chat replies and original provider errors survive unavailable trace storage', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giulia-trace-test-'));
  try {
    const blocker = path.join(dir, 'file');
    fs.writeFileSync(blocker, 'not a directory');
    const config = { ...getConfig(root), provider: 'mock', traceWrites: true, runsDir: path.join(blocker, 'runs') };
    const giulia = createGiulia({ config, provider: new MockProvider(config) });
    const result = await giulia.chat([{ role: 'user', content: 'What Italian etiquette should I know at dinner?' }]);
    assert.match(result.reply, /Giulia cultural answer/);
    const providerError = new Error('Provider fixture failed');
    const failing = createGiulia({ config, provider: { name: 'fixture', complete: async () => { throw providerError; } } });
    await assert.rejects(failing.chat([{ role: 'user', content: 'Italian dinner etiquette?' }]), error => error === providerError);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('local trace persistence still saves a readable JSON file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giulia-trace-test-'));
  try {
    const trace = { runId: 'fixture', final: { reply: 'hello' } };
    const file = writeTrace({ traceWrites: true, runsDir: dir }, trace);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), trace);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
