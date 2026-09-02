# Drop question files here

For collaborators who do not want to run Giulia locally:

1. Open this `evals/inbox` folder on GitHub.
2. Choose **Add file → Upload files**.
3. Upload a `.txt`, `.csv`, `.json`, or `.jsonl` question file and commit it to `main`.
4. Open the repository's **Actions** tab → **Giulia Batch Tester**.
5. The upload automatically starts a run. When it finishes, open the run and download the `giulia-batch-...` artifact.

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
    "expectedRoute": "both"
  }
]
```

## Manual run instead of upload

Go to **Actions → Giulia Batch Tester → Run workflow**. Enter a file already stored in the repo, such as `evals/examples/meeting-demo.json`, choose Qwen or Mock, choose the parallelism level, and run it.

Hosted Qwen credentials are repository secrets. Collaborators running the workflow do not need to know or paste the API key.
