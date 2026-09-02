import fs from 'node:fs';
import path from 'node:path';
import { loadDotEnv } from '../lib/env.mjs';
import { getConfig } from '../lib/config.mjs';
import { createProvider } from '../lib/provider.mjs';
import { createGiulia } from '../lib/giulia.mjs';

loadDotEnv();

const PROMPT_FILES = ['core.md', 'router.md', 'cultural.md', 'business.md', 'synthesis.md'];

function arg(name, fallback = null) {
  const hit = process.argv.find(value => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

function csvRows(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim()));
}

function normalizeCase(item, index) {
  if (typeof item === 'string') {
    return {
      id: `q-${index + 1}`,
      messages: [{ role: 'user', content: item.trim() }],
      expectedRoute: null,
      tags: [],
      evalFocus: '',
      expectedBehavior: []
    };
  }
  if (!item || typeof item !== 'object') throw new Error(`Question ${index + 1} is not a string or object.`);
  const messages = Array.isArray(item.messages)
    ? item.messages
    : [{ role: 'user', content: String(item.question ?? item.prompt ?? '').trim() }];
  if (!messages.length || !messages.some(m => m?.role === 'user' && String(m?.content || '').trim())) {
    throw new Error(`Question ${index + 1} has no user message.`);
  }
  return {
    id: String(item.id || `q-${index + 1}`),
    messages,
    expectedRoute: item.expectedRoute || item.expected_route || null,
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    evalFocus: String(item.evalFocus || item.eval_focus || ''),
    expectedBehavior: Array.isArray(item.expectedBehavior)
      ? item.expectedBehavior.map(String)
      : Array.isArray(item.expected_behavior) ? item.expected_behavior.map(String) : []
  };
}

function loadCases(file) {
  const full = path.resolve(file);
  if (!fs.existsSync(full)) throw new Error(`Input file not found: ${file}`);
  const text = fs.readFileSync(full, 'utf8');
  const ext = path.extname(full).toLowerCase();
  let raw;
  if (ext === '.json') {
    const parsed = JSON.parse(text);
    raw = Array.isArray(parsed) ? parsed : parsed.questions;
  } else if (ext === '.jsonl') {
    raw = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => JSON.parse(line));
  } else if (ext === '.csv') {
    const rows = csvRows(text);
    if (!rows.length) return [];
    const header = rows[0].map(h => h.trim().toLowerCase());
    const q = header.findIndex(h => ['question', 'prompt'].includes(h));
    if (q < 0) throw new Error('CSV needs a question or prompt column.');
    const id = header.indexOf('id');
    const route = header.findIndex(h => ['expectedroute', 'expected_route', 'route'].includes(h));
    raw = rows.slice(1).map((r, i) => ({
      id: id >= 0 ? r[id] : `q-${i + 1}`,
      question: r[q] || '',
      expectedRoute: route >= 0 ? r[route] : null
    })).filter(item => item.question.trim());
  } else {
    raw = text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  }
  if (!Array.isArray(raw)) throw new Error('JSON input must be an array or an object with a questions array.');
  return raw.map(normalizeCase);
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join(' | ') : value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function promptSnapshot(config) {
  const snapshot = {};
  for (const name of PROMPT_FILES) {
    const file = path.join(config.promptsDir, name);
    snapshot[name] = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  }
  return snapshot;
}

const inputFile = arg('file', 'evals/examples/meeting-demo.json');
const concurrency = Math.max(1, Math.min(16, Number(arg('concurrency', '4')) || 4));
const requestedProvider = arg('provider', null);
const config = getConfig();
if (requestedProvider) config.provider = requestedProvider;
const provider = createProvider(config);
const giulia = createGiulia({ config, provider });
const cases = loadCases(inputFile);
if (!cases.length) throw new Error(`No questions found in ${inputFile}.`);

const started = new Date().toISOString();
const results = new Array(cases.length);
let cursor = 0;

