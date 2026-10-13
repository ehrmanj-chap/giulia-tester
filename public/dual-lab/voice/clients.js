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
  if (!res.headers.get('content-type')?.includes('application/json')) throw Error('Agent backend returned a non-JSON response. Check its connection.');
  const data = await res.json(); if (!res.ok) throw Error(data.error || `Agent HTTP ${res.status}`); return data;
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
