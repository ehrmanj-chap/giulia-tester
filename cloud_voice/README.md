# Chapman cloud voice inference (Vercel + Modal)

**Status: cloud code is staged for review, not running until Modal credentials,
private model assets, and Vercel environment variables are supplied.** The
frontend must not silently synthesize with Microsoft/Edge device voices when
the original Kokoro service is unavailable.

## Architecture

```text
Giulia / Mei browser
       |
       | same-origin request + short-lived demo access token
       v
Vercel /api/voice/v1/{status,tts,stt}
       |
       | secret backend-to-backend token (never returned to browser)
       v
Modal ASGI endpoint /v1/{status,tts,stt}
       |
       v
Autoscaled inference containers (CPU + optional GPU)
       |
       +-- Original Kokoro ONNX weights + original exact style blends
       +-- Private Seed-VC reference clips and weights, when separately installed
       +-- Whisper-small STT model snapshot
       |
       v
Private Modal Volume: chapman-voice-assets
```

The original `voice-service/server.py` remains the inference implementation.
Cloud deployment imports its **same** `SpeechEngine`, so the interface no longer
has to pretend the operating system's installed voices are Giulia or Mei.
The public checked-in `cloud_voice/config.example.json` is merely an example,
not the final source of truth for your privately configured voice IDs, custom
weights, or reference recordings.

## What is already implemented

- Autoscaling Modal web service with maximum container count and zero always-on
  containers by default, to guard against unexpectedly high compute costs.
- Authenticated `/v1/status`, `/v1/tts` and `/v1/stt`, returning the same
  audio and transcript contract used by the original desktop Voice Lab.
- Private model loading from a persistent read-only Volume and credentials
  from a separately managed Modal Secret. No references or model weights are
  baked into the Docker image, repo, or Vercel functions.
- Three same-origin Vercel API functions that authenticate callers and add
  the server-side Modal token. No arbitrary upstream URL is accepted.
- Browser TTS fallback is **not** selected automatically. Missing speech
  credentials or failed inference produce an explicit visible error.

## Complete the first secure deployment

**1. Modal account**: Create/select a Modal workspace. Install the CLI into a
Python 3.11+ environment and authorize it locally:

```bash
python -m pip install modal
modal setup
```

**2. Private assets**: In the Modal dashboard or CLI create a Volume named
`chapman-voice-assets`. Collect the actual local speech assets into a private
folder *outside Git* with this suggested layout:

```text
private-cloud-assets/
  config.json                  # exact edited copy of .voice-local/voice.local.json
  models/
    kokoro-v1.0.onnx
    voices-v1.0.bin
    whisper-small/             # complete local Whisper snapshot if STT is wanted
  references/                  # private local 6–10 s recordings (optional)
  seed-vc/                     # code + checkpoints, optional; must be validated
```

Within `config.json`, point relative paths at those Volume paths, e.g.
`"./models/kokoro-v1.0.onnx"` and `"./models/voices-v1.0.bin"`.
**Copy the entire original `voices` list unchanged**, preserving each ID,
agent assignment, style weight and reference, rather than treating the example
file as your trained configuration. `load_config` resolves paths relative to
the location of `config.json`. Missing files fail startup, not silently
select device voices. `useGpuForWhisper: true` enables GPU recognition
if GPU hardware is available.

Upload that private directory using your own Modal credentials:

```bash
modal volume create chapman-voice-assets
modal volume put chapman-voice-assets private-cloud-assets/ /
modal volume ls chapman-voice-assets
```

The upload syntax and destination should be verified with
`modal volume put --help` for your installed CLI. **Do not push the assets,
reference recordings, or real cloud config to GitHub.**

**3. Secret**: Use Modal dashboard → Secrets → create `chapman-voice-service`
with `VOICE_BACKEND_TOKEN` set to a cryptographically random secret of at
least 24 characters. Do not paste the value in chat or commit it.

**4. Deployment**: From the repository root:

