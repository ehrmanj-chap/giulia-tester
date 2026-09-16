import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
process.chdir(rootDir);

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadDotEnv(path.join(rootDir, '.env'));

const config = {
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8791),
  allowedOrigin: process.env.MEI_ALLOWED_ORIGIN || '*',
  labToken: process.env.MEI_LAB_TOKEN || '',
  diagnostics: !['0', 'false', 'off', 'no'].includes(String(process.env.MEI_DEV_DIAGNOSTICS || 'true').toLowerCase()),
  qwen: {
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    baseUrl: String(process.env.QWEN_BASE_URL || '').replace(/\/$/, ''),
    model: process.env.QWEN_MODEL || 'qwen3.5:9b',
    timeoutMs: Number(process.env.QWEN_TIMEOUT_MS || 90000)
  }
};

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

const prompts = {
  core: readText(path.join(rootDir, 'prompts', 'core.md')),
  cultural: readText(path.join(rootDir, 'prompts', 'cultural.md')),
  business: readText(path.join(rootDir, 'prompts', 'business.md')),
  synthesis: readText(path.join(rootDir, 'prompts', 'synthesis.md'))
};

function walkDocs(dir, domain) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDocs(full, domain));
    else if (entry.isFile() && ['.md', '.txt'].includes(path.extname(entry.name).toLowerCase())) {
      const text = fs.readFileSync(full, 'utf8');
      out.push({
        domain,
        file: path.relative(rootDir, full).replaceAll('\\', '/'),
        title: text.match(/^#\s+(.+)$/m)?.[1]?.trim() || entry.name,
        text
      });
    }
  }
  return out;
}

const knowledge = [
  ...walkDocs(path.join(rootDir, 'knowledge', 'cultural'), 'cultural'),
  ...walkDocs(path.join(rootDir, 'knowledge', 'business'), 'business')
];

function tokenize(text) {
  return (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(t => t.length > 2);
}

function retrieve(domain, query, limit = 3) {
  const queryTokens = [...new Set(tokenize(query))];
  const candidates = knowledge.filter(doc => doc.domain === domain).map(doc => {
    const hay = doc.text.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (hay.includes(token)) score += token.length >= 7 ? 3 : 1;
    }
    const normalized = String(query).trim().toLowerCase();
    if (normalized.length >= 8 && hay.includes(normalized)) score += 10;
    return { ...doc, score };
  }).filter(doc => doc.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);

  return {
    selected: candidates.map(({ file, title, score }) => ({ file, title, score })),
    compiled: candidates.map(doc => `SOURCE: ${doc.title} (${doc.file})\n${doc.text}`).join('\n\n---\n\n')
  };
}

function sanitizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }))
    .slice(-30);
}

function latestUser(messages) {
  return [...messages].reverse().find(m => m.role === 'user')?.content || '';
}

function routeFor(messages) {
  const recent = messages.filter(m => m.role === 'user').slice(-3).map(m => m.content).join(' ').toLowerCase();
  const business = /(\bbusiness\b|\bcompan(?:y|ies)\b|\bwork(?:place)?\b|\boffice\b|\bmanager\b|\bmeeting\b|negotiat\w*|\bclient\b|\bprofessional\b|\bmarket\b|econom\w*|\btax\w*\b|\blegal\b|regulat\w*|\bhir(?:e|ing)\b|\bsalary\b|\bemployment\b|\bsupplier\b|\bcontract\b|\bcorporate\b|\bintern\w*|\bmanagement\b|\bdecision\w*|\bnemawashi\b|\bringi(?:sho)?\b|\bmeishi\b|business card|keigo at work|honorific at work)/.test(recent);
  const cultural = /(\bcultur\w*|\betiquette\b|\bsocial\b|\bfriend\w*|\bfamily\b|\breligion\w*|\bshinto\b|buddh\w*|\bshrine\b|\btemple\b|\btradition\w*|\bcustom\w*|\blanguage\b|japanese phrase|\bkeigo\b|\bgesture\w*|\bbow\w*|\bgift\w*|\bdining\b|\bfood\b|\bfestival\w*|\bregional\b|\bcommunication\b|\bsilence\b|\bhonne\b|\btatemae\b|\brelationship\w*|\bdating\b)/.test(recent);
  const explicitlyUnrelated = /\b(javascript|python|debug my code|weather forecast|solve this equation|minecraft|recipe for|medical diagnosis)\b/.test(recent);
  if (business && cultural) return 'both';
  if (business) return 'business';
  if (cultural) return 'cultural';
  if (explicitlyUnrelated) return 'out_of_scope';
  return 'cultural';
}

