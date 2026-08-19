import fs from 'node:fs';
import path from 'node:path';
import { loadDotEnv } from '../lib/env.mjs';
import { getConfig } from '../lib/config.mjs';
import { createProvider } from '../lib/provider.mjs';
import { createGiulia } from '../lib/giulia.mjs';

loadDotEnv();
const config = getConfig();
const provider = createProvider(config);
const giulia = createGiulia({ config, provider });
const cases = JSON.parse(fs.readFileSync(path.join(config.rootDir, 'evals', 'cases.json'), 'utf8'));
const started = new Date().toISOString();
const results = [];

for (const testCase of cases) {
  const t0 = Date.now();
  try {
    const result = await giulia.chat(testCase.messages);
    results.push({ id: testCase.id, expectedRoute: testCase.expectedRoute, actualRoute: result.route, routePass: result.route === testCase.expectedRoute, reply: result.reply, runId: result.trace.runId, elapsedMs: Date.now() - t0 });
  } catch (error) {
    results.push({ id: testCase.id, expectedRoute: testCase.expectedRoute, error: error.message, routePass: false, elapsedMs: Date.now() - t0 });
  }
}

const report = { started, finished: new Date().toISOString(), provider: provider.name, model: config.qwen.model, passedRoutes: results.filter(r => r.routePass).length, total: results.length, results };
fs.mkdirSync(config.evalResultsDir, { recursive: true });
const name = `eval-${new Date().toISOString().replace(/[:.]/g, '-')}-${provider.name}.json`;
const file = path.join(config.evalResultsDir, name);
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.error(`\nSaved ${path.relative(config.rootDir, file)}`);
process.exitCode = report.passedRoutes === report.total ? 0 : 1;
