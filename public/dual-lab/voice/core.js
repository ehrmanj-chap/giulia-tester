// No DOM or provider dependencies: canonical text is the source of truth.
export const AGENTS = Object.freeze({ giulia: { name: 'Giulia', language: 'it' }, mei: { name: 'Mei', language: 'ja' } });
export const MODES = ['tts', 'stt', 'human-ai', 'ai-ai', 'ai-ai-human'];
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = () => performance.now();
export const normalizeTranscript = text => String(text).replace(/\s+/gu, ' ').trim();
export function speechSpec(value = {}) {
  const bounded = (key, fallback, min, max) => Number.isFinite(Number(value[key])) ? Math.min(max, Math.max(min, Number(value[key]))) : fallback;
  return { pace: bounded('pace', 1, .6, 1.5), pause_before_ms: bounded('pause_before_ms', 0, 0, 2000),
    seed: Math.trunc(bounded('seed', 24, 0, 2147483647)), tone: String(value.tone || '').slice(0, 100),
    energy: bounded('energy', .5, 0, 1), emphasis: Array.isArray(value.emphasis) ? value.emphasis.slice(0, 20) : [] };
}
// Explicit language markup affects rendering only; the original text is retained on the turn.
export function speechSegments(text, language = 'en-us', maxChars = 260) {
  if (!['en-us', 'en-gb', 'it', 'ja'].includes(language)) throw Error('Unsupported speech language.');
  const blocks = []; const tags = /\[\[(en-us|en-gb|it|ja)\]\]([\s\S]*?)\[\[\/\1\]\]/g;
  let offset = 0;
  for (const match of text.matchAll(tags)) {
    if (match.index > offset) blocks.push({ text: text.slice(offset, match.index), language });
    blocks.push({ text: match[2], language: match[1] }); offset = match.index + match[0].length;
  }
  if (offset < text.length) blocks.push({ text: text.slice(offset), language });
  const result = [];
  for (const block of blocks) {
    // Intl handles abbreviations and Japanese sentence boundaries; retain punctuation.
    const sentences = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(block.language, { granularity: 'sentence' }).segment(block.text)].map(s => s.segment)
      : block.text.match(/[^.!?。！？]+[.!?。！？]*\s*/gu) || [block.text];
    let buffer = '';
    const emit = () => { if (buffer.trim()) result.push({ text: buffer.trim(), language: block.language }); buffer = ''; };
    for (let sentence of sentences) {
      if ((buffer + sentence).length > maxChars) emit();
      while (sentence.length > maxChars) {
        let cut = sentence.lastIndexOf(' ', maxChars); if (cut < maxChars / 2) cut = maxChars;
        // Never split a surrogate pair.
        if (/[\uD800-\uDBFF]/.test(sentence[cut - 1])) cut--;
        result.push({ text: sentence.slice(0, cut).trim(), language: block.language }); sentence = sentence.slice(cut);
      }
      buffer += sentence;
    }
    emit();
  }
  return result.filter(s => s.text);
}
export function similarity(a, b) {
  const tokens = s => new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []));
  const x = tokens(a), y = tokens(b), union = new Set([...x, ...y]);
  return union.size ? [...x].filter(w => y.has(w)).length / union.size : 1;
}
export function nextSpeaker(turns, options) {
  const last = turns.at(-1);
  if (!last) return options.startingSpeaker || 'giulia';
  if (last.participant === 'human') {
    if (options.mode === 'human-ai') return options.agent || 'giulia';
    const direct = last.text.match(/\b(giulia|mei)\b/i)?.[1]?.toLowerCase();
    return direct || [...turns].reverse().find(t => t.participant !== 'human')?.participant || options.agent || 'giulia';
  }
  if (options.mode === 'human-ai') return 'human';
  if (options.mode === 'ai-ai-human' && /(?:\b(?:you|your|jordan|human)\b[^?。！？]{0,90}\?|(?:jordan|human)[,：:])/i.test(last.text)) return 'human';
  return last.participant === 'giulia' ? 'mei' : 'giulia';
}
export function canonicalMessages(turns, agent, options) {
  // Both existing backends bound their message histories; keep the session brief in that window.
  turns = turns.slice(-28);
  const context = [`Voice Lab discussion. You are ${AGENTS[agent].name}; keep your existing expertise and persona.`,
    options.topic && `Topic: ${options.topic}`, options.scenario && `Scenario: ${options.scenario}`,
    options.objective && `Goal: ${options.objective}`, options.opening && `Opening: ${options.opening}`,
    'Respond conversationally and concisely. Add a concrete new point, answer an open question, or offer a useful disagreement. Avoid generic praise, repeated summaries, and endless closing remarks.',
    options.mode === 'ai-ai-human' && 'The human can join. Address them directly when their input is needed; otherwise talk with the other expert.'
  ].filter(Boolean).join('\n');
  // Each other participant's content is passed byte-for-byte, never through ASR.
  // Speaker labels are carried separately in this contextual message.
  const roster = turns.map((t, i) => `${i + 1}: ${t.participant}`).join(', ');
  return [{ role: 'user', content: `${context}${roster ? `\nSpeaker order of the following turns: ${roster}` : ''}` },
    ...turns.map(t => ({ role: t.participant === agent ? 'assistant' : 'user', content: t.text }))];
}

