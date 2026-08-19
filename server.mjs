import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDotEnv } from './lib/env.mjs';
import { getConfig } from './lib/config.mjs';
import { createProvider } from './lib/provider.mjs';
import { createGiulia } from './lib/giulia.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(rootDir);
loadDotEnv(path.join(rootDir, '.env'));
const config = getConfig(rootDir);
const provider = createProvider(config);
const giulia = createGiulia({ config, provider });
const publicDir = path.join(rootDir, 'public');

const activeModel = config.provider === 'ollama' ? config.ollama.model : config.qwen.model;
const activeRouterModel = config.provider === 'ollama' ? config.ollama.routerModel : config.qwen.routerModel;

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readBody(req, maxBytes = 2_000_000) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const target = path.resolve(publicDir, `.${pathname}`);
  if (!target.startsWith(publicDir + path.sep) && target !== path.join(publicDir, 'index.html')) { res.writeHead(403); return res.end('Forbidden'); }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(target).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/status') return sendJson(res, 200, {
      ok: true,
      provider: provider.name,
      model: activeModel,
      routerModel: activeRouterModel,
      endpoint: config.provider === 'ollama' ? config.ollama.endpoint : undefined,
      diagnostics: config.devDiagnostics
    });
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = JSON.parse(await readBody(req) || '{}');
      const result = await giulia.chat(body.messages);
      const payload = { reply: result.reply, route: result.route, model: activeModel, runId: result.trace.runId };
      if (config.devDiagnostics) payload.diagnostics = { route: result.trace.route, calls: result.trace.calls.map(call => ({ role: call.role, model: call.model, latencyMs: call.latencyMs, usage: call.usage })), promptMeta: result.trace.promptMeta, knowledgeMeta: result.trace.knowledgeMeta };
      return sendJson(res, 200, payload);
    }
    if (req.method === 'GET' && url.pathname === '/api/runs/latest') {
      const files = fs.existsSync(config.runsDir) ? fs.readdirSync(config.runsDir).filter(name => name.endsWith('.json')).sort().reverse() : [];
      if (!files.length) return sendJson(res, 404, { error: 'No traces yet.' });
      const text = fs.readFileSync(path.join(config.runsDir, files[0]), 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${files[0]}"`, 'Cache-Control': 'no-store' });
      return res.end(text);
    }
    if (req.method === 'GET') return serveStatic(req, res);
    res.writeHead(405); res.end('Method not allowed');
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || 'Internal error' });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Giulia Local listening on http://${config.host}:${config.port}`);
  console.log(`Provider: ${provider.name} (${activeModel})`);
  if (provider.name === 'ollama') console.log(`Ollama: ${config.ollama.endpoint} · ctx=${config.ollama.numCtx} · keep_alive=${config.ollama.keepAlive}`);
  console.log('No web-search or browsing tools are exposed to Giulia.');
});
