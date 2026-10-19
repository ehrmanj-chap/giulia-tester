# Giulia tester: internal cultural-agent lab

> **Maintainers: start here.** This is the **internal engineering and evaluation laboratory** for Giulia (Italy) and Mei (Japan), including hosted Qwen backends, test corpora, the dual-agent interface and experimental voice tools. It is **not** the public Chapman cultural-agents site. The public-facing site is [chapman-cultural-agents](https://github.com/ehrmanj-chap/chapman-cultural-agents) and currently embeds **Relevance AI** agents. AI Garage's beginner workshops are at [agentics_labs_lectures](https://github.com/ehrmanj-chap/agentics_labs_lectures).

**Two paths for two audiences:**
- **Kelsie / student facilitator with no coding setup:** [Browser-only GitHub Actions guide](docs/KELSIE_QUICKSTART.md). Begin with the **mock** (no-model-cost) demo test. Changing prompts and running paid-provider tests requires appropriate repo access and approval.
- **Technical maintainer:** Continue to the local setup, source manifests, evaluation commands and debugging instructions below. Only change code, cloud configuration or prompts on a reviewed branch.

**Repository access:** The GitHub repository is **public as of October 2026**, which means anyone can read the source code, not that anyone can edit the repo or operate the live lab. Kelsie needs appropriate collaborator permission (and durable administrator coverage). Live Vercel deployments may require authorization and their status is **not** established merely by a successful build.

**Provider/security boundary:** Hosted Qwen calls have separate provider credentials and potential usage charges. Do not share API keys in README files, chat messages or commits. Browser-side Kokoro speech synthesis does **not** pay for or replace the hosted language models. Saanvi research exists in Drive but is **not documented here as a verified deployed agent**.

## Local architecture reference

A localhost-first prototype for one visible Giulia backed by three internal Qwen roles:

```text
User → Router Giulia
       ├─ Cultural → Giulia Cultural
       ├─ Business → Giulia Business
       └─ Both → Cultural + Business → synthesis
```

## Browser-only collaborator quick start

**No local setup is required to test hosted Giulia.** A collaborator with appropriate GitHub permissions can sign into a normal GitHub.com account, run the hosted Qwen tester from GitHub Actions, edit prompts on a branch, and download complete evaluation artifacts without seeing or copying the DashScope credentials.

Start here: **[`docs/KELSIE_QUICKSTART.md`](docs/KELSIE_QUICKSTART.md)**

Direct workflow: **[Giulia Batch Tester](../../actions/workflows/eval.yml)**

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

1. **Manual:** choose **Run workflow**, point it at a stored `.txt`, `.csv`, `.json`, `.jsonl` question file, or an evaluation directory such as `evals/corpus-v1`; choose Qwen or Mock; and choose 1/2/4/8 parallel conversations.
2. **Upload-and-run:** upload a supported question file to `evals/inbox/` and commit it to `main`. The batch runs automatically.

Each question is isolated as its own conversation. The Action returns a downloadable artifact containing CSV answers, a full JSON report, a Markdown summary, and forensic traces. Hosted-Qwen credentials stay in repository Actions secrets, so collaborators do not need the API key themselves.

See `docs/KELSIE_QUICKSTART.md` for the browser-only walkthrough, `evals/inbox/README.md` for copy-paste formats, and `evals/examples/meeting-demo.json` for a ready-made demo set.

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