export class VoiceSession {
  constructor({ model, renderSpeech, transcribe, onChange = () => {}, options = {} }) {
    this.model = model; this.renderSpeech = renderSpeech; this.transcribe = transcribe; this.onChange = onChange;
    this.options = { mode: 'ai-ai', agent: 'giulia', startingSpeaker: 'giulia', maxTurns: 8, ...options };
    if (!MODES.includes(this.options.mode)) throw Error('Unknown test mode.');
    this.options.maxTurns = Math.min(50, Math.max(1, Math.trunc(Number(this.options.maxTurns) || 8)));
    this.id = uid(); this.turns = []; this.events = []; this.state = 'idle'; this.reason = ''; this.epoch = 0; this.busy = false;
    this.metrics = { lowNovelty: 0 }; this.controller = null;
  }
  notify() { this.onChange(this); }
  event(type, detail = '') { this.events.push({ type, detail, at: new Date().toISOString() }); }
  start() { if (this.state === 'stopped') return; this.state = 'running'; this.reason = ''; this.notify(); }
  pause() { if (this.state === 'stopped') return; this.state = 'paused'; this.event('pause'); this.cancel(); this.notify(); }
  resume() { if (this.state !== 'paused' && this.state !== 'waiting-human') return; this.skipHumanOnce = this.state === 'waiting-human'; this.state = 'running'; this.notify(); }
  stop(reason = 'Manual stop') { this.state = 'stopped'; this.reason = reason; this.event('stop', reason); this.cancel(); this.notify(); }
  cancel() { this.epoch++; this.controller?.abort(); }
  interrupt() { this.event('interruption'); this.cancel(); this.state = 'waiting-human'; this.notify(); }
  newTurn(participant, text, extra = {}) {
    const turn = { id: uid(), sessionId: this.id, participant, text, createdAt: new Date().toISOString(), errors: [], timings: {}, ...extra };
    this.turns.push(turn); this.notify(); return turn;
  }
  async humanAudio(blob, { language = 'auto', speechEndedAt = now() } = {}) {
    if (this.state === 'stopped') throw Error('Start a new session before adding speech.');
    this.interrupt();
    const epoch = this.epoch, controller = new AbortController(); this.controller = controller;
    try {
      const data = await this.transcribe(blob, { language, signal: controller.signal });
      if (epoch !== this.epoch) return null;
      const raw = data.rawTranscript ?? data.text ?? '';
      const text = normalizeTranscript(raw); if (!text) throw Error('No speech detected. Please try again.');
      const turn = this.newTurn('human', text, { rawTranscript: raw, normalizedTranscript: text,
        sttBackend: data.backend, timings: { sttMs: now() - speechEndedAt }, inputStartedAt: speechEndedAt });
      this.state = this.options.mode === 'stt' ? 'idle' : 'running'; this.notify(); return turn;
    } catch (error) {
      if (epoch !== this.epoch) return null;
      this.event('stt-error', error.message); this.state = 'waiting-human'; this.notify(); throw error;
    }
  }
  async advance() {
    if (this.busy || this.state !== 'running') return null;
    this.options.maxTurns = Math.min(50, Math.max(1, Math.trunc(Number(this.options.maxTurns) || 8)));
    if (this.turns.filter(t => t.participant !== 'human').length >= this.options.maxTurns) { this.stop('Maximum turns reached'); return null; }
    let participant = nextSpeaker(this.turns, this.options);
    if (participant === 'human' && this.skipHumanOnce && this.options.mode === 'ai-ai-human') participant = this.turns.at(-1)?.participant === 'giulia' ? 'mei' : 'giulia';
    this.skipHumanOnce = false;
    if (participant === 'human' || (this.options.mode === 'human-ai' && !this.turns.length)) { this.state = 'waiting-human'; this.notify(); return null; }
    this.busy = true; const epoch = this.epoch, controller = new AbortController(); this.controller = controller;
    const started = now(), previous = this.turns.at(-1);
    const messages = canonicalMessages(this.turns, participant, this.options);
    try {
      const response = await this.model(participant, messages, { signal: controller.signal });
      if (epoch !== this.epoch) return null;
      if (typeof response.reply !== 'string' || !response.reply.trim()) throw Error('Agent returned an empty response.');
      const modelMs = now() - started;
      const turn = this.newTurn(participant, response.reply, { modelInput: messages, runId: response.runId, route: response.route,
        speech: speechSpec(response.speech), timings: { modelMs, modelResponseStartMs: null }, audioStatus: 'generating' });
      const sameSpeaker = this.turns.filter(t => t.participant === participant && t !== turn).at(-1);
      this.metrics.lowNovelty = sameSpeaker && similarity(sameSpeaker.text, turn.text) > .78 ? this.metrics.lowNovelty + 1 : 0;
      try { await this.renderSpeech(turn, { signal: controller.signal }); }
      catch (error) { turn.audioStatus = controller.signal.aborted ? 'interrupted' : 'failed'; if (!controller.signal.aborted) turn.errors.push({ stage: 'tts', message: error.message }); }
      turn.timings.totalMs = now() - (previous?.participant === 'human' ? previous.inputStartedAt ?? started : started);
      if (epoch === this.epoch) {
        if (this.turns.filter(t => t.participant !== 'human').length >= this.options.maxTurns) this.stop('Maximum turns reached');
        else if (this.metrics.lowNovelty >= 2) this.stop('Repeated ideas: sustained low novelty');
        else if (this.turns.length >= 4 && this.turns.slice(-2).every(t => /(?:that (?:covers|resolves)|we(?:'ve| have) (?:covered|agreed)|nothing (?:more|else) to add|let.s (?:leave|stop) (?:it |here))/i.test(t.text))) this.stop('Both speakers reached a natural conclusion');
      }
      return turn;
    } catch (error) {
      if (epoch === this.epoch) { this.event('model-error', error.message); this.state = 'paused'; this.reason = error.message; }
      return null;
    } finally { this.busy = false; this.notify(); }
  }
  report() {
    // Object URLs and monotonic internal anchors are meaningful only in the live tab.
    return { schemaVersion: 1, sessionId: this.id, state: this.state, reason: this.reason, options: this.options,
      turns: this.turns.map(({ audio, inputStartedAt, ...t }) => t), events: this.events };
  }
}
