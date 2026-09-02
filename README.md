# Giulia Local

Private, localhost-first prototype for one visible Giulia backed by three internal Qwen roles:

```text
User → Router Giulia
       ├─ Cultural → Giulia Cultural
       ├─ Business → Giulia Business
       └─ Both → Cultural + Business → synthesis
```

## Current lab state

**Router Giulia, Cultural Giulia, and Business Giulia all have their current lab corpora loaded.**

- Cultural: 25 unique documents.
- Business: 25 unique documents (26 supplied; one byte-for-byte duplicate removed).
- `cultural` route → Culture retrieval → Cultural Giulia.
- `business` route → Business retrieval → Business Giulia.
- `both` route → both retrieval layers and specialists → one Giulia synthesis.
- `out_of_scope` route → Italy-scope redirect without calling a specialist.

## GitHub Actions batch testing (no local setup)

Collaborators can test Giulia entirely from GitHub using **Actions → Giulia Batch Tester**.

Two workflows are supported:

1. **Manual:** choose **Run workflow**, point it at a stored `.txt`, `.csv`, `.json`, or `.jsonl` question file, choose Qwen or Mock, and choose 1/2/4/8 parallel conversations.
2. **Upload-and-run:** upload a question file to `evals/inbox/` and commit it to `main`. The batch runs automatically.

Each question is isolated as its own conversation. The Action returns a downloadable artifact containing CSV answers, a full JSON report, a Markdown summary, and forensic traces. Hosted-Qwen credentials stay in repository Actions secrets, so collaborators do not need the API key themselves.

See `evals/inbox/README.md` for copy-paste formats and `evals/examples/meeting-demo.json` for a ready-made demo set.

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

Both specialists now use approved local corpora:

- Cultural Giulia: 25 documents.
- Business Giulia: 25 documents.

The corpora are expanded into individual source documents, chunked locally, and ranked lexically for each conversation turn. Only the best relevant passages are placed in Qwen's context. No embeddings service, vector database, external search, or internet retrieval is required.

Retrieval and model-call evidence are written into the forensic trace so we can inspect exactly which source chunks reached Qwen.

## Prompts

- `prompts/core.md` — one public Giulia identity, shared voice, evidence boundary, no-web rule
- `prompts/router.md` — Cultural / Business / Both / out-of-scope routing contract
- `prompts/cultural.md` — Cultural Giulia behavior and grounding protocol
- `prompts/business.md` — Business Giulia behavior and grounding protocol
- `prompts/synthesis.md` — seam-hiding merge for true Both questions

## Forensic traces

Every local chat run can write a JSON trace to `runs/`. Traces record conversation input, route, model calls/outputs, prompt and KB hashes, retrieved source chunks, timing/usage metadata, and the final visible answer. They never record API keys.

## Evaluation

Run the local non-Qwen tests:

```powershell
npm test
npm run eval:mock
```

Run a local batch file:

```powershell
npm run batch -- --provider=ollama --concurrency=4 --file=evals/examples/meeting-demo.json
```

The current suite checks both corpora, Culture and Business retrieval, route boundaries, multi-turn routing, out-of-scope behavior, and the full two-specialist synthesis path.

Run the same router suite against real local Qwen:

```powershell
npm run eval:ollama
```

Reports are saved in `eval-results/`; per-run evidence is saved in `runs/`. Those can be handed back to ChatGPT for side-by-side review against old Giulia behavior.

## Optional hosted Qwen

The hosted-Qwen adapter is used by the GitHub Actions batch tester. Local testing can continue to use Ollama instead.
