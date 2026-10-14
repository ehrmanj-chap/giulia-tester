// Vercel same-origin proxy. Private Modal token never reaches the browser.
//
// Pilot gate: VOICE_DEMO_ACCESS_TOKEN is a separately issued, temporary access
// code. The gate is fail-closed when unset. It is not scalable user auth;
// production must add authenticated users and distributed quotas.
import { createHash, timingSafeEqual } from 'node:crypto';

const PATHS = Object.freeze({ status: '/v1/status', tts: '/v1/tts', stt: '/v1/stt' });
const BODY_LIMIT = 3_500_000; // Below Vercel's incoming payload limit; large STT needs object storage.
const UPSTREAM_TIMEOUT_MS = 70_000;
const noStore = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };

function response(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...noStore, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function constantTimeEqual(left, right) {
  const a = createHash('sha256').update(String(left || '')).digest();
  const b = createHash('sha256').update(String(right || '')).digest();
  return timingSafeEqual(a, b);
}
export function backendOrigin(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      (url.pathname !== '/' && url.pathname !== '') || !url.hostname) {
    throw new Error('Voice backend must be a root HTTPS origin.');
  }
  return url.origin;
}
export async function voiceProxy(request, route, { env = process.env, fetchImpl = fetch } = {}) {
  if (!(route in PATHS)) return response(404, 'Unknown speech route.');
  if (request.method !== (route === 'status' ? 'GET' : 'POST')) return response(405, 'Method not allowed.');

  // Only the application origin can issue browser requests. Auth is still
  // required; Origin is not an authentication mechanism.
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return response(403, 'Cross-origin speech request rejected.');

  const clientKey = env.VOICE_DEMO_ACCESS_TOKEN || '';
  const upstreamKey = env.VOICE_BACKEND_TOKEN || '';
  const backend = env.VOICE_BACKEND_URL || '';
  if (clientKey.length < 24 || upstreamKey.length < 24 || !backend) {
    return response(503, 'Hosted Kokoro is not configured. Contact the lab administrator.');
  }
  const authorization = request.headers.get('authorization') || '';
  if (!constantTimeEqual(authorization, 'Bearer ' + clientKey)) return response(401, 'Invalid lab voice access token.');

  let endpoint;
  try { endpoint = backendOrigin(backend) + PATHS[route]; }
  catch { return response(503, 'Hosted speech backend URL is invalid.'); }
  if (route === 'stt') {
    const lang = new URL(request.url).searchParams.get('language') || 'auto';
    if (!['auto', 'en', 'it', 'ja'].includes(lang)) return response(400, 'Unsupported recognition language.');
    endpoint += '?language=' + encodeURIComponent(lang);
  }

  let bytes;
  if (route !== 'status') {
    const declared = Number(request.headers.get('content-length') || '0');
    if (declared > BODY_LIMIT) return response(413, 'Speech audio exceeds the 3.5 MB browser upload limit.');
    try { bytes = await request.arrayBuffer(); }
    catch { return response(400, 'Speech request could not be read.'); }
    if (!bytes.byteLength || bytes.byteLength > BODY_LIMIT) return response(413, 'Invalid or oversized speech request.');
  }
  const method = route === 'status' ? 'GET' : 'POST';
  let upstream;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]);
    upstream = await fetchImpl(endpoint, {
      method, signal,
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + upstreamKey,
        ...(route === 'tts' ? { 'Content-Type': 'application/json' } :
            route === 'stt' ? { 'Content-Type': request.headers.get('content-type') || 'application/octet-stream' } : {}),
      },
      ...(bytes ? { body: bytes } : {}),
    });
  } catch {
    return response(503, 'Hosted speech is unavailable. No generic voice was substituted.');
  }

  if (!upstream.ok) {
    let problem;
    try { const body = await upstream.json(); problem = body.error || body.detail; } catch {}
    // Avoid surfacing internal service details or private paths.
    if (upstream.status === 401 || upstream.status === 403) return response(503, 'Cloud speech authentication is misconfigured.');
    if (upstream.status === 429) return response(429, 'Speech inference is busy. Please retry shortly.');
    if (upstream.status === 400 || upstream.status === 413) return response(upstream.status, String(problem || 'Invalid speech request.').slice(0, 180));
    return response(503, 'Speech inference failed; original text remains available.');
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (route === 'tts' && !contentType.startsWith('audio/')) return response(502, 'Speech inference returned no audio.');
  if (route !== 'tts' && !contentType.includes('application/json')) return response(502, 'Unexpected speech service response.');
  const binary = await upstream.arrayBuffer();
  // Do not cache generated audio, and never expose the upstream authorization token.
  const headers = {
    ...noStore,
    'Content-Type': route === 'tts' ? 'audio/wav' : 'application/json; charset=utf-8',
  };
  if (route === 'tts') {
    for (const name of ['X-Generation-Ms', 'X-Audio-Duration-Ms', 'X-Voice-Backend']) {
      const value = upstream.headers.get(name);
      if (value && value.length < 128) headers[name] = value;
    }
  }
  return new Response(binary, { status: 200, headers });
}
