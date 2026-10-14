/**
 * No-bill speech synthesis: Kokoro inference runs on each visitor's device.
 *
 * Uses the same PUBLIC seed style-vector interpolation as the Python gateway,
 * not Microsoft speechSynthesis or a paid inference endpoint.
 * Private Seed-VC reference-conditioned voices are NOT reproduced by this code.
 *
 * English: Kokoro-JS's bundled phonemizer.
 * Italian: ephone (eSpeak NG compiled to browser WASM; GPLv3-or-later).
 * Japanese: Open JTalk through kokoro-js-jp 0.2.0 (WASM + dictionary).
 * All languages keep the same original public style-vector blends.
 * The privately reference-conditioned Seed-VC identities are NOT included.
 *
 * Model: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
 * Library: https://github.com/hexgrad/kokoro/tree/main/kokoro.js
 */
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const VOICE_BASE = 'https://huggingface.co/' + MODEL_ID + '/resolve/main/voices/';
const KOKORO_ESM = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const JAPANESE_ESM = 'https://cdn.jsdelivr.net/npm/kokoro-js-jp@0.2.0/dist/kokoro-jp.web.js';
const ITALIAN_ESM = 'https://cdn.jsdelivr.net/npm/ephone@1.0.2/ephone.js';
const STYLE_DIM = 256;
const SAMPLE_RATE = 24000;
const MAX_TOKENS = 509;
const MAX_CHUNK = 260;

// A fused waveform that is too short for its transcript is almost certainly
// truncated. This conservative lower bound errs toward accepting fast speech.
export function minimumReasonableSpeechMs(segments, speed = 1) {
  const text = segments.map(s => s.text).join('');
  const japanese = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}々ー]/gu) || []).length;
  const latin = (text.match(/\p{Script=Latin}/gu) || []).length;
  return Math.max(400, Math.min(9500, (latin * 28 + japanese * 95) / speed));
}

// These are the existing checked-in seed BLENDS, not unrecoverable private reference voices.
export const SEED_PROFILES = Object.freeze({
  'giulia-blend': Object.freeze({
    id: 'giulia-blend',
    label: 'Giulia · Kokoro seed blend (if_sara / af_heart)',
    agent: 'giulia',
    backend: 'kokoro-on-device',
    default: true,
    styles: Object.freeze([{ name: 'if_sara', weight: .65 }, { name: 'af_heart', weight: .35 }]),
  }),
  'mei-blend': Object.freeze({
    id: 'mei-blend',
    label: 'Mei · Kokoro seed blend (jf_alpha / jf_nezumi)',
    agent: 'mei',
    backend: 'kokoro-on-device',
    default: true,
    styles: Object.freeze([{ name: 'jf_alpha', weight: .60 }, { name: 'jf_nezumi', weight: .40 }]),
  }),
});
export const BROWSER_KOKORO_LANGUAGES = Object.freeze(['en-us', 'en-gb', 'it', 'ja']);
export function normalizeItalianIPA(ipa) {
  if (typeof ipa !== 'string' || !ipa.trim()) throw Error('Italian phonemizer returned no IPA.');
  // Align eSpeak output with Misaki's multilingual Kokoro phoneme conventions.
  return ipa.trim().replace(/[\u200c\u200d]/gu,'')
    .replace(/d[\u0361\^]ʒ/gu,'ʤ').replace(/t[\u0361\^]ʃ/gu,'ʧ')
    .replace(/d[\u0361\^]z/gu,'ʣ').replace(/t[\u0361\^]s/gu,'ʦ')
    .replace(/\^/gu,'').replace(/\s+/gu,' ');
}
const abortError = () => new DOMException('Kokoro generation canceled.', 'AbortError');
const requireActive = signal => { if (signal?.aborted) throw abortError(); };

export function normalizeStyles(styles) {
  if (!Array.isArray(styles) || styles.length < 1 || styles.length > 4) {
    throw Error('Kokoro style mixture must contain between 1 and 4 source voices.');
  }
  const normalized = styles.map(style => {
    if (!/^[a-z]{1,2}_[a-z]+$/.test(style?.name || '')) throw Error('Invalid Kokoro voice style.');
    const weight = Number(style.weight);
    if (!Number.isFinite(weight) || weight <= 0) throw Error('Kokoro style weights must be positive and finite.');
    return { name: style.name, weight };
  });
  const total = normalized.reduce((sum, item) => sum + item.weight, 0);
  return normalized.map(item => ({ ...item, weight: item.weight / total }));
}

