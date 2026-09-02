import path from 'node:path';

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function getConfig(rootDir = process.cwd()) {
  return {
    rootDir,
    provider: process.env.GIULIA_PROVIDER || 'ollama',
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 8787),
    allowedOrigin: process.env.GIULIA_ALLOWED_ORIGIN || '*',
    labToken: process.env.GIULIA_LAB_TOKEN || '',
    ollama: {
      endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/chat',
      model: process.env.OLLAMA_MODEL || 'qwen3.5:9b',
      routerModel: process.env.OLLAMA_ROUTER_MODEL || process.env.OLLAMA_MODEL || 'qwen3.5:9b',
      numCtx: Number(process.env.OLLAMA_NUM_CTX || 8192),
      keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
      timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 120000)
    },
    qwen: {
      apiKey: process.env.DASHSCOPE_API_KEY || '',
      baseUrl: (process.env.QWEN_BASE_URL || '').replace(/\/$/, ''),
      model: process.env.QWEN_MODEL || 'qwen3.5:9b',
      routerModel: process.env.QWEN_ROUTER_MODEL || process.env.QWEN_MODEL || 'qwen3.5:9b',
      timeoutMs: Number(process.env.QWEN_TIMEOUT_MS || 90000)
    },
    promptsDir: path.join(rootDir, 'prompts'),
    knowledgeDir: path.join(rootDir, 'knowledge'),
    runsDir: path.join(rootDir, 'runs'),
    evalResultsDir: path.join(rootDir, 'eval-results'),
    devDiagnostics: boolEnv('GIULIA_DEV_DIAGNOSTICS', true),
    traceWrites: boolEnv('GIULIA_TRACE_WRITES', true)
  };
}
