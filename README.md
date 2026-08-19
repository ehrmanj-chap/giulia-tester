# Giulia Local

Private, localhost-first prototype for one visible Giulia backed by three internal Qwen roles:

```text
User → Router Giulia
       ├─ Cultural → Giulia Cultural
       ├─ Business → Giulia Business
       └─ Both → Cultural + Business → synthesis
```

## Riverbot-style Qwen setup

Giulia now mirrors the local CHRONEBBI/Riverbot arrangement: Ollama runs Qwen on your machine and Giulia talks to Ollama's local chat endpoint.

Default lab configuration:

```text
provider: ollama
model: qwen3.5:9b
endpoint: http://localhost:11434/api/chat
context: 8192
keep_alive: 30m
```

No API key is required. The browser talks only to the localhost Giulia server; the Giulia server talks only to local Ollama. No web-search, browsing, URL-fetch, or arbitrary tool capability is exposed to any Giulia role.

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

## Mock mode

To test the whole application without running Qwen:

```powershell
$env:GIULIA_PROVIDER='mock'
npm start
```

Or set `GIULIA_PROVIDER=mock` in `.env`.

## Prompts and KB

- `prompts/core.md`
- `prompts/router.md`
- `prompts/cultural.md`
- `prompts/business.md`
- `prompts/synthesis.md`
- `knowledge/cultural/`
- `knowledge/business/`

Current KB loading is intentionally simple: readable text files are concatenated into the specialist context. Once the real corpus arrives, this layer can be replaced with indexed retrieval without changing the visible Giulia architecture.

## Forensic traces

Every local chat run can write a JSON trace to `runs/`. Traces record conversation input, route, model calls/outputs, prompt and KB hashes, source filenames, timing/usage metadata, and the final visible answer. They never record API keys.

## Evaluation

Mock plumbing suite:

```powershell
npm test
npm run eval:mock
```

Real local Qwen suite:

```powershell
npm run eval:ollama
```

Reports are saved in `eval-results/`; per-run evidence is saved in `runs/`. Those can be handed back to ChatGPT for side-by-side review against old Giulia behavior.

## Optional hosted Qwen

The old hosted-Qwen adapter remains in the codebase for later experiments, but it is not needed for intra-lab testing and is no longer the default.