export function blendStyleRow(styles, voiceData, numberOfTokens) {
  const tokens = Math.max(0, Math.min(MAX_TOKENS, Math.trunc(numberOfTokens)));
  const sources = normalizeStyles(styles);
  const style = new Float32Array(STYLE_DIM);
  const offset = tokens * STYLE_DIM;
  for (const source of sources) {
    const voice = voiceData.get(source.name);
    if (!(voice instanceof Float32Array) || voice.length < offset + STYLE_DIM) {
      throw Error('Kokoro voice style vectors are missing or incomplete for ' + source.name + '.');
    }
    for (let i = 0; i < STYLE_DIM; i++) {
      style[i] += source.weight * voice[offset + i];
    }
  }
  return style;
}

export function encodePcm16Wav(samples, sampleRate = SAMPLE_RATE) {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw Error('Invalid PCM sample rate.');
  if (!samples || !samples.length || samples.length > 120 * sampleRate) throw Error('Invalid audio sample length.');
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (index, text) => { for (let i = 0; i < text.length; i++) view.setUint8(index + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const n = Number(samples[i]);
    if (!Number.isFinite(n)) throw Error('Kokoro returned invalid audio.');
    const value = Math.max(-1, Math.min(1, n));
    view.setInt16(44 + i * 2, value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export class OnDeviceKokoro {
  constructor({ onStatus = () => {}, loader = null, japaneseLoader = null, italianLoader = null, fetchImpl = null } = {}) {
    this.kind = 'ondevice';
    this.onStatus = onStatus;
    this.loader = loader || (() => import(KOKORO_ESM));
    this.japaneseLoader = japaneseLoader || (() => import(JAPANESE_ESM));
    this.italianLoader = italianLoader || (() => import(ITALIAN_ESM));
    this.japanesePromise = null;
    this.italianPromise = null;
    this.preloadPromise = null;
    this.fetchImpl = fetchImpl || ((...args) => fetch(...args));
    this.voiceCache = new Map();
    this.queue = Promise.resolve();
    this.modelPromise = null;
  }
  async status() {
    return {
      schemaVersion: 1, ok: true, browser: true,
      voices: Object.values(SEED_PROFILES).map(({ styles, ...publicProfile }) => publicProfile),
      tts: {
        backend: 'kokoro-on-device',
        available: true, controls: ['pace'], languages: [...BROWSER_KOKORO_LANGUAGES],
        modelId: MODEL_ID, firstRunDownloadsModel: true,
        phonemizers: { 'en-us':'Kokoro-JS', 'en-gb':'Kokoro-JS', 'it':'ephone WASM', 'ja':'Open JTalk WASM' },
        referenceConversion: false, streaming: false,
      },
      stt: { available: false, backend: 'none' },
      privacy: { inference: 'browser', textUploadedForTTS: false, voiceModelDownloadedFrom: 'Hugging Face' },
    };
  }
  async getModel() {
    if (!this.modelPromise) {
      this.modelPromise = (async () => {
        this.onStatus('Downloading browser Kokoro (~90 MB on first use). This runs on your own device.');
        const { KokoroTTS } = await this.loader();
        if (!KokoroTTS?.from_pretrained) throw Error('Kokoro browser module failed to load.');
        const model = await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: 'q8', device: 'wasm',
          progress_callback: progress => {
            if (progress?.status === 'progress' && typeof progress.progress === 'number' && progress.progress < 100) {
              this.onStatus('Loading Kokoro · ' + Math.round(progress.progress) + '%');
            }
          },
        });
        if (!model?.model || !model?.tokenizer || typeof model.generate !== 'function') {
          throw Error('Kokoro runtime is missing a model, tokenizer, or text phonemizer.');
        }
        this.onStatus('Kokoro loaded on this device · no cloud inference bill.');
        return model;
      })().catch(error => {
        this.modelPromise = null; // allow retry if a download or WebAssembly initialization fails
        throw error;
      });
    }
    return this.modelPromise;
  }
  async getItalian() {
    if (!this.italianPromise) {
      this.italianPromise = (async () => {
        this.onStatus('Loading Italian eSpeak phonemizer locally…');
        const library = await this.italianLoader();
        const createEphone = library.default || library.createEphone;
        if (typeof createEphone !== 'function' || !library.roa) throw Error('The Italian WASM phonemizer did not expose the expected ephone API.');
        const engine = await createEphone(library.roa);
        if (typeof engine.setVoice !== 'function' || typeof engine.textToIpa !== 'function') throw Error('Italian G2P engine is incomplete.');
        engine.setVoice('it');
        this.onStatus('Italian phonemizer ready on device.');
        return engine;
      })().catch(error => { this.italianPromise = null; throw error; });
    }
    return this.italianPromise;
  }
  async getJapanese() {
    if (!this.japanesePromise) {
      this.japanesePromise = (async () => {
        this.onStatus('Loading Japanese Open JTalk phonemizer locally…');
        const [library, model] = await Promise.all([this.japaneseLoader(), this.getModel()]);
        const Constructor = library.KokoroJP;
        if (typeof Constructor !== 'function') throw Error('Japanese browser G2P library is unavailable.');
        // kokoro-js-jp@0.2.0's TypeScript-private constructor accepts an
        // existing KokoroTTS runtime. This avoids downloading a second 82M
        // parameter model. Pinned to the audited version; fail closed if changed.
        const adapter = new Constructor(model, {});
        if (typeof adapter.speak !== 'function') throw Error('Japanese G2P adapter cannot synthesize.');
        return adapter;
      })().catch(error => { this.japanesePromise = null; throw error; });
    }
    return this.japanesePromise;
  }
  preload({ languages = ['it','ja'] } = {}) {
    if (this.preloadPromise) return this.preloadPromise;
    this.preloadPromise = (async () => {
      await this.getModel(); // download ONNX when the page is first opened, not first speech
      await Promise.all(Object.values(SEED_PROFILES).flatMap(p=>p.styles.map(s=>this.getStyle(s.name))));
      const results=await Promise.allSettled([
        ...(languages.includes('it') ? [this.getItalian()] : []),
        ...(languages.includes('ja') ? [this.getJapanese().then(async jp=>{
          // Prime Open JTalk dictionary while idle; no output is played.
          // The compiled TypeScript-private method is exposed in pinned 0.2.0.
          if (typeof jp.loadJapaneseG2POnce === 'function') await jp.loadJapaneseG2POnce();
          else throw Error('Japanese warmup API changed; check pinned kokoro-js-jp version.');
        })] : []),
      ]);
      const failed=results.filter(r=>r.status==='rejected');
      if (failed.length) {
        this.onStatus('Kokoro model ready · some language phonemizers need retry on first use.');
      }else{
        this.onStatus('Kokoro + selected phonemizers ready · no paid cloud inference.');
      }
      return { modelReady:true, languagesReady: results.length-failed.length, languagesFailed:failed.length };
    })().catch(error => {this.preloadPromise=null; throw error;});
    return this.preloadPromise;
  }
  async getStyle(name) {
    if (!/^(?:if_sara|af_heart|jf_alpha|jf_nezumi)$/.test(name)) throw Error('Unapproved style source.');
    if (!this.voiceCache.has(name)) {
      const promise = (async () => {
        const response = await this.fetchImpl(VOICE_BASE + name + '.bin');
        if (!response.ok) throw Error('Could not download Kokoro style vector: ' + name);
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength < (MAX_TOKENS + 1) * STYLE_DIM * 4 || bytes.byteLength % 4 !== 0) {
          throw Error('Invalid Kokoro style vector: ' + name);
        }
        return new Float32Array(bytes);
      })().catch(err => { this.voiceCache.delete(name); throw err; });
      this.voiceCache.set(name, promise);
    }
    return this.voiceCache.get(name);
  }
  /**
   * Merge short differently phonemized spans into ONE ONNX inference.
   *
   * Kokoro generates a continuous waveform from a phoneme-token sequence.
   * Previously a language switch triggered a new (sometimes ~20s on CPU)
   * inference after the previous audio ended. Here English, Italian and
   * Japanese G2P still run locally, but the resulting token IDs are joined
   * before inference, preserving the selected Giulia/Mei style vector.
   * Long utterances are intentionally not fused beyond Kokoro's token limit.
   */
  synthesizeMixed({ segments, voice, speech = {} }, { signal } = {}) {
    const task = this.queue.then(() => this._synthesizeMixed({ segments, voice, speech }, signal));
    this.queue = task.catch(() => {});
    return task;
  }
  async _synthesizeMixed({ segments, voice, speech }, signal) {
    requireActive(signal);
    if (!Array.isArray(segments) || segments.length < 2 || segments.length > 12) {
      throw Error('Language fusion requires 2–12 spoken spans.');
    }
    const mergedText = segments.map(s => s?.text || '').join('');
    if (!mergedText.trim() || mergedText.length > 210 ||
        segments.some(s => typeof s?.text !== 'string' || !s.text.trim() ||
          s.text.length > MAX_CHUNK || !BROWSER_KOKORO_LANGUAGES.includes(s.language))) {
      throw Error('Language fusion requires 210 characters or fewer with supported speech languages.');
    }
    const profile = SEED_PROFILES[voice];
    if (!profile) throw Error('Unknown Giulia/Mei seed voice.');
    const speed = Number(speech?.pace ?? 1);
    if (!Number.isFinite(speed) || speed < 0.6 || speed > 1.5) throw Error('Invalid speaking pace.');
    const preparedStarted = performance.now();
    const model = await this.getModel();
    requireActive(signal);
    const voices = new Map(await Promise.all(profile.styles.map(async entry => [entry.name, await this.getStyle(entry.name)])));
    requireActive(signal);
    const phonemeStarted = performance.now();
    const previous = model.generate_from_ids;
    const inputTensors = [];
    try {
      // In kokoro-js@1.2.1, generate()/kokoro-js-jp.speak() both call
      // generate_from_ids() AFTER language-specific phonemization/tokenizing.
      // Intercept those input IDs without running separate model inferences.
      model.generate_from_ids = async input_ids => input_ids;
      for (const segment of segments) {
        requireActive(signal);
        let tokens;
        if (segment.language === 'it') {
          const italian = await this.getItalian();
          const phonemes = normalizeItalianIPA(italian.textToIpa(segment.text));
          tokens = model.tokenizer(phonemes, { truncation: true }).input_ids;
        } else if (segment.language === 'ja') {
          const japanese = await this.getJapanese();
          tokens = await japanese.speak(segment.text, 'jf_alpha', speed);
        } else {
          tokens = await model.generate(segment.text, {
            voice: segment.language === 'en-gb' ? 'bf_emma' : 'af_heart', speed,
          });
        }
        if (!tokens?.data || tokens.data.length < 2 || !tokens.dims) {
          throw Error('Language phonemizer returned incompatible Kokoro token IDs.');
        }
        inputTensors.push(tokens);
      }
    } finally {
      model.generate_from_ids = previous; // Never leave the model in capture mode.
    }
    requireActive(signal);
    // Drop each sequence's BOS/EOS padding; restore a single BOS/EOS pair.
    // This avoids three expensive ONNX calls for a three-language sentence.
    const first = inputTensors[0], Data = first.data.constructor;
    const ids = [];
    // Fusing adjacent token sequences without a prosodic boundary yielded
    // unnaturally run-together speech. Use Kokoro's own IPA punctuation token
    // for a brief linguistic breath, still making only one ONNX model call.
    const separator = model.tokenizer('…', { truncation: true }).input_ids;
    const pauseTokens = separator?.data?.slice(1, -1);
    if (!pauseTokens?.length || pauseTokens.length > 4 ||
        [...pauseTokens].some(id => !id)) {
      throw Error('Kokoro punctuation token unavailable; use safe per-phrase synthesis.');
    }
    for (const [index, t] of inputTensors.entries()) {
      if (t.type !== first.type || t.data.constructor !== Data) {
        throw Error('Inconsistent Kokoro tokenizer IDs across languages.');
      }
      if (index > 0) ids.push(...pauseTokens);
      ids.push(...t.data.slice(1, -1));
    }
    if (!ids.length || ids.length > MAX_TOKENS) {
      throw Error('Combined phonemes exceed Kokoro 510-token limit; shorter clips required.');
    }
    const packed = new Data(ids.length + 2);
    packed[0] = first.data[0];
    packed.set(ids, 1);
    packed[packed.length - 1] = first.data[first.data.length - 1];
    const Tensor = first.constructor, input_ids = new Tensor(first.type, packed, [1, packed.length]);
    const phonemizationMs = performance.now() - phonemeStarted;
    const inferenceStarted = performance.now();
    const style = blendStyleRow(profile.styles, voices, ids.length);
    const { waveform } = await model.model({
      input_ids,
      style: new Tensor('float32', style, [1, STYLE_DIM]),
      speed: new Tensor('float32', new Float32Array([speed]), [1]),
    });
    const inferenceMs = performance.now() - inferenceStarted;
    requireActive(signal);
    if (!waveform?.data?.length) throw Error('Kokoro fused synthesis produced no waveform.');
    const actualDurationMs = waveform.data.length * 1000 / SAMPLE_RATE;
    const minimumMs = minimumReasonableSpeechMs(segments, speed);
    if (actualDurationMs < minimumMs) {
      // Prevent a truncated "Buon..." waveform from being presented as a
      // complete spoken reply. Our scheduler will regenerate each phrase
      // using the standard Kokoro path and buffer it before playback.
      throw Error('Incomplete Kokoro fusion: generated '+Math.round(actualDurationMs)
        +'ms for speech needing at least '+Math.round(minimumMs)+'ms.');
    }
    const blob = encodePcm16Wav(waveform.data, SAMPLE_RATE);
    return {
      blob, backend: 'kokoro-on-device',
      generationMs: performance.now() - preparedStarted,
      phonemizationMs, inferenceMs,
      durationMs: actualDurationMs,
      insertedPauseTokens: pauseTokens.length,
      fusedLanguages: segments.map(part => part.language),
      segmentCount: segments.length,
    };
  }
  synthesize({ text, voice, language = 'en-us', speech = {} }, { signal } = {}) {
    const task = this.queue.then(() => this._synthesize({ text, voice, language, speech }, signal));
    this.queue = task.catch(() => {}); // serialize GPU/CPU operations, even across failed requests
    return task;
  }
  async _synthesize({ text, voice, language, speech }, signal) {
    requireActive(signal);
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_CHUNK) {
      throw Error('Browser Kokoro needs a nonempty text chunk of 260 characters or fewer.');
    }
    const profile = SEED_PROFILES[voice];
    if (!profile) throw Error('Select a verified Giulia or Mei Kokoro seed voice.');
    if (!BROWSER_KOKORO_LANGUAGES.includes(language)) {
      throw Error('Unsupported Kokoro speech language. Choose English, Italian or Japanese.');
    }
    const speed = Number(speech?.pace ?? 1);
    if (!Number.isFinite(speed) || speed < .6 || speed > 1.5) throw Error('Invalid speech pace.');
    const model = await this.getModel();
    requireActive(signal);
    const names = profile.styles.map(entry => entry.name);
    const styleVectors = await Promise.all(names.map(async name => [name, await this.getStyle(name)]));
    requireActive(signal);
    const byName = new Map(styleVectors);
    // Keep one ONNX model and one identity-specific style interpolation;
    // only the grapheme-to-phoneme front-end changes for English, Italian,
    // and Japanese. No voice cloning and no server inference.
    // input_ids.constructor is the Tensor from the *same* Transformers.js
    // instance, avoiding incompatible copies of ONNX Runtime's Tensor.
    const originalGenerate = model.generate_from_ids;
    model.generate_from_ids = async (input_ids, options = {}) => {
      const tokens = Math.max(0, (input_ids.dims.at(-1) || 2) - 2);
      const Tensor = input_ids.constructor;
      const style = blendStyleRow(profile.styles, byName, tokens);
      const modelStarted = performance.now();
      const result = await model.model({
        input_ids,
        style: new Tensor('float32', style, [1, STYLE_DIM]),
        speed: new Tensor('float32', new Float32Array([Number(options.speed || speed)]), [1]),
      });
      inferenceMs += performance.now() - modelStarted;
      return { data: result.waveform?.data, sampling_rate: SAMPLE_RATE };
    };
    const started = performance.now();
    let inferenceMs = 0;
    try {
      let audio;
      if(language === 'it'){
        const it = await this.getItalian();
        requireActive(signal);
        const phonemes = normalizeItalianIPA(it.textToIpa(text));
        if(!phonemes.trim()) throw Error('Italian G2P produced empty phonemes.');
        const { input_ids } = model.tokenizer(phonemes, {truncation:true});
        audio = await model.generate_from_ids(input_ids, { voice:'af_heart',speed });
      } else if(language === 'ja'){
        const jp = await this.getJapanese();
        requireActive(signal);
        audio = await jp.speak(text, 'jf_alpha', speed); // G2P source voice; patched output uses the blended identity.
      } else {
        audio = await model.generate(text, { voice: language === 'en-gb' ? 'bf_emma' : 'af_heart', speed });
      }
      requireActive(signal);
      if (!audio?.data) throw Error('Kokoro produced no PCM samples.');
      const blob = encodePcm16Wav(audio.data, SAMPLE_RATE);
      return {
        blob, backend: 'kokoro-on-device', generationMs: performance.now() - started,
        phonemizationMs: Math.max(0, performance.now() - started - inferenceMs),
        inferenceMs, durationMs: audio.data.length / SAMPLE_RATE * 1000,
      };
    } finally {
      model.generate_from_ids = originalGenerate;
    }
  }
}
