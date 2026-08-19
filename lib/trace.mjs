import fs from 'node:fs';
import path from 'node:path';
import { nowId } from './utils.mjs';

export function createTrace({ provider, messages, promptMeta, knowledgeMeta }) {
  return { runId: nowId(), timestamp: new Date().toISOString(), provider, input: { messages }, route: null, calls: [], promptMeta, knowledgeMeta, final: null, errors: [] };
}

export function recordCall(trace, role, result, extra = {}) {
  trace.calls.push({ role, model: result?.model || null, latencyMs: result?.latencyMs ?? null, usage: result?.usage || null, rawId: result?.rawId || null, output: result?.content || '', ...extra });
}

export function writeTrace(config, trace) {
  if (!config.traceWrites) return null;
  fs.mkdirSync(config.runsDir, { recursive: true });
  const file = path.join(config.runsDir, `${trace.runId}.json`);
  fs.writeFileSync(file, JSON.stringify(trace, null, 2));
  return file;
}
