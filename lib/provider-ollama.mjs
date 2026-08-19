export class OllamaProvider {
  constructor(config) {
    this.name = 'ollama';
    this.config = config;
  }

  async complete({ model, messages, temperature = 0.2, json = false }) {
    const cfg = this.config.ollama;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: model || cfg.model,
          messages,
          stream: false,
          keep_alive: cfg.keepAlive,
          ...(json ? { format: 'json' } : {}),
          options: {
            temperature,
            num_ctx: cfg.numCtx
          }
        })
      });

      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); }
      catch { throw new Error(`Ollama returned non-JSON response (${response.status}): ${text.slice(0, 500)}`); }

      if (!response.ok) {
        throw new Error(payload?.error || `Ollama HTTP ${response.status}`);
      }

      const content = payload?.message?.content;
      if (typeof content !== 'string') throw new Error('Ollama response did not contain message.content.');

      return {
        content,
        model: payload.model || model || cfg.model,
        latencyMs: Date.now() - started,
        usage: {
          promptTokens: payload.prompt_eval_count ?? null,
          completionTokens: payload.eval_count ?? null
        },
        raw: payload
      };
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`Ollama timed out after ${cfg.timeoutMs}ms.`);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
