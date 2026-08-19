import { OllamaProvider } from './provider-ollama.mjs';
import { QwenProvider } from './provider-qwen.mjs';
import { MockProvider } from './provider-mock.mjs';

export function createProvider(config) {
  if (config.provider === 'ollama') return new OllamaProvider(config);
  if (config.provider === 'qwen') return new QwenProvider(config);
  if (config.provider === 'mock') return new MockProvider(config);
  throw new Error(`Unknown GIULIA_PROVIDER: ${config.provider}`);
}