```bash
# Defaults: L4 GPU, 0 permanently warm workers, up to 5 concurrent containers.
modal deploy cloud_voice/modal_app.py
```

Adjust the compute budget before invoking the CLI by setting shell environment
values `VOICE_MODAL_GPU` (L4, T4, or "none" for CPU),
`VOICE_MODAL_MIN_CONTAINERS` (0 by default), and
`VOICE_MODAL_MAX_CONTAINERS` (5 by default). Private reference conversion
(Seed-VC) may require its upstream dependencies and model snapshots, which
were installed only on the original desktop and are **not** included in a
generic Modal container build. Treat Seed-VC as unverified until it passes a
real cloud reference audition. The public synthetic Kokoro style blends are
not equivalent to reference-conditioned voices.

After `modal deploy`, record the **actual HTTPS ASGI endpoint** printed by
Modal. It must expose the `/v1/status` path. Do not invent a cloud endpoint
or hard-code a workspace identifier.

**5. Vercel environment**: In the existing
`kootlefoosh / giulia-tester` project → Settings → Environment Variables,
set these for the **Preview** environment first:

| Variable | Value | Browser-visible? |
| --- | --- | --- |
| `VOICE_BACKEND_URL` | Modal HTTPS origin, no path | No |
| `VOICE_BACKEND_TOKEN` | Same secret as in Modal | **Never** |
| `VOICE_DEMO_ACCESS_TOKEN` | Different strong lab-access secret | Only entered by invited tester |

Keep production values unset until the live service passes a manual demo.
The web interface points by default at its same-origin
`/api/voice` endpoint on hosted Vercel deployments. It asks for the
`VOICE_DEMO_ACCESS_TOKEN` in the existing voice connection settings. That
token is held only in the browser tab; it is not persisted by the app.

**6. Verification before promotion**: Open the current preview
`/dual-lab/voice/`. Confirm the engine is **Kokoro/Whisper** and connect with
the lab-access token. Try a sample for both Giulia and Mei, verify each
returned `X-Voice-Backend` and voice ID, then use audio upload, human/AI
and autonomous AI/AI dialogue with working text-model backends.

Local no-model tests:

```bash
npm test
python voice-service/test_server.py
python -m py_compile cloud_voice/modal_app.py
```

## What must be completed before public traffic

This is a **closed pilot**, not an unrestricted public API for thousands yet.
The temporary shared `VOICE_DEMO_ACCESS_TOKEN` is intentionally fail-closed
when unset, but is **not** end-user authentication. Before a public launch,
require individual identity/session verification, distributed per-user quotas,
usage metering, abuse detection, cancellation policy, request size limits
(including Vercel's 3.5 MB STT upload budget), monitoring, and explicit cloud
spend alerts/budgets. Autoscaling is not proof of performance at 1,000
simultaneous sessions. Benchmark each model, playback time, p95/p99 latency,
Cold Start, queue depth, GPU/CPU cost, and provider concurrency quotas.

The optional `Seed-VC` conversion is heavier than Kokoro synthesis.
For scale it should eventually get a separate GPU deployment and queue; keep
Kokoro and Whisper workers independently sized. Never redistribute a third
party's reference recording without appropriate consent and licensing.

## Rollback and debugging

- No new production promotion or original text-model route is required for
  the preview.
- If Modal is unconfigured, the proxy returns HTTP 503 with a descriptive
  error. **It will not pretend that Microsoft speech is Kokoro.**
- To disable the hosted voice service, remove the three Vercel Preview env
  vars or disable the Modal app, preserving the normal text lab.
- Modal secrets stay private and should be rotated independently from the
  temporary end-user demo token. Keep diagnostics free of audio bytes, tokens,
  personal data and reference filenames.

Sources: https://modal.com/docs/guide/webhooks,
https://modal.com/docs/guide/volumes,
https://modal.com/docs/guide/secrets,
https://modal.com/pricing,
https://vercel.com/docs/functions/runtimes/node-js
