import { AGENTS, VoiceSession, speechSegments, speechSpec } from './core.js';
import { VoiceGateway, callAgent } from './clients.js';
import { AudioPlayer, Microphone } from './audio.js';
import { BrowserSpeech, hasBrowserRecognition } from './browser-speech.js';
import { PRESETS } from './presets.js';
const $ = selector => document.querySelector(selector);
const player = new AudioPlayer();
let gateway, capabilities, session, loopRunning = false, lastClip, ttsController, uiEpoch = 0, ttsBusy = false;
const browserSpeech = new BrowserSpeech();
let browserListening = false, browserListenController = null;
const objectUrls = new Set();
const hints = { tts: 'Try a phrase, compare voices, and listen for timing and pronunciation.', stt: 'Record or upload speech. Review the original transcript and recognition time.', 'human-ai': 'Speak to one expert. Their normal text pipeline provides every response.', 'ai-ai': 'Giulia and Mei exchange exact text. Speech is rendered for you to hear.', 'ai-ai-human': 'Join, interrupt, or redirect the discussion. A direct question to you pauses the agents.' };
try { $('#gatewayUrl').value = localStorage.getItem('voiceLab.gateway') || $('#gatewayUrl').value; } catch {}
function error(message = '') { $('#error').hidden = !message; $('#error').textContent = message; }
function options() { return { mode: $('#mode').value, agent: $('#agent').value, startingSpeaker: $('#startingSpeaker').value,
  maxTurns: Number($('#maxTurns').value), topic: $('#topic').value, scenario: $('#scenario').value, objective: $('#objective').value, opening: $('#opening').value }; }
