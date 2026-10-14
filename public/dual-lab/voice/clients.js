import { loadConnections, endpointUrl } from '../backend-defaults.js';
export function validGateway(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Use an HTTP(S) service URL without credentials or query parameters.');
  return url.href.replace(/\/+$/, '');
}
function combinedSignal(signal, milliseconds) { return signal ? AbortSignal.any([signal, AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds); }
export async function callAgent(agent, messages, { signal } = {}) {
  const connection = loadConnections()[agent];
  if (!connection?.base) throw Error(`Connect ${agent} in the text lab's Internal lab tools first.`);
  const res = await fetch(endpointUrl(connection.base, '/api/chat'), { method: 'POST', signal: combinedSignal(signal, 240000),
    headers: { 'Content-Type': 'application/json', ...(connection.token ? { 'X-Giulia-Lab-Token': connection.token } : {}) },
    body: JSON.stringify({ messages }) });
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/x-ndjson')) {
    if (!res.ok) throw Error(`Agent HTTP ${res.status}`);
    if (!res.body) throw Error('Agent streaming response has no readable body.');
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buffer = '', result = null;
    const handle = line => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === 'error') throw Error(event.error || 'Agent stream failed.');
      if (event.type === 'result') result = event;
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) handle(line);
        if (done) break;
      }
      if (buffer.trim()) handle(buffer);
    } finally { reader.releaseLock(); }
    if (!result || typeof result.reply !== 'string' || !result.reply.trim()) {
      throw Error('Agent stream ended without a valid final reply.');
    }
    if (result.ok === false) throw Error(result.error || 'Agent response failed.');
    return result;
  }
  if (!type.includes('application/json')) throw Error(`Agent backend returned an unsupported response (HTTP ${res.status}). Check its connection.`);
  const data = await res.json();
  if (!res.ok || data.ok === false) throw Error(data.error || `Agent HTTP ${res.status}`);
  if (typeof data.reply !== 'string' || !data.reply.trim()) throw Error('Agent returned an empty final reply.');
  return data;
}
export class VoiceGateway {
  constructor(base, token = '') { this.base = validGateway(base); this.token = token; }
  async request(path, { signal, ...options } = {}) {
    let response;
    try { response = await fetch(this.base + path, { ...options, signal: combinedSignal(signal, path === '/v1/status' ? 8000 : 240000),
      headers: { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...options.headers } }); }
    catch (error) { if (signal?.aborted) throw error; throw Error('Voice backend unavailable. Text lab remains available. Check the service URL, browser permissions, and allowed origin.'); }
    if (!response.ok) { let data; try { data = await response.json(); } catch {} throw Error(data?.error || `Voice service HTTP ${response.status}`); }
    return response;
  }
  async status() { return (await this.request('/v1/status')).json(); }
  async synthesize({ text, voice, language, speech }, { signal } = {}) {
    const response = await this.request('/v1/tts', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice, language, speech }) });
    if (!response.headers.get('content-type')?.startsWith('audio/')) throw Error('Speech service returned no audio.');
    return { blob: await response.blob(), backend: response.headers.get('X-Voice-Backend') || 'gateway',
      generationMs: Number(response.headers.get('X-Generation-Ms')) || null, durationMs: Number(response.headers.get('X-Audio-Duration-Ms')) || null };
  }
  async transcribe(blob, { signal, language = 'auto' } = {}) {
    return (await this.request(`/v1/stt?language=${encodeURIComponent(language)}`, { method: 'POST', signal,
      headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob })).json();
  }
}
