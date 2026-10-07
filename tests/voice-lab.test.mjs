import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { VoiceSession, canonicalMessages, nextSpeaker, normalizeTranscript, speechSegments, speechSpec } from '../public/dual-lab/voice/core.js';
import { microphoneError } from '../public/dual-lab/voice/audio.js';
import { VoiceGateway, callAgent, validGateway } from '../public/dual-lab/voice/clients.js';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
const make = overrides => new VoiceSession({ model: async () => ({ reply: 'A concrete new contribution.' }), renderSpeech: async () => {}, transcribe: async () => ({ rawTranscript: ' Hello,  Giulia. ' }), ...overrides });

test('AI-to-AI preserves exact canonical text and speaker roles without ASR', async () => {
  let asr = 0; const requests = []; const original = 'Buongiorno!  A\nprecise answer: 42.';
  const s = make({ model: async (agent, messages) => { requests.push({ agent, messages }); return { reply: original }; }, transcribe: () => asr++ });
  s.start(); await s.advance(); await s.advance();
  assert.equal(requests[0].agent, 'giulia'); assert.equal(requests[1].agent, 'mei');
  assert.equal(requests[1].messages.at(-1).content, original); assert.equal(asr, 0);
  assert.deepEqual(s.turns.map(t => t.participant), ['giulia', 'mei']);
  assert.ok(s.turns.every(t => t.id && t.sessionId === s.id));
});
test('human audio preserves raw transcript, normalizes whitespace, and enters regular model contract', async () => {
  const requests = []; const s = make({ options: { mode: 'human-ai', agent: 'mei' }, model: async (agent, messages) => { requests.push({ agent, messages }); return { reply: 'Welcome.' }; } });
  const human = await s.humanAudio(new Blob(['audio'])); await s.advance();
  assert.equal(human.rawTranscript, ' Hello,  Giulia. '); assert.equal(human.normalizedTranscript, 'Hello, Giulia.');
  assert.equal(requests[0].messages.at(-1).content, 'Hello, Giulia.'); assert.equal(requests[0].agent, 'mei');
});
test('human mode waits for a recording instead of opening with an invented human turn', async () => {
  const s = make({ options: { mode: 'human-ai' } }); s.start(); await s.advance(); assert.equal(s.state, 'waiting-human'); assert.equal(s.turns.length, 0);
});
test('maximum AI turns stops, counting human participation separately', async () => {
  const s = make({ options: { maxTurns: 2 } }); s.start(); await s.advance(); await s.advance(); await s.advance();
  assert.equal(s.turns.length, 2); assert.equal(s.reason, 'Maximum turns reached');
});
test('manual stop ignores a late model result', async () => {
  const d = deferred(); const s = make({ model: () => d.promise }); s.start(); const pending = s.advance(); s.stop(); d.resolve({ reply: 'Too late' }); await pending;
  assert.equal(s.turns.length, 0); assert.equal(s.state, 'stopped');
});
test('pause discards pending model output and resume works', async () => {
  const d = deferred(); const s = make({ model: () => d.promise }); s.start(); const pending = s.advance(); s.pause(); d.resolve({ reply: 'Stale' }); await pending;
  assert.equal(s.turns.length, 0); s.model = async () => ({ reply: 'Fresh' }); s.resume(); await s.advance(); assert.equal(s.turns[0].text, 'Fresh');
});
test('barge-in aborts synthesis without deleting canonical response', async () => {
  const d = deferred(); const s = make({ renderSpeech: async (turn, { signal }) => { await d.promise; if (signal.aborted) throw new DOMException('Aborted', 'AbortError'); } });
  s.start(); const pending = s.advance(); await new Promise(r => setTimeout(r, 0)); s.interrupt(); d.resolve(); await pending;
  assert.equal(s.turns[0].text, 'A concrete new contribution.'); assert.equal(s.turns[0].audioStatus, 'interrupted'); assert.equal(s.state, 'waiting-human');
});
test('a TTS failure preserves the transcript and allows a subsequent turn', async () => {
  const s = make({ renderSpeech: async () => { throw Error('offline'); } }); s.start(); await s.advance(); await s.advance();
  assert.equal(s.turns.length, 2); assert.equal(s.turns[0].errors[0].stage, 'tts'); assert.equal(s.turns[0].audioStatus, 'failed');
});
test('STT failure can be retried without a phantom transcript turn', async () => {
  let calls = 0; const s = make({ transcribe: async () => { if (!calls++) throw Error('bad audio'); return { rawTranscript: 'Please try again.' }; } });
  await assert.rejects(s.humanAudio(new Blob()), /bad audio/); assert.equal(s.turns.length, 0);
  await s.humanAudio(new Blob()); assert.equal(s.turns.length, 1); assert.equal(s.turns[0].participant, 'human');
});
test('late STT response cannot appear after reset/stop', async () => {
  const d = deferred(); const s = make({ transcribe: () => d.promise }); const pending = s.humanAudio(new Blob()); s.stop(); d.resolve({ rawTranscript: 'Late' }); await pending;
  assert.equal(s.turns.length, 0); assert.equal(s.state, 'stopped');
});
test('overlapping advance calls cannot reorder or duplicate turns', async () => {
  const d = deferred(); let calls = 0; const s = make({ model: () => { calls++; return d.promise; } }); s.start(); const a = s.advance(), b = s.advance(); d.resolve({ reply: 'One' }); await Promise.all([a, b]); assert.equal(calls, 1); assert.equal(s.turns.length, 1);
});
test('three-way next speaker is contextual, including direct human address', () => {
  const options = { mode: 'ai-ai-human', startingSpeaker: 'mei' };
  assert.equal(nextSpeaker([], options), 'mei');
  assert.equal(nextSpeaker([{ participant: 'giulia', text: 'What do you think, Jordan?' }], options), 'human');
  assert.equal(nextSpeaker([{ participant: 'mei', text: 'Jordan, your perspective would help.' }], options), 'human');
  assert.equal(nextSpeaker([{ participant: 'human', text: 'Mei, explain that.' }], options), 'mei');
  assert.equal(nextSpeaker([{ participant: 'mei', text: 'A point.' }, { participant: 'human', text: 'Can you elaborate?' }], options), 'mei');
});
test('sustained repeated ideas stop an autonomous loop', async () => {
  const s = make({ options: { maxTurns: 20 } }); s.start(); for (let i = 0; i < 10; i++) await s.advance(); assert.equal(s.state, 'stopped'); assert.match(s.reason, /low novelty/);
});
test('human may decline a three-way invitation by resuming the AI discussion', async () => {
  const s = make({ options: { mode: 'ai-ai-human' }, model: async agent => ({ reply: agent === 'giulia' ? 'What do you think, Jordan?' : 'Here is another useful detail.' }) });
  s.start(); await s.advance(); await s.advance(); assert.equal(s.state, 'waiting-human');
  s.resume(); await s.advance(); assert.equal(s.turns.at(-1).participant, 'mei');
});
test('text and normal backend behavior remain independent from mode selection', () => {
  const app = fs.readFileSync(new URL('../public/dual-lab/app.js', import.meta.url), 'utf8');
  assert.ok(!app.includes('voice/')); const a = make(), b = make({ options: { mode: 'human-ai' } }); a.newTurn('giulia', 'Hello'); assert.equal(b.turns.length, 0);
  assert.ok(!fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8').includes('voice-service'));
});
test('bilingual segments retain fixed text order and language annotations only for rendering', () => {
  const text = 'Hello. [[it]]Buongiorno, Giulia![[/it]] And [[ja]]ありがとうございます。[[/ja]]';
  const parts = speechSegments(text); assert.deepEqual(parts.map(s => s.language), ['en-us', 'it', 'en-us', 'ja']); assert.equal(parts[1].text, 'Buongiorno, Giulia!');
  assert.equal(canonicalMessages([{ participant: 'human', text }], 'giulia', {})[1].content, text);
});
test('long paragraphs chunk without dropping words or splitting emoji', () => {
  const text = 'A long paragraph with numbers 9:15 and abbreviations Dr. Rossi. '.repeat(25) + '😀'.repeat(200);
  const parts = speechSegments(text); assert.ok(parts.every(p => p.text.length <= 260));
  assert.equal(parts.map(p => p.text).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.ok(parts.every(p => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p.text)));
});
test('microphone denial and missing hardware give retry/upload instructions', () => {
  assert.match(microphoneError({ name: 'NotAllowedError' }), /denied.*try again.*upload/); assert.match(microphoneError({ name: 'NotFoundError' }), /No microphone.*upload/);
});
test('normalized speech supports extensible prosody without requiring a provider format', () => {
  assert.equal(speechSpec({ pace: 50 }).pace, 1.5); assert.equal(speechSpec({ tone: 'friendly disagreement' }).tone, 'friendly disagreement'); assert.equal(normalizeTranscript('a \n b'), 'a b');
});
test('gateway validates URLs and degrades gracefully when unavailable', async () => {
  assert.throws(() => validGateway('file:///tmp/voice')); assert.throws(() => validGateway('https://user:secret@example.com')); assert.throws(() => validGateway('https://example.com?token=secret'));
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError('network'); };
  try { await assert.rejects(new VoiceGateway('http://127.0.0.1:1').status(), /Text lab remains available/); } finally { globalThis.fetch = original; }
});
test('gateway preserves microphone bytes and separates authorization from agent tokens', async () => {
  const original = globalThis.fetch; let seen;
  globalThis.fetch = async (url, opts) => { seen = { url, opts }; return new Response(JSON.stringify({ rawTranscript: 'Hi' }), { headers: { 'Content-Type': 'application/json' } }); };
  const blob = new Blob(['wave'], { type: 'audio/webm' });
  try { await new VoiceGateway('http://localhost:8792', 'voice-token').transcribe(blob, { language: 'ja' }); assert.equal(seen.opts.body, blob); assert.equal(seen.opts.headers.Authorization, 'Bearer voice-token'); assert.ok(seen.url.endsWith('language=ja')); } finally { globalThis.fetch = original; }
});
test('agent adapter uses existing connection settings and exact message payload', async () => {
  const originalFetch = globalThis.fetch, originalStorage = globalThis.localStorage; let seen;
  globalThis.localStorage = { getItem: () => JSON.stringify({ giulia: { base: 'https://lab.example', token: 'agent-token' } }) };
  globalThis.fetch = async (url, opts) => { seen = { url, opts }; return new Response(JSON.stringify({ reply: 'Ciao' }), { headers: { 'Content-Type': 'application/json' } }); };
  const messages = [{ role: 'user', content: 'An exact  message.' }];
  try { await callAgent('giulia', messages); assert.equal(seen.url, 'https://lab.example/api/chat'); assert.deepEqual(JSON.parse(seen.opts.body), { messages }); assert.equal(seen.opts.headers['X-Giulia-Lab-Token'], 'agent-token'); } finally { globalThis.fetch = originalFetch; globalThis.localStorage = originalStorage; }
});
test('session export excludes audio objects and includes raw/normalized text and errors', async () => {
  const s = make(); const turn = await s.humanAudio(new Blob()); turn.audio = [{ blob: new Blob(), url: 'blob:private' }]; const report = s.report(); assert.equal(report.turns[0].audio, undefined); assert.equal(report.turns[0].rawTranscript, ' Hello,  Giulia. '); assert.ok(!JSON.stringify(report).includes('blob:private'));
});