function makeSession() {
  return new VoiceSession({ options: options(), model: callAgent, renderSpeech, onChange: render,
    transcribe: (blob, params) => { if (!gateway || gateway.kind === 'browser') throw Error('Audio file transcription needs a connected Whisper voice gateway.'); return gateway.transcribe(blob, params); } });
}
function setMode() {
  const mode = $('#mode').value;
  for (const el of document.querySelectorAll('[data-modes]')) el.hidden = !el.dataset.modes.split(' ').includes(mode);
  $('#identityControls').hidden = mode === 'stt'; $('#voiceControls').hidden = mode === 'stt'; $('#modeHint').textContent = hints[mode];
  reset();
}
function reset() {
  uiEpoch++; session?.stop('Session reset'); ttsController?.abort(); player.stop(); browserListenController?.abort(); browserSpeech.abortListening(); browserSpeech.stop(); browserListening = false; mic.stop(true); lastClip = null;
  $('#retry').disabled = true; $('#upload').value = ''; objectUrls.forEach(url => URL.revokeObjectURL(url)); objectUrls.clear();
  session = makeSession(); ttsBusy = false; error(); render();
}
function render() {
  if (!session) return;
  $('#sessionStatus').textContent = `${session.state.replace('-', ' ')}${session.busy ? ' · generating a turn' : ''}${session.reason ? ` · ${session.reason}` : ''} · ${session.turns.length} turns`;
  const box = $('#transcript');
  if (!session.turns.length) { box.innerHTML = '<div class="empty-state"><span aria-hidden="true">◌</span><h3>Give the conversation a voice.</h3><p>Choose a mode, connect the speech service, and start listening. Every spoken turn keeps its original text.</p></div>'; }
  else {
    box.replaceChildren();
    for (const turn of session.turns) {
      const article = document.createElement('article'); article.className = `turn ${turn.participant}`;
      const header = document.createElement('div'); header.className = 'turn-header';
      if (AGENTS[turn.participant]) { const img = document.createElement('img'); img.src = `../assets/${turn.participant}.png`; img.alt = ''; header.append(img); }
      else { const dot = document.createElement('span'); dot.className = 'speaker-dot'; header.append(dot); }
      header.append(document.createTextNode(AGENTS[turn.participant]?.name || 'You'));
      const text = document.createElement('p'); text.textContent = turn.text;
      const meta = document.createElement('div'); meta.className = 'turn-meta';
      meta.textContent = [turn.voiceLabel, turn.audioStatus, ...Object.entries(turn.timings).filter(([, v]) => Number.isFinite(v)).map(([k, v]) => `${k.replace(/Ms$/, '')}: ${(v / 1000).toFixed(2)}s`), ...turn.errors.map(e => `${e.stage}: ${e.message}`)].filter(Boolean).join(' · ');
      article.append(header, text, meta);
      if (turn.audio?.length) {
        const actions = document.createElement('div'); actions.className = 'clip-actions';
        const replay = document.createElement('button'); replay.type = 'button'; replay.className = 'ghost'; replay.textContent = 'Replay';
        replay.onclick = async () => { if (session.busy || session.state === 'running') session.pause(); haltAudio(); ttsController = new AbortController(); try { for (const clip of turn.audio) await player.play(clip.blob, { signal: ttsController.signal }); } catch (e) { if (e.name !== 'AbortError') error(e.message); } };
        actions.append(replay);
        turn.audio.forEach((clip, i) => {
          if (!clip.url) { clip.url = URL.createObjectURL(clip.blob); objectUrls.add(clip.url); }
          const save = document.createElement('a'); save.href = clip.url; save.download = `${turn.participant}-${turn.id}-${i + 1}.wav`; save.textContent = turn.audio.length === 1 ? 'Save clip' : `Save part ${i + 1}`; actions.append(save);
        }); article.append(actions);
      } else if (turn.ttsBackend === 'browser') {
        const actions = document.createElement('div'); actions.className = 'clip-actions';
        const replay = document.createElement('button'); replay.type = 'button'; replay.className = 'ghost'; replay.textContent = 'Speak again';
        replay.onclick = async () => {
          if (session.busy || session.state === 'running') session.pause();
          haltAudio(); ttsController = new AbortController();
          try {
            for (const segment of speechSegments(turn.text, turn.ttsParameters?.language || 'en-us')) {
              await browserSpeech.speak({ ...segment, voice: turn.voice, speech: turn.ttsParameters }, { signal: ttsController.signal });
            }
          } catch (failure) { if (failure.name !== 'AbortError') error(failure.message); }
        };
        actions.append(replay); article.append(actions);
      }
      if ($('#showDebug').checked) {
        const detail = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre'); summary.textContent = 'Turn diagnostics';
        const { audio, inputStartedAt, ...diagnostics } = turn; pre.textContent = JSON.stringify(diagnostics, null, 2); detail.append(summary, pre); article.append(detail);
      }
      box.append(article);
    }
  }
  $('#debug').hidden = !$('#showDebug').checked; $('#debug').textContent = JSON.stringify({ sessionId: session.id, events: session.events, capabilities }, null, 2);
  $('#pause').disabled = !['running', 'waiting-human'].includes(session.state); $('#resume').disabled = !['paused', 'waiting-human'].includes(session.state);
  $('#next').disabled = session.busy || session.state === 'stopped'; $('#start').disabled = session.busy || session.state === 'running';
  $('#generate').disabled = ttsBusy; $('#pace').disabled = !capabilities?.tts?.controls?.includes('pace');
}
function selectedVoice(agent) { return $(`#${agent}Voice`).value; }
async function renderSpeech(turn, { signal } = {}) {
  if (!gateway) throw Error('Voice backend unavailable. Text lab remains available.');
  const voice = turn.voice || selectedVoice(turn.participant), language = $('#language').value;
  if (!voice) throw Error('Choose an available voice.');
  const voiceInfo = capabilities.voices.find(v => v.id === voice);
  turn.voice = voice; turn.voiceLabel = voiceInfo?.label || voice; turn.ttsBackend = voiceInfo?.backend || capabilities.tts.backend;
  turn.ttsParameters = { language, ...speechSpec({ ...turn.speech, pace: Number($('#pace').value) }) };
  turn.audio = []; turn.chunks = []; const segments = speechSegments(turn.text, language); const started = performance.now(); let first = true, generationMs = 0;
  if (gateway.kind === 'browser') {
    turn.audioStatus = 'playing'; render();
    for (const segment of segments) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await gateway.speak({ ...segment, voice, speech: turn.ttsParameters }, {
        signal, onPlaying: () => {
          if (first) { turn.timings.firstAudioMs = performance.now() - started; first = false; render(); }
        }
      });
      turn.chunks.push({ ...segment, backend: 'browser-speech-synthesis' });
    }
    turn.timings.ttsMs = null; // Browser API does not expose synthesis latency.
    turn.timings.audioWallMs = performance.now() - started;
    turn.audioStatus = 'complete'; render();
    return;
  }
  const synthesize = segment => gateway.synthesize({ ...segment, voice, speech: turn.ttsParameters }, { signal });
  // One-chunk lookahead: inference overlaps playback, while preserving playback order.
  // A tagged outcome prevents an unhandled rejection while the prior clip is playing.
  const prefetch = segment => synthesize(segment).then(value => ({ value }), failure => ({ failure }));
  let pending = segments.length ? prefetch(segments[0]) : null;
  for (let i = 0; i < segments.length; i++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { value: clip, failure } = await pending; if (failure) throw failure;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (i + 1 < segments.length) pending = prefetch(segments[i + 1]);
    generationMs += clip.generationMs || 0;
    turn.audio.push(clip); turn.chunks.push({ ...segments[i], generationMs: clip.generationMs, durationMs: clip.durationMs });
    turn.audioStatus = 'playing'; render();
    await player.play(clip.blob, { signal, onPlaying: () => { if (first) { turn.timings.firstAudioMs = performance.now() - started; first = false; render(); } } });
  }
  turn.timings.ttsMs = generationMs; turn.timings.audioWallMs = performance.now() - started; turn.audioStatus = 'complete'; render();
}
async function runLoop(manual = false) {
  if (loopRunning) return; loopRunning = true; const activeSession = session;
  try {
    do {
      if (activeSession !== session || session.state !== 'running') break;
      await session.advance();
      if (manual || !$('#autoAdvance').checked || session.options.mode === 'human-ai') break;
      // Let controls, microphone events, and paint run between turns.
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (session.state === 'running');
  } finally { loopRunning = false; render(); }
}
function haltAudio() { ttsController?.abort(); player.stop(); browserSpeech.stop(); }
async function acceptClip(blob, params = {}) {
  if (blob.size > 8 * 1024 * 1024) { error('Choose an audio clip under 8 MB and 60 seconds.'); return; }
  lastClip = blob; $('#retry').disabled = false; error();
  const activeSession = session; session.options = { ...session.options, ...options() };
  try {
    const turn = await session.humanAudio(blob, { ...params, language: $('#sttLanguage').value });
    if (turn && activeSession === session && session.options.mode !== 'stt') {
      // A barge-in may have aborted an agent turn that is still settling.
      while (loopRunning && activeSession === session) await new Promise(r => setTimeout(r, 30));
      if (activeSession === session) await runLoop();
    }
  } catch (e) { error(e.message); }
}
async function acceptRecognizedText(text, backend = 'typed') {
  const activeSession = session;
  session.options = { ...session.options, ...options() };
  try {
    const turn = session.humanText(text, { backend });
    if (turn && activeSession === session && session.options.mode !== 'stt') {
      while (loopRunning && activeSession === session) await new Promise(resolve => setTimeout(resolve, 30));
      if (activeSession === session) await runLoop();
    }
  } catch (failure) { error(failure.message); }
}
const mic = new Microphone({ onClip: acceptClip, onError: e => error(e.message),
  onState: state => { $('#micStatus').textContent = `Microphone ${state}`; $('#record').textContent = mic.active ? 'Stop recording' : 'Start recording'; },
  onSpeechStart: () => { haltAudio(); session.interrupt(); } });
async function devices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const available = await navigator.mediaDevices.enumerateDevices();
  for (const [selector, kind] of [['#microphone', 'audioinput'], ['#speaker', 'audiooutput']]) {
    const el = $(selector), previous = el.value; el.replaceChildren(new Option('System default', ''));
    available.filter(d => d.kind === kind).forEach((d, i) => el.add(new Option(d.label || `${kind === 'audioinput' ? 'Microphone' : 'Speaker'} ${i + 1}`, d.deviceId))); el.value = previous;
  }
  $('#speaker').disabled = !('setSinkId' in HTMLMediaElement.prototype);
}
async function connectSpeech() {
  error(); $('#serviceStatus').textContent = 'Connecting speech engine…';
  try {
    const candidate = $('#speechEngine').value === 'browser'
      ? browserSpeech : new VoiceGateway($('#gatewayUrl').value, $('#gatewayToken').value);
    const status = await candidate.status();
    if (status.schemaVersion !== 1 || !Array.isArray(status.voices)) throw Error('Unsupported speech engine contract.');
    gateway = candidate; capabilities = status;
    if (candidate.kind !== 'browser') {
      try { localStorage.setItem('voiceLab.gateway', candidate.base); } catch {}
    }
    for (const agent of ['giulia', 'mei']) {
      const el = $('#'+agent+'Voice'), previous = el.value;
      el.replaceChildren();
      status.voices.forEach(v => el.add(new Option(v.label, v.id)));
      el.value = status.voices.some(v => v.id === previous) ? previous
        : status.voices.find(v => v.agent === agent && v.default)?.id
        || status.voices.find(v => v.agent === agent)?.id
        || status.voices.find(v => v.default)?.id || status.voices[0]?.id || '';
    }
    $('#compareVoice').replaceChildren(new Option('No comparison', ''));
    status.voices.forEach(v => $('#compareVoice').add(new Option(v.label, v.id)));
    const browser = candidate.kind === 'browser';
    $('#upload').disabled = browser;
    $('#handsFree').disabled = browser;
    if (browser) $('#handsFree').checked = false;
    $('#retry').disabled = browser || !lastClip;
    $('#serviceStatus').textContent = browser
      ? 'Browser voices ready · ' + (status.stt?.available ? 'microphone recognition supported' : 'no browser recognition; typed turns available')
      : 'Advanced gateway connected · ' + status.voices.length + ' voices · ' + (status.stt?.available ? 'Whisper ready' : 'STT unavailable');
    $('#speechPrivacy').textContent = browser
      ? 'Browser recognition may send microphone speech to your browser provider. Recordings are not uploaded to this site. Browser synthesis cannot export audio files.'
      : 'Audio clips are sent to your configured Whisper/Kokoro gateway. Private references, model weights and tokens are not embedded in this website.';
    render();
  } catch (failure) {
    gateway = null; capabilities = null;
    error(failure.message);
    $('#serviceStatus').textContent = 'Speech engine unavailable · canonical text conversation remains available';
    if ($('#speechEngine').value === 'gateway') $('#connectionSettings').open = true;
    render();
  }
}
$('#connect').onclick = connectSpeech;
$('#speechEngine').onchange = () => { reset(); gateway = null; capabilities = null; connectSpeech(); };
if (globalThis.speechSynthesis?.addEventListener) {
  globalThis.speechSynthesis.addEventListener('voiceschanged', () => {
    if ($('#speechEngine').value === 'browser' && !ttsBusy && !session?.busy && !browserListening) connectSpeech();
  });
}
$('#generate').onclick = async () => {
  const text = $('#speechText').value.trim(); if (!text || ttsBusy) return;
  haltAudio(); ttsController = new AbortController(); const signal = ttsController.signal, epoch = uiEpoch;
  ttsBusy = true; error(); render();
  try {
    const voices = [...new Set([selectedVoice($('#agent').value), $('#compareVoice').value].filter(Boolean))];
    if (!voices.length) throw Error('Connect the voice service and choose a voice first.');
    for (const voice of voices) {
      if (epoch !== uiEpoch || signal.aborted) break;
      const turn = session.newTurn($('#agent').value, text, { voice, speech: speechSpec(), audioStatus: 'generating' });
      try { await renderSpeech(turn, { signal }); }
      catch (e) { turn.audioStatus = signal.aborted ? 'interrupted' : 'failed'; if (!signal.aborted) { turn.errors.push({ stage: 'tts', message: e.message }); error(e.message); } }
    }
  } catch (e) { error(e.message); }
  finally { if (epoch === uiEpoch) { ttsBusy = false; render(); } }
};
$('#record').onclick = async () => {
  if (gateway?.kind === 'browser') {
    if (browserListening) { browserSpeech.stopListening(); return; }
    if (!hasBrowserRecognition()) { error('Browser recognition is unavailable. Type a turn or select the Whisper gateway.'); return; }
    if (session.state === 'stopped') { error('Reset the session before recording again.'); return; }
    haltAudio(); session.interrupt(); error();
    const epoch = uiEpoch, controller = new AbortController();
    browserListenController = controller; browserListening = true;
    $('#micStatus').textContent = 'Browser microphone listening'; $('#record').textContent = 'Finish listening';
    try {
      const result = await browserSpeech.listen({ language: $('#sttLanguage').value, signal: controller.signal });
      if (epoch === uiEpoch) await acceptRecognizedText(result.rawTranscript, result.backend);
    } catch (failure) {
      if (epoch === uiEpoch && failure.name !== 'AbortError') error(failure.message);
    } finally {
      if (epoch === uiEpoch) {
        browserListening = false; browserListenController = null;
        $('#micStatus').textContent = 'Browser microphone off'; $('#record').textContent = 'Start recording';
      }
    }
    return;
  }
  if (mic.active) { mic.stop(); return; }
  error();
  try {
    if (session.state === 'stopped') throw Error('Reset the session before recording a new conversation.');
    if (!gateway) throw Error('Connect a speech engine first.');
    await mic.start({ deviceId: $('#microphone').value, handsFree: $('#handsFree').checked });
    await devices();
  } catch (failure) { mic.stop(true); error(failure.message); }
};
$('#upload').onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  if (!gateway || gateway.kind === 'browser') {
    error('Uploaded-audio transcription needs the advanced Whisper gateway. Browser recognition only supports live microphone input.');
    e.target.value = ''; return;
  }
  haltAudio(); acceptClip(file);
};
$('#retry').onclick = () => { if (lastClip && gateway?.kind !== 'browser') { haltAudio(); acceptClip(lastClip); } };
$('#sendTyped').onclick = () => {
  const text = $('#typedTurn').value.trim();
  if (!text) { error('Type a turn first.'); return; }
  if (session.state === 'stopped') { error('Reset the session before adding a turn.'); return; }
  haltAudio(); browserListenController?.abort(); browserSpeech.abortListening();
  $('#typedTurn').value = ''; error(); acceptRecognizedText(text, 'typed-input-not-stt');
};
$('#start').onclick = () => { if (session.state === 'stopped') reset(); session.options = { ...session.options, ...options() }; session.start(); error(); runLoop(); };
$('#pause').onclick = () => { session.pause(); haltAudio(); browserListenController?.abort(); mic.stop(true); };
$('#resume').onclick = () => { session.resume(); error(); runLoop(); };
$('#next').onclick = () => { if (session.state !== 'stopped') { if (session.state === 'waiting-human') session.resume(); else session.start(); runLoop(true); } };
$('#stop').onclick = () => { session.stop(); haltAudio(); browserListenController?.abort(); mic.stop(true); };
$('#stopAudio').onclick = haltAudio;
$('#reset').onclick = reset; $('#mode').onchange = setMode; $('#showDebug').onchange = render;
$('#speaker').onchange = () => { player.sinkId = $('#speaker').value; };
$('#pace').oninput = () => { $('#paceValue').textContent = `${Number($('#pace').value).toFixed(2)}×`; };
$('#export').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(session.report(), null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `voice-session-${session.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
for (const preset of PRESETS) { const button = document.createElement('button'); button.type = 'button'; button.className = 'ghost'; button.textContent = preset.name; button.onclick = () => { $('#speechText').value = preset.text; $('#language').value = preset.language; }; $('#presets').append(button); }
window.addEventListener('pagehide', () => { session.stop('Page closed'); haltAudio(); browserListenController?.abort(); browserSpeech.abortListening(); mic.stop(true); objectUrls.forEach(url => URL.revokeObjectURL(url)); });
setMode(); devices().catch(() => {}); connectSpeech();
