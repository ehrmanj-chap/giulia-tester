export class QwenProvider {
  constructor(config) { this.config = config; this.name = 'qwen'; }

  async complete({ messages, model, temperature = 0.2, responseFormat = null }) {
    const { apiKey, baseUrl, timeoutMs } = this.config.qwen;
    if (!apiKey) throw new Error('DASHSCOPE_API_KEY is missing.');
    if (!baseUrl) throw new Error('QWEN_BASE_URL is missing.');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();
    try {
      const body = { model: model || this.config.qwen.model, messages, temperature };
      if (responseFormat) body.response_format = responseFormat;
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Qwen API error: ${payload?.error?.message || payload?.message || `HTTP ${response.status}`}`);
      const content = payload?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('Qwen returned no text content.');
      return { content, model: payload.model || model || this.config.qwen.model, usage: payload.usage || null, latencyMs: Date.now() - started, rawId: payload.id || null };
    } finally { clearTimeout(timer); }
  }
}
