export function microphoneError(error) {
  if (['NotAllowedError', 'SecurityError'].includes(error.name)) return 'Microphone permission was denied. Allow it in browser settings, then try again, or upload a clip.';
  if (error.name === 'NotFoundError') return 'No microphone found. Connect one or upload a clip.';
  return error.message || 'Could not open the microphone. You can retry or upload a clip.';
}
export class Microphone {
  constructor({ onClip, onError, onState, onSpeechStart }) { Object.assign(this, { onClip, onError, onState, onSpeechStart }); this.active = false; }
  async start({ deviceId = '', handsFree = false, silenceMs = 850, threshold = .022 } = {}) {
    if (this.active) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw Error('Recording needs a supported browser on HTTPS or localhost. Upload a clip instead.');
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } }); }
    catch (error) { throw Error(microphoneError(error)); }
    this.active = true; this.handsFree = handsFree; this.onState('recording');
    if (!handsFree) { this.beginClip(); this.onSpeechStart(); return; }
    this.context = new AudioContext(); await this.context.resume();
    this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 2048;
    this.context.createMediaStreamSource(this.stream).connect(this.analyser);
    const samples = new Float32Array(this.analyser.fftSize); let lastLoud = 0, loudFrames = 0, clipStart = 0;
    this.timer = setInterval(() => {
      if (!this.active) return; this.analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((n, x) => n + x * x, 0) / samples.length), time = performance.now();
      if (rms > threshold) { loudFrames++; lastLoud = time; } else loudFrames = 0;
      if (!this.recorder && loudFrames >= 2) { this.beginClip(); clipStart = time; this.onSpeechStart(); }
      if (this.recorder && ((time - lastLoud > silenceMs && time - clipStart > 350) || time - clipStart > 60000)) this.finishClip(false, lastLoud);
    }, 40);
  }
  beginClip() {
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : {}); this.recorder = recorder;
    const chunks = []; recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onerror = e => this.onError(e.error || Error('Recording failed.'));
    recorder.onstop = () => { if (!recorder.discard && chunks.length) this.onClip(new Blob(chunks, { type: recorder.mimeType }), { speechEndedAt: recorder.endedAt }); };
    recorder.start(200); this.onState('speaking');
    if (!this.handsFree) this.limit = setTimeout(() => this.stop(), 60000);
  }
  finishClip(discard = false, endedAt = performance.now()) {
    if (!this.recorder) return; const recorder = this.recorder; this.recorder = null;
    recorder.discard = discard; recorder.endedAt = endedAt; if (recorder.state !== 'inactive') recorder.stop();
    if (this.active) this.onState(this.handsFree ? 'listening' : 'processing');
  }
  stop(discard = false) {
    this.active = false; clearInterval(this.timer); clearTimeout(this.limit); this.finishClip(discard);
    this.stream?.getTracks().forEach(t => t.stop()); this.context?.close(); this.context = null; this.onState('off');
  }
}
export class AudioPlayer {
  constructor() { this.element = new Audio(); this.sinkId = ''; }
  stop() { this.cancel?.(); this.element.pause(); this.element.removeAttribute('src'); this.element.load(); }
  async play(blob, { signal, onPlaying } = {}) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    this.stop(); const url = URL.createObjectURL(blob); this.element.src = url;
    try {
      if (this.sinkId && this.element.setSinkId) await this.element.setSinkId(this.sinkId);
      await new Promise((resolve, reject) => {
        const finish = error => { this.cancel = null; this.element.onended = null; this.element.onerror = null; this.element.onplaying = null; signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
        const abort = () => { this.element.pause(); finish(new DOMException('Aborted', 'AbortError')); };
        this.cancel = abort; this.element.onended = () => finish(); this.element.onerror = () => finish(Error('Audio playback failed. Replay the clip to retry.'));
        this.element.onplaying = () => onPlaying?.(); signal?.addEventListener('abort', abort, { once: true });
        this.element.play().catch(error => finish(error));
      });
    } finally { URL.revokeObjectURL(url); }
  }
}
