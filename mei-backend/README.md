# Mei Backend

Isolated Japan cultural/business intelligence backend for the unlisted `public/dual-lab/` interface.

This directory is deliberately separate from the existing Giulia backend. It does not modify Giulia prompts, knowledge, routing, evaluation workflows, or package configuration.

## API contract

The server mirrors the small portion of Giulia's API that the dual lab needs:

- `GET /api/status`
- `POST /api/chat` with `{ "messages": [{"role":"user","content":"..."}] }`

This lets the dual-lab dropdown switch between two explicit backend URLs without pretending that GitHub Pages itself can run Node.

## Run locally

From this directory:

```powershell
Copy-Item .env.example .env
# fill DASHSCOPE_API_KEY, QWEN_BASE_URL, and QWEN_MODEL as needed
npm start
```

Default local URL: `http://127.0.0.1:8791`.

## Environment

- `DASHSCOPE_API_KEY` — hosted Qwen credential.
- `QWEN_BASE_URL` — OpenAI-compatible Qwen base URL, without a trailing slash.
- `QWEN_MODEL` — model name.
- `MEI_ALLOWED_ORIGIN` — CORS origin. For the deployed lab, set this to the GitHub Pages origin rather than `*` when practical.
- `MEI_LAB_TOKEN` — optional test-lab token. The dual lab sends it using the legacy `X-Giulia-Lab-Token` header for compatibility; the server also accepts `X-Mei-Lab-Token`.
- `MEI_DEV_DIAGNOSTICS` — include routing/retrieval diagnostics in responses.

## Current corpus state

The 2026-09-29 Drive snapshot contains **74 cultural documents and 80 business documents**,
covering 37 cultural and 40 business topics. The compressed snapshots preserve extracted
PDF text and provenance. `knowledge/manifest.json` records the source inventory and hashes.
The loader uses these snapshots; the original four Markdown seed files are historical only.

The root Giulia server also serves this backend under `/api/mei/status` and
`/api/mei/chat`, allowing the dual lab to use one deployed origin. Standalone
hosting from this directory remains supported via `api/index.js` and `vercel.json`.

See [the corpus and lab handoff](../docs/MEI_CORPUS_AND_LAB_HANDOFF.md) for deployment,
reimport, validation, and evaluation details.

## Routing

The first version uses a local heuristic router to avoid spending a separate model call just to classify each message. Cultural, business, mixed, and obviously out-of-scope routes are supported. Mixed questions call both internal domains and synthesize one public Mei answer.

This router is intentionally replaceable once we have enough Mei evaluation cases to justify a model-based classifier.
