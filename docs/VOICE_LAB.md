# Voice Lab

Open `/dual-lab/voice/` from the new Voice Lab link in the dual lab. This is an isolated experimental interface: the existing text chat, personas, retrieval, backends, traces, evaluation data, and deployment routes are unchanged.

## Architecture

```text
Microphone/upload -> Whisper -> raw + normalized human transcript
                                  |
                     canonical session turns
                                  |
              existing Giulia / Mei /api/chat endpoints
                                  |
                   exact canonical response text
                     /                       \
          other agent's context         speech renderer
                                        Kokoro -> optional Seed-VC
                                                -> browser playback
```

The browser owns an in-memory session. An independent, optional Python gateway owns speech inference. No models, private references, credentials, or generated audio are served by the text backend or committed to Git. Closing or resetting the tab releases audio object URLs and microphone buffers.

Agent adapters reuse `loadConnections()` and `endpointUrl()` from the existing lab. They POST the existing `{messages}` contract. A separate session brief guides concise turn-taking without changing system prompts, retrieval, or persona files. Every other participant's message content remains exact. The most recent 28 turns plus the brief fit inside the existing backends' bounded context; the complete transcript remains visible/exportable.

`VoiceSession` prevents concurrent model turns, rejects stale replies after stop/pause/interruption, and keeps canonical text when TTS fails. Three-way routing uses direct address and recent context; it does not insert the human into a fixed rotation. Stopping is bounded by 1–50 AI turns, sustained repeated ideas, a lightweight joint-conclusion heuristic, or manual stop. The objective is passed to the agents; objective completion is not independently verified.

## Local service

The text app still needs only Node. Run it as usual (`npm start`), then open `http://127.0.0.1:8787/dual-lab/voice/`.

For a new speech installation, create a dedicated Python environment and install `voice-service/requirements.txt`. Obtain the Kokoro ONNX model/voice archive and a local Whisper-small snapshot separately. FFmpeg must be on PATH (or specified in the private config). Heavy dependencies are deliberately not part of the Node deployment.

Copy `voice-service/config.example.json` to `.voice-local/voice.local.json`. Point `kokoroModel`, `kokoroVoices`, and `whisperModel` to your files. Paths are resolved relative to the config. Start:

```sh
python voice-service/server.py --config .voice-local/voice.local.json
```

The default endpoint is `http://127.0.0.1:8792`. Set `VOICE_LAB_TOKEN` or a private config `token`; otherwise the service prints a fresh token at startup. Paste it into **Connections & developer tools** in Voice Lab, then click **Connect voice service**. The browser retains the service URL but never persists its token.

For the already-installed desktop environment, the local handoff includes a launcher that reuses the existing audio Python environment, Seed-VC checkout, cached weights, and Kokoro files. Additional TTS/Japanese dependencies live in a separate workspace directory; the previous meme environment was not modified. Its tested NumPy 1.26 compatibility overlay avoids upgrading the previous environment; Kokoro's package metadata otherwise asks for NumPy 2. This machine-specific reuse recipe is not a portable fresh-install lockfile.

For optional Seed-VC candidates, add `seedVc: {"root": "/path/to/seed-vc", "steps": 25, "cfg": 0.7, "f0Condition": true}` and a `reference` path to a configured voice. The existing cached model is the 44 kHz v1 singing/conversion model. It is reused with pitch auto-adjustment and no fixed pitch shift. Seed-VC's dependencies and weights must already be present. The wrapper caches its loaded models and uses a temporary directory per conversion; it does not modify upstream code. The first call is substantially slower than subsequent calls.

Reference clips should be short, clean speech, ideally a representative 6–10 seconds. The local experiment uses eight seconds from each supplied reference, with original filenames, hashes, and offsets retained only in private configuration. A new installation should validate reference length before use; upstream v1 clips its reference to 25 seconds.

## Remote deployment

