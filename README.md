# Giulia Local

Private, localhost-first prototype for one visible Giulia backed by three internal Qwen roles:

```text
User → Router Giulia
       ├─ Cultural → Giulia Cultural
       ├─ Business → Giulia Business
       └─ Both → Cultural + Business → synthesis
```

## Current lab state

**Router Giulia is live. Cultural Giulia is live. Business Giulia is scaffolded but intentionally has no knowledge corpus yet.**

The local server detects corpus availability automatically:
- Cultural route + Culture corpus present → retrieve evidence and answer.
- Business route + Business corpus absent → report the missing internal evidence layer instead of letting an empty specialist hallucinate.
- Both route while Business is absent → answer the Cultural portion and mark the result incomplete for internal testing.
- Once Business documents are added, the full `both` path automatically calls both specialists and synthesis.

## Riverbot-style Qwen setup

Giulia mirrors the local CHRONEBBI/Riverbot arrangement: Ollama runs Qwen on your machine and Giulia talks to Ollama's local chat endpoint.

Default lab configuration:

```text
provider: ollama
model: qwen3.5:9b
endpoint: http://localhost:11434/api/chat
context: 8192
keep_alive: 30m
```

No API key is required. The browser talks only to the localhost Giulia server; the Giulia server talks only to local Ollama. No web-search, browsing, URL-fetch, or arbitrary tool capability is exposed to Giulia.

## Quick start

Requires Node 20+ and Ollama with `qwen3.5:9b` already installed.

```powershell
Copy-Item .env.example .env
ollama list
npm start
```

Open:

```text
http://127.0.0.1:8787
```

If Ollama is not already running, start the Ollama desktop app/service first.

### Smoke-test the model directly

```powershell
ollama run qwen3.5:9b
```

If that works, Giulia should be able to reach the same model through `http://localhost:11434/api/chat`.

## Knowledge retrieval

Cultural Giulia currently has the 25-document approved Culture corpus.

The corpus is expanded into individual source documents, chunked locally, and ranked lexically for each conversation turn. Only the best relevant passages are placed in Qwen's context. No embeddings service, vector database, external search, or internet retrieval is required.

Retrieval and model-call evidence are written into the forensic trace so we can inspect exactly which source chunks reached Qwen.

## Prompts

- `prompts/core.md` — one public Giulia identity, shared voice, evidence boundary, no-web rule
- `prompts/router.md` — Cultural / Business / Both / out-of-scope routing contract
- `prompts/cultural.md` — Cultural Giulia behavior and grounding protocol
- `prompts/business.md` — Business Giulia behavior; corpus arrives next
- `prompts/synthesis.md` — seam-hiding merge for true Both questions

## Forensic traces

Every local chat run can write a JSON trace to `runs/`. Traces record conversation input, route, model calls/outputs, prompt and KB hashes, retrieved source chunks, timing/usage metadata, and the final visible answer. They never record API keys.

## Evaluation

Run the local non-Qwen tests:

```powershell
npm test
npm run eval:mock
```

The current suite checks Culture retrieval, route boundaries, multi-turn routing, out-of-scope behavior, and the Culture-only bootstrap state.

Run the same router suite against real local Qwen:

```powershell
npm run eval:ollama
```

Reports are saved in `eval-results/`; per-run evidence is saved in `runs/`. Those can be handed back to ChatGPT for side-by-side review against old Giulia behavior.

## Optional hosted Qwen

The hosted-Qwen adapter remains in the codebase for later experiments, but it is not needed for intra-lab testing and is not the default.
