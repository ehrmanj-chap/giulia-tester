# Drop question files here

For collaborators who do not want to run Giulia locally.

## Fastest path

1. Log into any standard GitHub.com account that has been invited to this private repository.
2. Open this `evals/inbox` folder on GitHub.
3. Choose **Add file → Upload files**.
4. Upload a `.txt`, `.csv`, `.json`, or `.jsonl` question file and commit it to `main`.
5. Open the repository's **Actions** tab → **Giulia Batch Tester**.
6. The upload automatically starts a run. When it finishes, open the run and download the `giulia-batch-...` artifact.

The hosted Qwen API key and endpoint are already stored as repository Actions secrets. Collaborators do **not** need an Alibaba Cloud account, DashScope login, API key, local Qwen install, Node.js, or Ollama to use the GitHub Actions tester.

The artifact contains:

- a CSV with one row per conversation,
- a full JSON report,
- a Markdown run summary,
- forensic JSON traces for the individual Giulia calls.

Each question is an independent conversation. Several conversations may run in parallel, but their chat histories are never shared.

## Easiest format: TXT

One question per non-empty line:

```text
How formal should I be when meeting an Italian professor?
How could regional identity affect supplier relationships in Italy?
What is the weather in Rome tomorrow?
```

Lines beginning with `#` are ignored.

## CSV format

Use a `question` column. `id` and `expectedRoute` are optional.

```csv
id,question,expectedRoute
culture-1,"What does campanilismo mean in Italy?",cultural
business-1,"How formal should I be with a manager at an Italian company?",business
```

Valid expected routes are `cultural`, `business`, `both`, and `out_of_scope`.

## JSON format

Simple questions:

```json
[
  {"id":"q1","question":"What should I know about Italian dining etiquette?","expectedRoute":"cultural"},
  {"id":"q2","question":"How can family culture affect an Italian family business?","expectedRoute":"both"}
]
```

Multi-turn conversations can use `messages` instead of `question`:

```json
[
  {
    "id": "followup-1",
    "messages": [
      {"role":"user","content":"How formal are introductions in Italy?"},
      {"role":"assistant","content":"They vary with context and seniority."},
      {"role":"user","content":"What about a family-owned supplier in Naples?"}
    ],
    "expectedRoute": "cultural"
  }
]
```

That follow-up is intentionally `cultural`: the practical task is still interpreting introduction etiquette. A professional setting alone does not require the Business route.

## Manual run instead of upload

Go to **Actions → Giulia Batch Tester → Run workflow**. Enter a file already stored in the repo, such as `evals/examples/meeting-demo.json`, choose Qwen or Mock, choose the parallelism level, and run it.

For the complete 120-case evaluation bank, use:

```text
evals/corpus-v1
```

For a quick baseline, use:

```text
evals/examples/meeting-demo.json
```

## Testing prompt edits safely

Do not edit production prompts directly on `main` just to experiment.

1. Create a branch.
2. Edit the prompt file(s) on that branch.
3. Open **Actions → Giulia Batch Tester**.
4. Choose the experimental branch in **Use workflow from**.
5. Run `evals/examples/meeting-demo.json`, a custom test file, or `evals/corpus-v1`.
6. Review/download the artifact before opening a pull request.

Prompt files live in the repository root under `prompts/`:

- `prompts/core.md` - shared Giulia identity, voice, evidence boundary, and no-web policy
- `prompts/router.md` - route classifier contract
- `prompts/cultural.md` - Cultural specialist behavior and grounding
- `prompts/business.md` - Business specialist behavior and grounding
- `prompts/synthesis.md` - combines true `both` responses

The current validated routing baseline should be preserved unless a routing change is intentional. Most near-term Qwen adaptation work should focus on grounding, unsupported-claim handling, verbosity, regional generalization, and synthesis behavior rather than changing the router merely to improve a score.