The frontend can be served alongside the existing dual lab, including GitHub Pages. Its voice gateway URL is configurable and independent of Giulia/Mei URLs. The local gateway binds only to loopback and allows explicit origins; authenticated status and inference endpoints do not expose local paths. Public hosting requires a separately managed HTTPS voice gateway with the same contract and appropriate access controls. This prototype does not publish a tunnel or deploy models to Vercel.

HTTPS pages contacting localhost may require browser Local Network Access permission or be blocked by browser policy. Run the frontend on localhost for the verified desktop path. The ordinary deployed text lab remains usable when speech is unavailable.

## Five modes

1. **Text → Speech:** choose an agent, its voice, and the speech language; type up to 6,000 characters and generate. Choose a second voice to compare identical text. Replay and download each generated chunk. Presets cover timing, Italian/Japanese pronunciation, bilingual switching, and longer context.
2. **Speech → Text:** choose recognition language, record, or upload a clip under 8 MB and at most 60 seconds. The raw transcript is retained separately from whitespace normalization. If inference fails, use Retry last clip.
3. **Human ↔ AI:** choose the expert and start. Record a turn; its normalized transcript enters that expert's normal pipeline, followed by speech playback. Push-to-talk starts/stops explicitly. Hands-free uses an energy threshold with 850 ms silence detection.
4. **AI ↔ AI:** provide topic, scenario, goal, optional opening, starting speaker, and maximum AI turns. Start, pause/resume, stop, or advance manually. Automatic advancement waits for playback; both experts receive canonical text.
5. **AI ↔ AI ↔ Human:** use the same controls, then record/upload to interrupt and redirect. Mention Giulia or Mei to direct the next response. Direct questions to the human pause automatic turns; Resume lets the AI discussion continue if the human declines.

Use headphones for hands-free mode. Barge-in stops playback and invalidates pending browser results. An already-running desktop inference can finish in the background; if a new request arrives while it is busy, the service returns a retryable error. Manual stop/reset cancels browser requests and releases recording devices.

## Voice identity and bilingual rendering

Voice identity is independent of agent identity. Configured Kokoro style vectors can be averaged with explicit weights: the starter synthetic candidates use Italian/English pretrained styles for Giulia and two Japanese styles for Mei. They are experimental synthetic blends, not a claim of a legally or perceptually unique identity. Four additional local candidates condition Seed-VC on the supplied references. Those reference candidates are direct conditioning experiments; the implementation does **not** claim to blend the identities of those people.

Kokoro accepts style vectors; Seed-VC v1 also has a speaker embedding internally, but its inference additionally conditions on reference acoustics. Averaging only that embedding would not establish a stable novel speaker. Multi-reference interpolation and Seed-VC v2 accent conversion remain follow-up experiments, not hidden assumptions in this release.

The renderer keeps the chosen style embedding/reference fixed across language chunks. Explicit tags choose pronunciation only:

```text
We begin with [[it]]Buongiorno, piacere di conoscerla.[[/it]]
At the meeting, say [[ja]]よろしくお願いします。[[/ja]]
```

Tags are interpreted by the speech renderer; canonical text is not silently rewritten. Untagged words use the selected speech language. Italian words embedded in English are not automatically guaranteed Italian pronunciation. Japanese uses Misaki's Japanese grapheme-to-phoneme path, not an English fallback.

## Timing and diagnostics

Sentence-aware chunks are bounded at 260 characters. One-chunk lookahead overlaps inference with playback. This is incremental playback after a full model response, not streaming LLM tokens or realtime duplex. The existing agent APIs return complete replies, and Whisper returns final transcripts.

The debug panel/export includes speaker, session/turn IDs, raw/normalized human text, exact model messages, canonical reply, voice/backend, rendering settings, model run ID/route, STT/model/TTS timings, first audible playback, chunk durations, errors, and interruption events. `modelResponseStartMs` is null because the current API does not report first-token timing. `ttsMs` sums server generation durations; `firstAudioMs` is measured when playback actually begins; `audioWallMs` includes playback. For a reply to a human, `totalMs` runs from recorded speech end through audio completion. These meanings should not be conflated.