async function qwenComplete(messages, temperature = 0.2) {
  if (!config.qwen.apiKey) throw new Error('DASHSCOPE_API_KEY is missing.');
  if (!config.qwen.baseUrl) throw new Error('QWEN_BASE_URL is missing.');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.qwen.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(`${config.qwen.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.qwen.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: config.qwen.model, messages, temperature }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Qwen HTTP ${response.status}`);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Qwen returned no text content.');
    return {
      content,
      model: payload.model || config.qwen.model,
      usage: payload.usage || null,
      latencyMs: Date.now() - started
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runSpecialist(domain, messages, calls) {
  const query = messages.filter(m => m.role === 'user').slice(-3).map(m => m.content).join('\n');
  const retrieved = retrieve(domain, query);
  const system = [
    prompts.core,
    domain === 'cultural' ? prompts.cultural : prompts.business,
    `APPROVED ${domain.toUpperCase()} KNOWLEDGE:\n${retrieved.compiled || '(No directly relevant passage was retrieved for this turn.)'}`
  ].join('\n\n');

  const result = await qwenComplete([{ role: 'system', content: system }, ...messages], 0.25);
  calls.push({ role: domain, model: result.model, latencyMs: result.latencyMs, usage: result.usage, retrieval: retrieved.selected });
  return result.content;
}

async function chat(rawMessages) {
  const messages = sanitizeMessages(rawMessages);
  if (!messages.length || messages.at(-1).role !== 'user') throw new Error('A conversation ending with a user message is required.');

  const route = routeFor(messages);
  const runId = randomUUID();
  const calls = [];

  if (route === 'out_of_scope') {
    return {
      reply: 'I’m Mei, and this test build is scoped specifically to Japanese cultural and business intelligence. If you connect the question to Japan, I can help within that scope.',
      route,
      runId,
      calls
    };
  }

  let reply;
  if (route === 'cultural') {
    reply = await runSpecialist('cultural', messages, calls);
  } else if (route === 'business') {
    reply = await runSpecialist('business', messages, calls);
  } else {
    const [culturalDraft, businessDraft] = await Promise.all([
      runSpecialist('cultural', messages, calls),
      runSpecialist('business', messages, calls)
    ]);
    const synthesis = await qwenComplete([
      { role: 'system', content: `${prompts.core}\n\n${prompts.synthesis}` },
      {
        role: 'user',
        content: `Original user question:\n${latestUser(messages)}\n\nCULTURAL DRAFT:\n${culturalDraft}\n\nBUSINESS DRAFT:\n${businessDraft}`
      }
    ], 0.2);
    calls.push({ role: 'synthesis', model: synthesis.model, latencyMs: synthesis.latencyMs, usage: synthesis.usage, retrieval: null });
    reply = synthesis.content;
  }

  return { reply, route, runId, calls };
}

function corsHeaders(req) {
  const origin = req.headers.origin || '';
  const allowed = config.allowedOrigin.split(',').map(x => x.trim()).filter(Boolean);
  const value = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0] || '';
  return {
    ...(value ? { 'Access-Control-Allow-Origin': value } : {}),
    'Access-Control-Allow-Headers': 'Content-Type, X-Giulia-Lab-Token, X-Mei-Lab-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin'
  };
}

function authorized(req) {
  if (!config.labToken) return true;
  return req.headers['x-mei-lab-token'] === config.labToken || req.headers['x-giulia-lab-token'] === config.labToken;
}

function sendJson(req, res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(req) });
  res.end(JSON.stringify(payload));
}

async function readBody(req, maxBytes = 1_500_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      res.writeHead(204, corsHeaders(req));
      return res.end();
    }

    if (url.pathname.startsWith('/api/') && !authorized(req)) {
      return sendJson(req, res, 401, { error: 'Invalid or missing Mei lab token.' });
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      if (!config.qwen.apiKey || !config.qwen.baseUrl) {
        return sendJson(req, res, 503, {
          ok: false,
          agent: 'mei',
          error: 'Mei backend is running but hosted Qwen is not configured.',
          missing: [!config.qwen.apiKey && 'DASHSCOPE_API_KEY', !config.qwen.baseUrl && 'QWEN_BASE_URL'].filter(Boolean)
        });
      }
      const cultural = knowledge.filter(d => d.domain === 'cultural');
      const business = knowledge.filter(d => d.domain === 'business');
      return sendJson(req, res, 200, {
        ok: true,
        agent: 'mei',
        provider: 'qwen',
        model: config.qwen.model,
        routerModel: 'local-heuristic-v1',
        knowledge: {
          cultural: { documents: cultural.length },
          business: { documents: business.length }
        }
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = JSON.parse(await readBody(req) || '{}');
      const result = await chat(body.messages);
      const payload = {
        reply: result.reply,
        route: result.route,
        model: config.qwen.model,
        runId: result.runId
      };
      if (config.diagnostics) payload.diagnostics = { agent: 'mei', calls: result.calls };
      return sendJson(req, res, 200, payload);
    }

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders(req) });
      return res.end('Mei cultural-agent backend. Use /api/status and /api/chat.');
    }

    return sendJson(req, res, 404, { error: 'Not found.' });
  } catch (error) {
    console.error(error);
    return sendJson(req, res, 500, { error: error?.message || 'Internal error.' });
  }
});

server.listen(config.port, config.host, () => {
  const culturalCount = knowledge.filter(d => d.domain === 'cultural').length;
  const businessCount = knowledge.filter(d => d.domain === 'business').length;
  console.log(`Mei listening on http://${config.host}:${config.port}`);
  console.log(`Qwen model: ${config.qwen.model}`);
  console.log(`Knowledge: cultural=${culturalCount} docs, business=${businessCount} docs`);
  console.log(`Remote lab auth: ${config.labToken ? 'token required' : 'open (MEI_LAB_TOKEN unset)'}`);
});
