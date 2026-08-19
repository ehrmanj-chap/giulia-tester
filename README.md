# Giulia Local

Private, localhost-first prototype for one visible Giulia backed by three all-Qwen roles:

```text
User → Router Giulia
       ├─ Cultural → Giulia Cultural
       ├─ Business → Giulia Business
       └─ Both → Cultural + Business → synthesis
```

The browser never receives the Qwen API key. The local Node server owns all model calls. No web-search, browsing, URL-fetch, or arbitrary tool capability is exposed to Giulia.

## Quick start: mock mode

Requires Node 20+.

```powershell
Copy-Item .env.example .env
npm start
```

Open `http://127.0.0.1:8787`.

The example env defaults to `GIULIA_PROVIDER=mock`, so the complete routing/UI/trace plumbing works without Qwen.

## Turn on Qwen

Edit `.env`:

```text
GIULIA_PROVIDER=qwen
DASHSCOPE_API_KEY=YOUR_KEY_HERE
QWEN_BASE_URL=YOUR_MODEL_STUDIO_OPENAI_COMPATIBLE_BASE_URL
QWEN_MODEL=qwen3.7-max
QWEN_ROUTER_MODEL=qwen3.7-max
```

Then restart `npm start`.

Do not commit `.env`. It is gitignored.

## Prompts and KB

- `prompts/core.md`
- `prompts/router.md`
- `prompts/cultural.md`
- `prompts/business.md`
- `prompts/synthesis.md`
- `knowledge/cultural/`
- `knowledge/business/`

Current KB loading is intentionally simple: readable text files are concatenated into the specialist context. Once the real corpus arrives, this layer can be replaced with indexed retrieval without changing the rest of Giulia.

## Forensic traces

Every local chat run can write a JSON trace to `runs/`. Traces record:

- conversation input
- route and short observable route reason
- model calls and outputs
- prompt hashes and sizes
- KB hashes and source filenames
- latency / usage metadata when the provider returns it
- final visible answer

They never record API keys.

## Evaluation

Mock plumbing suite:

```powershell
npm test
npm run eval
```

Real Qwen suite:

```powershell
$env:GIULIA_PROVIDER='qwen'
npm run eval:qwen
```

Reports are saved in `eval-results/`; per-run evidence is saved in `runs/`.

## Private GitHub Actions eval bridge

`.github/workflows/eval.yml` is manual-only. In this private repo, add:

- repository secret `DASHSCOPE_API_KEY`
- repository secret `QWEN_BASE_URL`
- optional repository variables `QWEN_MODEL` and `QWEN_ROUTER_MODEL`

Then manually run **Manual Giulia Eval**. It uploads `eval-results/` and `runs/` as an artifact for later review.
