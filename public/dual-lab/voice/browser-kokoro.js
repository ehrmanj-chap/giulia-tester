/**
 * No-bill speech synthesis: Kokoro inference runs on each visitor's device.
 *
 * Uses the same PUBLIC seed style-vector interpolation as the Python gateway,
 * not Microsoft speechSynthesis or a paid inference endpoint.
 * Private Seed-VC reference-conditioned voices are NOT reproduced by this code.
 *
 * kokoro-js 1.2.1 uses English phonemization only. We select its English
 * phonemizer explicitly, but replace generation's style tensor with the exact
 * weighted public Giulia/Mei starter vectors from config.example.json.
 *
 * Model: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
 * Library: https://github.com/hexgrad/kokoro/tree/main/kokoro.js
 */
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const VOICE_BASE = 'https://huggingface.co/' + MODEL_ID + '/resolve/main/voices/';
const KOKORO_ESM = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js';
const STYLE_DIM = 256;
const SAMPLE_RATE = 24000;
const MAX_TOKENS = 509;
const MAX_CHUNK = 260;

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
export const BROWSER_KOKORO_LANGUAGES = Object.freeze(['en-us', 'en-gb']);
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
  constructor({ onStatus = () => {}, loader = null, fetchImpl = null } = {}) {
    this.kind = 'ondevice';
    this.onStatus = onStatus;
    this.loader = loader || (() => import(KOKORO_ESM));
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
      throw Error('Browser Kokoro currently phonemizes English only. Italian/Japanese pronunciation and Seed-VC references still need their original Python runtime.');
    }
    const speed = Number(speech?.pace ?? 1);
    if (!Number.isFinite(speed) || speed < .6 || speed > 1.5) throw Error('Invalid speech pace.');
    const model = await this.getModel();
    requireActive(signal);
    const names = profile.styles.map(entry => entry.name);
    const styleVectors = await Promise.all(names.map(async name => [name, await this.getStyle(name)]));
    requireActive(signal);
    const byName = new Map(styleVectors);
    // The Kokoro JS G2P currently handles English. Keep its public
    // tokenizer/G2P, but replace the style tensor with the original
    // weighted 256-dimensional Kokoro vectors for Giulia or Mei.
    // input_ids.constructor is the Tensor from the *same* Transformers.js
    // instance, avoiding incompatible copies of ONNX Runtime's Tensor.
    const originalGenerate = model.generate_from_ids;
    model.generate_from_ids = async (input_ids, options = {}) => {
      const tokens = Math.max(0, (input_ids.dims.at(-1) || 2) - 2);
      const Tensor = input_ids.constructor;
      const style = blendStyleRow(profile.styles, byName, tokens);
      const result = await model.model({
        input_ids,
        style: new Tensor('float32', style, [1, STYLE_DIM]),
        speed: new Tensor('float32', new Float32Array([Number(options.speed || speed)]), [1]),
      });
      return { data: result.waveform?.data, sampling_rate: SAMPLE_RATE };
    };
    const started = performance.now();
    try {
      const audio = await model.generate(text, { voice: language === 'en-gb' ? 'bf_emma' : 'af_heart', speed });
      requireActive(signal);
      if (!audio?.data) throw Error('Kokoro produced no PCM samples.');
      const blob = encodePcm16Wav(audio.data, SAMPLE_RATE);
      return {
        blob, backend: 'kokoro-on-device', generationMs: performance.now() - started,
        durationMs: audio.data.length / SAMPLE_RATE * 1000,
      };
    } finally {
      model.generate_from_ids = originalGenerate;
    }
  }
}
