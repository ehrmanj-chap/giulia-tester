import test from 'node:test';
import assert from 'node:assert/strict';
import { backendOrigin, voiceProxy } from '../lib/voice-cloud-proxy.mjs';

const env = Object.freeze({
  VOICE_BACKEND_URL: 'https://chapman-voices.example',
  VOICE_BACKEND_TOKEN: 'private-cloud-token-00000000001',
  VOICE_DEMO_ACCESS_TOKEN: 'browser-demo-access-0000000001',
});
const url = suffix => 'https://lab.example/api/voice/v1/' + suffix;
const bearer = { authorization: 'Bearer ' + env.VOICE_DEMO_ACCESS_TOKEN };
const jsonResult = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('fail closed without backend credentials or access gate', async () => {
  const call = new Request(url('status'), { headers: bearer });
  const r = await voiceProxy(call, 'status', { env: {} });
  assert.equal(r.status, 503);
});
test('reject unknown methods and origins before calling upstream', async () => {
  let called = 0; const fetchImpl = () => { called++; throw Error('must not call'); };
  const result = await voiceProxy(new Request(url('status'), { method: 'POST' }), 'status', { env, fetchImpl });
  assert.equal(result.status, 405);
  const badOrigin = await voiceProxy(new Request(url('tts'), { method: 'POST', body: '{}', headers: { ...bearer, origin: 'https://evil.example' } }), 'tts', { env, fetchImpl });
  assert.equal(badOrigin.status, 403);
  assert.equal(called, 0);
});
test('refuse incorrect user token without disclosing Modal authorization', async () => {
  const fetchImpl = () => { throw Error('upstream must not be contacted'); };
  const result = await voiceProxy(new Request(url('status'), { headers: { authorization: 'Bearer wrong' } }), 'status', { env, fetchImpl });
  assert.equal(result.status, 401);
  assert.ok(!JSON.stringify(await result.json()).includes(env.VOICE_BACKEND_TOKEN));
});
test('public client sees only voice metadata, Modal receives its separate service token', async () => {
  let call;
  const fetchImpl = (upstream, options) => {
    call = { upstream, options };
    return jsonResult({ schemaVersion: 1, tts: { backend: 'kokoro-onnx / optional Seed-VC' },
      voices: [{ id: 'giulia-blend', agent: 'giulia', label: 'Giulia' }] });
  };
  const r = await voiceProxy(new Request(url('status'), { headers: bearer }), 'status', { env, fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(call.upstream, 'https://chapman-voices.example/v1/status');
  assert.equal(call.options.headers.Authorization, 'Bearer ' + env.VOICE_BACKEND_TOKEN);
  assert.equal((await r.json()).voices[0].agent, 'giulia');
  assert.equal(r.headers.get('cache-control'), 'no-store, private');
});
test('WAV binary is preserved byte-for-byte, including safe inference headers', async () => {
  let call;
  const original = new Uint8Array([82, 73, 70, 70, 0, 255, 128]);
  const fetchImpl = (upstream, options) => {
    call = { upstream, options };
    return new Response(original, { headers: {
      'Content-Type': 'audio/wav', 'X-Generation-Ms': '1234',
      'X-Voice-Backend': 'kokoro-onnx', 'X-Audio-Duration-Ms': '1450',
    } });
  };
  const text = JSON.stringify({ text: 'Ciao', voice: 'giulia-blend', language: 'en-us' });
  const r = await voiceProxy(new Request(url('tts'), { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: text }), 'tts', { env, fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(call.upstream, 'https://chapman-voices.example/v1/tts');
  assert.equal(Buffer.from(call.options.body).toString(), text);
  assert.deepEqual(new Uint8Array(await r.arrayBuffer()), original);
  assert.equal(r.headers.get('X-Generation-Ms'), '1234');
  assert.equal(r.headers.get('X-Voice-Backend'), 'kokoro-onnx');
});
test('STT forwards microphone bytes and strictly validated language', async () => {
  let call;
  const bytes = new Uint8Array([1, 2, 3]);
  const fetchImpl = (target, options) => {
    call = { target, options };
    return jsonResult({ rawTranscript: ' raw  words ', backend: 'whisper-small' });
  };
  const request = new Request(url('stt') + '?language=ja', { method: 'POST', headers: { ...bearer, 'Content-Type': 'audio/webm' }, body: bytes });
  const r = await voiceProxy(request, 'stt', { env, fetchImpl });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).rawTranscript, ' raw  words ');
  assert.equal(call.target, 'https://chapman-voices.example/v1/stt?language=ja');
  assert.equal(call.options.headers['Content-Type'], 'audio/webm');
  assert.deepEqual(new Uint8Array(call.options.body), bytes);
});
test('voice gateway refuses overly large browser audio before expensive inference', async () => {
  const tooBig = new Uint8Array(3_501_000);
  const req = new Request(url('stt'), { method: 'POST', headers: bearer, body: tooBig });
  const result = await voiceProxy(req, 'stt', { env, fetchImpl: () => { throw Error('should not run'); } });
  assert.equal(result.status, 413);
});
test('unknown STT languages do not contact Modal', async () => {
  const req = new Request(url('stt') + '?language=../../secrets', { method: 'POST', headers: bearer, body: 'abc' });
  const result = await voiceProxy(req, 'stt', { env, fetchImpl: () => { throw Error('should not run'); } });
  assert.equal(result.status, 400);
});
test('cloud failure is surfaced without silently selecting browser voices', async () => {
  const result = await voiceProxy(new Request(url('status'), { headers: bearer }), 'status',
    { env, fetchImpl: () => { throw Error('cloud connection error'); } });
  assert.equal(result.status, 503);
  assert.match((await result.json()).error, /No generic voice was substituted/);
});
test('reject SSRF-style backend URLs and untrusted redirects', async () => {
  for (const value of ['http://localhost:8792', 'https://user:secret@example.org', 'https://modal.example/hidden', 'https://modal.example?token=foo']) {
    assert.throws(() => backendOrigin(value));
  }
  const result = await voiceProxy(new Request(url('status'), { headers: bearer }), 'status',
    { env: { ...env, VOICE_BACKEND_URL: 'http://127.0.0.1:8792' }, fetchImpl: () => { throw Error('should not run'); } });
  assert.equal(result.status, 503);
});
test('unexpected cloud response types cannot be mislabeled as speech audio', async () => {
  const req = new Request(url('tts'), { method: 'POST', headers: bearer, body: '{"text":"hi"}' });
  const r = await voiceProxy(req, 'tts', { env, fetchImpl: () => new Response('not audio', { headers: { 'Content-Type': 'text/html' } }) });
  assert.equal(r.status, 502);
});
