# Zero-bill speech: Kokoro runs in the visitor's browser

**Current approach. No Modal, GPU rental, model-serving function, cloud
inference account, or credit card is required for Kokoro text-to-speech.**

The site and existing text backends may still have their *own* hosting and
model/provider limits. Vercel Hobby and GitHub Pages are not unlimited
commercial-grade hosting promises. This change removes every Modal deployment
file, Vercel voice proxy endpoint and its private backend secrets from the
Audio Lab staging branch. It does not configure any paid service.

## How it works

```text
Vercel / GitHub Pages (HTML, CSS, JS)
                 |
            Browser loads
     public Kokoro 82M ONNX q8 model
                 |
     ~90 MB first run, browser cache
                 |
    G2P English + 256D voice style
           interpolation
                 |
      Browser WebAssembly CPU
                 |
       WAV clip + playback
```

The model bytes are **downloaded by the visitor directly from Hugging Face**;
Kokoro-JS is loaded from jsDelivr CDN. Neither provider performs voice
inference for this app. Visitors must have an internet connection on first
load; the library/model downloads rely on those public hosts remaining
available. No API key, payment, or server GPU is needed for this pathway.
Downloaded data may be cached by the browser, subject to browser storage
settings.

## Voice identity and language boundaries

The **public source-controlled seed profiles**, mirrored precisely from the
original `voice-service/config.example.json`, are:

- Giulia: `if_sara` (65%) + `af_heart` (35%).
- Mei: `jf_alpha` (60%) + `jf_nezumi` (40%).

Each input's phoneme token count selects its row of each public Kokoro style
vector. The vectors are **interpolated before synthesis**. We do not average
two generated audio clips or call Microsoft speech synthesis in the default
pathway. Every synthesis request stays on the user's machine.

These are the exact *seed blend definitions* from the existing public example.
**They are not proof that the final privately configured, reference-conditioned
Giulia and Mei voices sound identical to the previous desktop experiment.**
If that experiment used private Seed-VC references, it cannot be reproduced
from these public profiles alone. Private trained model weights/recordings
remain private and were not committed.

The upstream JavaScript phonemizer currently supports **English**. Italian
and Japanese voice **timbres** may be heard when reading English; true native
Italian/Japanese pronunciation, multi-reference conversion, native Whisper
recognition, and the Seed-VC acoustic reference models remain in the original
Python gateway. Selecting Italian/Japanese for browser Kokoro produces a
visible unsupported-mode error, never an implicit switch to a generic voice.

## Frontend choices

Audio Lab `/dual-lab/voice/`:
- Default **Giulia + Mei · Kokoro on this device**.
- **Original Python Kokoro / Whisper gateway** only for researchers with an
  already-running service. It is separate from hosting, not required for the
  free pathway.
- **Generic browser voices · NOT Kokoro** is always explicitly opt-in.
- Human ↔ AI and AI ↔ AI still require working Giulia/Mei text-model APIs.
  Local TTS does not make those LLM model calls free.
- Browser microphone STT, when opted into, may use the browser vendor's
  servers and is **not** our local Whisper; typed intervention is labeled
  `typed-input-not-stt`.

Dual Lab `/dual-lab/`:
- **Read aloud** and automatic readout now select Kokoro on-device by default.
- Original Python gateway and generic system voice playback remain manual
  source choices.
- The original canonical response text never changes as a result of playback.

## Browser performance and cost caveats

- WebAssembly CPU works across more browsers than WebGPU, but the first
  model load is large (~90 MB in q8 form) and playback can be slow or fail on
  low-memory devices; memory usage is higher than the download size.
- No runtime-scaling guarantee: user devices provide all TTS compute. Browser
  cache and external file hosts have their own limits.
- For a true public service at thousands-of-users scale, **there is no
  credible unlimited zero-cost hosting guarantee**. Monitor transfer,
  model-download availability, and actual text-LLM billing separately.
- Vercel Hobby is restricted to non-commercial personal uses. A paid
  research/work deployment must confirm its eligibility or use approved
  institutional hosting; do not assume the account's existing plan is Hobby.
- GitHub Pages can host the static lab, but has a soft 100 GB/month bandwidth
  limit and other usage restrictions.

## Verification and deployment

No cloud provisioning or billing. Only the existing repo's standard preview
workflow. On a branch, Vercel generates a preview; GitHub Pages serves the
`public/` directory from its configured production branch.

```sh
npm test
node --check public/dual-lab/voice/browser-kokoro.js
node --check public/dual-lab/voice/app.js
node --check public/dual-lab/app.js
```

For a **real browser** smoke test (which cannot be proven by Node unit tests):
1. Visit `/dual-lab/voice/`, select on-device Kokoro and Text → Speech.
2. Leave language as English (US). Generate a short sentence.
3. The first run downloads the q8 model and public voices. Verify real WAV
   playback, not `window.speechSynthesis`. Re-run to confirm caching.
4. Change Agent to Mei and generate the same sentence. Compare the actual
   timbres, and listen to original desktop seed blends before claiming parity.
5. Open normal Dual Lab, enable readout, and confirm the selected engine reads
   the agent reply. Toggle generic system voices only if deliberate.
6. Confirm a blocked network/model download produces a visible error,
   preserves the canonical text, and does not secretly switch to Microsoft.
7. Check that no billing-enabled cloud voice endpoints are deployed.

References:
- https://github.com/hexgrad/kokoro/tree/main/kokoro.js
- https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
- https://vercel.com/docs/plans/hobby
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