## Validation from this desktop

- Existing baseline: 56 Node tests passed.
- Current suite: 79 Node tests (including 23 voice cases) and 9 Python gateway tests passed after the final lifecycle fixes.
- Real local generation: eight short English/Italian/Japanese clips, plus Italian/Japanese reference conversion and two longer English paragraphs.
- Warm short-clip synthetic generation: approximately 0.8–1.7 seconds. Warm reference conversion: approximately 2.8–3.7 seconds. First reference conversion including model load: approximately 37 seconds.
- Whisper roundtrip recovered expected words in all eight initial short clips, with punctuation differences. This is a small intelligibility smoke test, not an accent-quality score or independent ASR benchmark.
- Browser generation/playback/replay controls rendered successfully. A browser-generated clip reached first audio in 0.79 seconds; uploaded audio returned the expected transcript in 2.49 seconds, with no browser errors observed.
- Real local Qwen 3.5 4B initially returned an empty final response after a long request. Voice Lab paused and retained the error. This existing backend/model behavior was not papered over with a fabricated answer.
- A second uncapped local Qwen 2.5 0.5B integration attempt timed out in the existing Business Giulia call. Neither run establishes live autonomous conversation quality; orchestration and existing API integration passed deterministic automated tests. Configure a working agent endpoint before a user trial.

Run:

```sh
node --test
python voice-service/test_server.py
python voice-service/benchmark.py --config .voice-local/voice.local.json --output .voice-local/benchmarks --roundtrip
```

The Python tests require no models. They verify auth, explicit CORS, byte/audio contracts, raw transcript retention, invalid input, retryable busy state, and private configuration redaction. Node tests verify ordering, canonical handoff, stop/pause/races, failures/retry, role selection, chunking, existing connection integration, and text-lab isolation.

## Limitations and next experiments

- Evaluate accent consistency and naturalness by listening; ASR accuracy alone does not prove either. Compare the same passage at start/middle/end and across English↔Italian and English↔Japanese switches.
- The reused Seed-VC model preserves much of source pronunciation/prosody; the references should not be assumed to teach authentic accented English. Compare a speech-focused checkpoint and v2 style/accent conversion before selecting final voices.
- The VAD is an initial energy gate, not a trained turn detector; it can miss quiet onsets, clip the first consonant, or react to loud playback/background noise. No full duplex echo cancellation claim is made. Measure human turn-ending lag and replace with a trained VAD plus pre-roll next.
- Speaker routing, repetition, and closure are deterministic heuristics. Native-language review and longer multi-turn trials are still required. Objective completion is only prompted, not scored.
- No acoustic speaker-identity drift score, human preference study, streamed partial STT, first-token streaming, or downloaded whole-session audio mix is included.
- Unsupported expressive properties are retained in the normalized speech specification and ignored by the current backend. Only pace is exposed as an advertised control.
- Microphone permission errors are covered by unit tests; a real human's live microphone/barge-in session still needs a manual trial.

## Files

- `public/dual-lab/index.html`: a link to the isolated Voice Lab.
- `public/dual-lab/voice/{index.html,voice.css,app.js}`: five-mode interface and playback/microphone integration.
- `public/dual-lab/voice/{core.js,clients.js,audio.js,presets.js}`: canonical session state, gateway/agent adapters, audio lifecycle, bilingual/timing test texts.
- `voice-service/{server.py,config.example.json,requirements.txt,test_server.py}`: optional local gateway and contracts.
- `tests/voice-lab.test.mjs`: orchestration, failure, and integration tests.
- `.gitignore`: local voice assets and machine configuration exclusions.
- `docs/VOICE_LAB.md`: this handoff.

Upstream references: [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx), [Seed-VC](https://github.com/Plachtaa/seed-vc), [Misaki](https://github.com/hexgrad/misaki). Seed-VC's upstream license and model terms remain applicable; its source and weights are not redistributed in this change.
