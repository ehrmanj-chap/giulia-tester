/** Play short multilingual Kokoro utterances with minimal audible dead air.
 *
 *  1. Combine adjacent English/Italian/Japanese phoneme spans before ONNX
 *     inference (the voice identity stays fixed).
 *  2. For short multi-batch replies, buffer all clips before speaking.
 *  3. For long replies, infer the next batch while playing the current one.
 *
 *  On-device only. No server inference, vendor TTS, or payment.
 */
const JP = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
const ABORT = () => new DOMException('Playback stopped.', 'AbortError');
const ensureActive = signal => { if (signal?.aborted) throw ABORT(); };
const soundLength = text => [...text].reduce((n,c) => n + (JP.test(c) ? 3 : 2), 0);

// Deliberate linguistic breath between completed clips, not a wait for compute.
// In fused clips, Kokoro's ellipsis punctuation token supplies the phrasing.
export function naturalPauseMs(previous, next) {
  if (!previous?.length || !next?.length) return 0;
  const last = previous.at(-1), first = next[0];
  if (last.language !== first.language) return 180;
  return /[.!?。！？…]$/u.test(last.text.trim()) ? 125 : 65;
}
function pauseBeforeNextClip(ms, signal) {
  if (!ms) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(ABORT());
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(ABORT()); };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, {once:true});
  });
}

export function groupSpeechSegments(segments, { maxCharacters = 190, maxTokenEstimate = 400, maxSpans = 9 } = {}) {
  if (!Array.isArray(segments)) throw TypeError('Expected speech segments.');
  const groups = [];
  let current = [], chars = 0, estimatedTokens = 0;
  const flush = () => {
    if (current.length) groups.push({ segments: current, text: current.map(s => s.text).join(''),
      languages: [...new Set(current.map(s => s.language))] });
    current = []; chars = 0; estimatedTokens = 0;
  };
  for (const segment of segments) {
    if (!segment || typeof segment.text !== 'string' || typeof segment.language !== 'string') {
      throw TypeError('Invalid speech segment.');
    }
    if (!segment.text.trim()) continue;
    const size = segment.text.length, tokenEstimate = soundLength(segment.text);
    if (current.length && (chars + size > maxCharacters ||
        estimatedTokens + tokenEstimate > maxTokenEstimate || current.length >= maxSpans)) flush();
    current.push(segment);
    chars += size; estimatedTokens += tokenEstimate;
    // Individual long segments use the existing normal synthesis path.
    if (size >= maxCharacters || tokenEstimate >= maxTokenEstimate) flush();
  }
  flush();
  return groups;
}
export async function playKokoroSpeech({
  segments, provider, voice, speech = {}, play, signal, onStatus = () => {},
  onClip = () => {}, onPlaying = () => {}, smooth = true,
  pause = pauseBeforeNextClip,
} = {}) {
  const batches = groupSpeechSegments(segments || []);
  if (typeof play !== 'function' || !provider || typeof provider.synthesize !== 'function') {
    throw Error('Kokoro playback requires an on-device provider and audio player.');
  }
  if (!batches.length) return { clips: 0, batches: 0, phonemizationMs: 0, inferenceMs: 0, generationMs: 0, gapMs: 0 };
  const metrics = { clips:0, batches:batches.length, phonemizationMs:0, inferenceMs:0, generationMs:0, gapMs:0, fusionFallbacks:0 };
  // All clips of a short utterance should be ready before the first syllable
  // when CPU synthesis cannot run faster than playback.
  const bufferAll = smooth && batches.length > 1 &&
    batches.length <= 4 && batches.reduce((n,b) => n + b.text.length,0) <= 420;

  async function build(batch) {
    ensureActive(signal);
    let clips;
    if (batch.segments.length > 1 && typeof provider.synthesizeMixed === 'function') {
      try {
        const clip = await provider.synthesizeMixed({ segments:batch.segments,voice,speech },{signal});
        clips = [{clip,segments:batch.segments}];
      } catch(err) {
        ensureActive(signal);
        // If the browser runtime can't use the experimental cross-language
        // fusion, preserve the original Kokoro voices via per-span synthesis.
        // Never silently switch to device/system speechSynthesis.
        metrics.fusionFallbacks++;
        onStatus('Kokoro fusion incomplete or unsupported; preparing full-length buffered phrases.');
      }
    }
    if (!clips) {
      clips = [];
      for (const segment of batch.segments) {
        ensureActive(signal);
        const clip = await provider.synthesize({ ...segment,voice,speech },{signal});
        clips.push({clip,segments:[segment]});
      }
    }
    return clips;
  }
  function record(clip, spans) {
    metrics.clips++;
    metrics.phonemizationMs += Number(clip.phonemizationMs)||0;
    metrics.inferenceMs += Number(clip.inferenceMs)||0;
    metrics.generationMs += Number(clip.generationMs)||0;
    onClip(clip,spans);
  }
  let lastEndedAt = null, lastSpans = null;
  async function speak(items) {
    for (const {clip,segments:spans} of items) {
      ensureActive(signal);
      const pauseMs=naturalPauseMs(lastSpans,spans);
      if(pauseMs) await pause(pauseMs,signal);
      ensureActive(signal);
      record(clip,spans);
      await play(clip.blob,{
        signal,
        onPlaying:()=>{
          if(lastEndedAt!==null)metrics.gapMs+=Math.max(0,performance.now()-lastEndedAt);
          onPlaying(clip,spans);
        },
      });
      lastEndedAt=performance.now();
      lastSpans=spans;
    }
  }

  if (bufferAll) {
    const all = [];
    for (let index=0;index<batches.length;index++) {
      onStatus('Preparing complete Kokoro speech '+(index+1)+'/'+batches.length+' · natural phrase pauses');
      all.push(...await build(batches[index]));
    }
    onStatus('Full speech ready · playing with natural phrase boundaries');
    await speak(all);
  } else {
    // One-batch lookahead minimizes startup time for long utterances.
    const resolve = async batch => {
      try { return {clips:await build(batch)}; }
      catch(error){return {error};}
    };
    let pending=resolve(batches[0]);
    for(let index=0;index<batches.length;index++){
      ensureActive(signal);
      const {clips,error}=await pending;
      if(error)throw error;
      if(index+1<batches.length)pending=resolve(batches[index+1]);
      onStatus('Speaking Kokoro '+(index+1)+'/'+batches.length);
      await speak(clips);
    }
  }
  return metrics;
}
