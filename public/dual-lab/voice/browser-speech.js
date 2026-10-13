// Hosted fallback: speech playback and recognition are browser features, not a server model.
const recognitionConstructor = () => globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const abortError = () => new DOMException('Speech interrupted.', 'AbortError');
const langTag = value => ({ 'en-us': 'en-US', 'en-gb': 'en-GB', it: 'it-IT', ja: 'ja-JP', en: 'en-US', auto: 'en-US' }[value] || value || 'en-US');

export function hasBrowserSpeech() {
  return typeof globalThis.speechSynthesis !== 'undefined' && typeof globalThis.SpeechSynthesisUtterance === 'function';
}
export function hasBrowserRecognition() {
  return typeof recognitionConstructor() === 'function';
}
export function describeBrowserVoices() {
  if (!hasBrowserSpeech()) return [];
  const voices = globalThis.speechSynthesis.getVoices();
  if (!voices.length) return [{ id: 'browser:default', label: 'System default voice', backend: 'browser', default: true }];
  return voices.map(v => ({
    id: 'browser:' + v.voiceURI, label: v.name + ' · ' + v.lang, backend: 'browser', language: v.lang,
    agent: /^it/i.test(v.lang) ? 'giulia' : /^ja/i.test(v.lang) ? 'mei' : undefined,
    default: Boolean(v.default)
  }));
}
export class BrowserSpeech {
  constructor() { this.kind = 'browser'; this.activeCancel = null; this.listening = null; }
  async status() {
    if (!hasBrowserSpeech()) throw Error('This browser does not provide speech synthesis. Use a recent Chrome, Edge, or Safari, or connect a voice gateway.');
    return {
      schemaVersion: 1, voices: describeBrowserVoices(), browser: true,
      tts: { available: true, backend: 'browser-speech-synthesis', controls: ['pace'] },
      stt: { available: hasBrowserRecognition(), backend: 'browser-speech-recognition' }
    };
  }
  stop() {
    if (this.activeCancel) this.activeCancel();
    else if (hasBrowserSpeech()) globalThis.speechSynthesis.cancel();
  }
  async speak({ text, voice = 'browser:default', language = 'en-us', speech = {} }, { signal, onPlaying } = {}) {
    if (!hasBrowserSpeech()) throw Error('Browser text-to-speech is unavailable.');
    if (!String(text || '').trim()) return;
    if (signal?.aborted) throw abortError();
    this.stop();
    const synth = globalThis.speechSynthesis;
    const utterance = new globalThis.SpeechSynthesisUtterance(text);
    utterance.lang = langTag(language);
    utterance.rate = Math.max(.6, Math.min(1.5, Number(speech?.pace) || 1));
    const browserVoice = synth.getVoices().find(v => 'browser:' + v.voiceURI === voice);
    if (browserVoice) { utterance.voice = browserVoice; utterance.lang = browserVoice.lang; }
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = failure => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', abort);
        if (this.activeCancel === abort) this.activeCancel = null;
        utterance.onstart = utterance.onend = utterance.onerror = null;
        failure ? reject(failure) : resolve();
      };
      const abort = () => {
        synth.cancel();
        finish(abortError());
      };
      this.activeCancel = abort;
      utterance.onstart = () => onPlaying?.();
      utterance.onend = () => finish();
      utterance.onerror = event => finish(Error('Browser speech playback failed: ' + (event.error || 'unknown error')));
      signal?.addEventListener('abort', abort, { once: true });
      try { synth.speak(utterance); } catch (failure) { finish(failure); }
    });
  }
  listen({ language = 'auto', signal } = {}) {
    const Recognition = recognitionConstructor();
    if (!Recognition) throw Error('Browser speech recognition is not supported here. Type a turn or use a Whisper voice gateway.');
    if (signal?.aborted) throw abortError();
    this.abortListening();
    const recognition = new Recognition();
    recognition.lang = langTag(language);
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let rawTranscript = '';
    const promise = new Promise((resolve, reject) => {
      let finished = false;
      const finish = failure => {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', abort);
        recognition.onresult = recognition.onerror = recognition.onend = null;
        if (this.listening?.recognition === recognition) this.listening = null;
        failure ? reject(failure) : resolve({ rawTranscript, text: rawTranscript, backend: 'browser-speech-recognition' });
      };
      const abort = () => {
        try { recognition.abort(); } catch {}
        finish(abortError());
      };
      recognition.onresult = event => {
        rawTranscript = Array.from(event.results).map(result => result[0]?.transcript || '').join(' ').trim();
      };
      recognition.onerror = event => {
        if (event.error === 'aborted') return finish(abortError());
        finish(Error('Browser recognition failed: ' + (event.error || 'unknown error') + '. You may type instead.'));
      };
      recognition.onend = () => rawTranscript ? finish() : finish(Error('No speech recognized. Try again or type your turn.'));
      this.listening = { recognition, stop: () => recognition.stop(), abort };
      signal?.addEventListener('abort', abort, { once: true });
      try { recognition.start(); } catch (failure) { finish(failure); }
    });
    return promise;
  }
  stopListening() { this.listening?.stop(); }
  abortListening() { this.listening?.abort(); }
}