function caseMetadata(testCase) {
  return {
    tags: testCase.tags,
    evalFocus: testCase.evalFocus,
    expectedBehavior: testCase.expectedBehavior
  };
}

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= cases.length) return;
    const testCase = cases[index];
    const t0 = Date.now();
    try {
      const result = await giulia.chat(testCase.messages);
      results[index] = {
        id: testCase.id,
        question: [...testCase.messages].reverse().find(m => m.role === 'user')?.content || '',
        messages: testCase.messages,
        ...caseMetadata(testCase),
        expectedRoute: testCase.expectedRoute,
        actualRoute: result.route,
        routePass: testCase.expectedRoute ? result.route === testCase.expectedRoute : null,
        routeConfidence: result.trace.route?.confidence ?? null,
        routeReason: result.trace.route?.reason ?? null,
        reply: result.reply,
        runId: result.trace.runId,
        elapsedMs: Date.now() - t0,
        error: null
      };
    } catch (error) {
      results[index] = {
        id: testCase.id,
        question: [...testCase.messages].reverse().find(m => m.role === 'user')?.content || '',
        messages: testCase.messages,
        ...caseMetadata(testCase),
        expectedRoute: testCase.expectedRoute,
        actualRoute: null,
        routePass: testCase.expectedRoute ? false : null,
        routeConfidence: null,
        routeReason: null,
        reply: '',
        runId: null,
        elapsedMs: Date.now() - t0,
        error: error.message
      };
    }
    console.error(`[${index + 1}/${cases.length}] ${testCase.id}: ${results[index].error ? 'ERROR' : results[index].actualRoute}`);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, () => worker()));

const activeModel = config.provider === 'ollama' ? config.ollama.model : config.qwen.model;
const routeCounts = results.reduce((acc, r) => { const key = r.actualRoute || 'error'; acc[key] = (acc[key] || 0) + 1; return acc; }, {});
const scored = results.filter(r => r.expectedRoute);
const report = {
  sourceFile: inputFile,
  gitCommit: process.env.GITHUB_SHA || null,
  started,
  finished: new Date().toISOString(),
  provider: provider.name,
  model: activeModel,
  concurrency,
  promptSnapshot: promptSnapshot(config),
  total: results.length,
  successful: results.filter(r => !r.error).length,
  errors: results.filter(r => r.error).length,
  routeChecks: scored.length,
  routePasses: scored.filter(r => r.routePass).length,
  routeCounts,
  results
};

fs.mkdirSync(config.evalResultsDir, { recursive: true });
const stem = path.basename(inputFile, path.extname(inputFile)).replace(/[^a-z0-9_-]+/gi, '-');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const jsonFile = path.join(config.evalResultsDir, `${stem}-${stamp}.json`);
const csvFile = path.join(config.evalResultsDir, `${stem}-${stamp}.csv`);
const summaryFile = path.join(config.evalResultsDir, `${stem}-${stamp}.md`);

fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2));
const columns = ['id','question','tags','evalFocus','expectedBehavior','expectedRoute','actualRoute','routePass','routeConfidence','elapsedMs','runId','reply','error'];
fs.writeFileSync(csvFile, [columns.join(','), ...results.map(r => columns.map(c => csvEscape(r[c])).join(','))].join('\n'));

const summary = [
  `# Giulia batch: ${stem}`,
  '',
  `- Git commit: **${report.gitCommit || 'local / unavailable'}**`,
  `- Questions: **${report.total}**`,
  `- Successful: **${report.successful}**`,
  `- Errors: **${report.errors}**`,
  `- Provider/model: **${report.provider} / ${report.model}**`,
  `- Parallel conversations: **${report.concurrency}**`,
  scored.length ? `- Expected-route checks: **${report.routePasses}/${report.routeChecks} passed**` : '- Expected-route checks: not supplied',
  `- Routes: ${Object.entries(routeCounts).map(([k,v]) => `${k}=${v}`).join(', ')}`,
  '- Prompt snapshot: embedded in the JSON report',
  '',
  '| ID | Focus | Expected | Actual | Time | Status |',
  '|---|---|---|---|---:|---|',
  ...results.map(r => `| ${r.id} | ${(r.evalFocus || '').replaceAll('|','\\|')} | ${r.expectedRoute || ''} | ${r.actualRoute || ''} | ${r.elapsedMs} ms | ${r.error ? `ERROR: ${r.error.replaceAll('|','\\|')}` : (r.routePass === false ? 'route mismatch' : 'ok')} |`)
].join('\n');
fs.writeFileSync(summaryFile, summary);

console.log(JSON.stringify(report, null, 2));
console.error(`\nSaved ${jsonFile}`);
console.error(`Saved ${csvFile}`);
console.error(`Saved ${summaryFile}`);

if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
if (report.successful === 0) process.exitCode = 1;
