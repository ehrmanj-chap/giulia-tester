import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BrowserSpeech, hasBrowserSpeech, hasBrowserRecognition, describeBrowserVoices } from '../public/dual-lab/voice/browser-speech.js';

const oldGlobals = () => ({
  speechSynthesis: globalThis.speechSynthesis,
  SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance,
  SpeechRecognition: globalThis.SpeechRecognition,
  webkitSpeechRecognition: globalThis.webkitSpeechRecognition
});
const restore = old => { for (const [key, value] of Object.entries(old)) {
  if (value === undefined) delete globalThis[key];
  else globalThis[key] = value;
} };

test('browser voice status discovers native voices without a Python gateway', async () => {
  const old = oldGlobals();
  try {
    globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    const spoken = [];
    globalThis.speechSynthesis = {
      getVoices: () => [{ name: 'English Test Voice', lang: 'en-US', voiceURI: 'en-test', default: true }, { name: 'Italian Test Voice', lang: 'it-IT', voiceURI: 'it-test' }],
      cancel() {},
      speak(utterance) { spoken.push(utterance); queueMicrotask(() => { utterance.onstart?.(); utterance.onend?.(); }); }
    };
    assert.equal(hasBrowserSpeech(), true);
    assert.equal(describeBrowserVoices().find(v => v.id === 'browser:it-test').agent, 'giulia');
    const browser = new BrowserSpeech();
    const status = await browser.status();
    assert.equal(status.schemaVersion, 1);
    assert.equal(status.tts.backend, 'browser-speech-synthesis');
    assert.equal(status.voices.length, 2);
    let started = 0;
    await browser.speak({ text: 'Buongiorno', voice: 'browser:it-test', language: 'it', speech: { pace: 1.25 } }, { onPlaying: () => started++ });
    assert.equal(started, 1);
    assert.equal(spoken[0].text, 'Buongiorno');
    assert.equal(spoken[0].voice.lang, 'it-IT');
    assert.equal(spoken[0].rate, 1.25);
  } finally { restore(old); }
});

test('browser TTS cancellation rejects and never reports a completed clip', async () => {
  const old = oldGlobals();
  try {
    let cancels = 0;
    globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
    globalThis.speechSynthesis = { getVoices: () => [], cancel: () => cancels++, speak() {} };
    const browser = new BrowserSpeech();
    const controller = new AbortController();
    const pending = browser.speak({ text: 'Interrupt me.' }, { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
    assert.ok(cancels >= 1);
  } finally { restore(old); }
});

test('browser microphone speech recognition returns real backend label', async () => {
  const old = oldGlobals();
  try {
    class MockRecognition {
      start() { queueMicrotask(() => { this.onresult?.({ results: [[{ transcript: 'Mei, ' }], [{ transcript: 'hello!' }]] }); this.onend?.(); }); }
      stop() { this.onend?.(); }
      abort() {}
    }
    globalThis.SpeechRecognition = MockRecognition;
    assert.equal(hasBrowserRecognition(), true);
    const browser = new BrowserSpeech();
    const result = await browser.listen({ language: 'ja' });
    assert.equal(result.rawTranscript, 'Mei,  hello!');
    assert.equal(result.backend, 'browser-speech-recognition');
  } finally { restore(old); }
});

test('unsupported browser recognition is not silently replaced by typed content', async () => {
  const old = oldGlobals();
  try {
    delete globalThis.SpeechRecognition;
    delete globalThis.webkitSpeechRecognition;
    assert.equal(hasBrowserRecognition(), false);
    assert.throws(() => new BrowserSpeech().listen(), /not supported/);
  } finally { restore(old); }
});

test('hosted lab exposes navigation, five modes, readout and typed conversation fallback', () => {
  const dual = fs.readFileSync(new URL('../public/dual-lab/index.html', import.meta.url), 'utf8');
  const voice = fs.readFileSync(new URL('../public/dual-lab/voice/index.html', import.meta.url), 'utf8');
  assert.match(dual, /href="\.\/voice\/"/);
  for (const id of ['autoReadout', 'stopReadout', 'readoutLanguage']) assert.ok(dual.includes('id="' + id + '"'));
  for (const mode of ['tts', 'stt', 'human-ai', 'ai-ai', 'ai-ai-human']) assert.ok(voice.includes('value="' + mode + '"'));
  for (const id of ['speechEngine', 'sendTyped', 'typedTurn', 'gatewayToken']) assert.ok(voice.includes('id="' + id + '"'));
});
