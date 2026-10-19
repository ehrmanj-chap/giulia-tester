# Kelsie quick start: internal Giulia/Mei tester

> **This is the internal experiment and evaluation repo, not the public visitor site.** The public cultural-agent webpage lives at [chapman-cultural-agents](https://github.com/ehrmanj-chap/chapman-cultural-agents) and embeds Relevance AI; the [AI Garage lessons](https://github.com/ehrmanj-chap/agentics_labs_lectures) are separate again. The GitHub Actions evaluator can be operated from a browser. It does not require you to install Node.js, Ollama or Qwen locally.

## Access

- Repository (source currently **public**): https://github.com/ehrmanj-chap/giulia-tester
- GitHub Actions tester: https://github.com/ehrmanj-chap/giulia-tester/actions/workflows/eval.yml
- Prompt folder: https://github.com/ehrmanj-chap/giulia-tester/tree/main/prompts
- 120-case Giulia routing evaluation corpus: https://github.com/ehrmanj-chap/giulia-tester/tree/main/evals/corpus-v1
- Question upload inbox: https://github.com/ehrmanj-chap/giulia-tester/tree/main/evals/inbox
- Internal dual lab source: https://github.com/ehrmanj-chap/giulia-tester/tree/main/public/dual-lab

**Anyone can read the repository.** Kelsie must be invited to GitHub with her **own GitHub username** and appropriate repository permission to edit/merge changes and run the manual Actions workflow. The source code being public does **not** mean GitHub Actions secrets, Vercel settings or the Qwen provider account are public. Ask the GitHub repository administrator to confirm this access, rather than using someone else's account.

## Safest first run: no provider cost

1. Open the **GitHub Actions tester** link while signed into an account with permission.
2. Click **Run workflow** and leave **Use workflow from** on \`main\`.
3. Enter \`evals/examples/meeting-demo.json\` for \`source_file\`.
4. Choose **mock** as provider and **1** as concurrency, then **Run workflow**.
5. Open the new run. If it succeeds, download its artifact and review the result.

Mock runs check wiring and predictable test responses; **they do not prove real-agent factual quality**. After the project owner verifies model account ownership/billing and hosted configuration, repeat a **small** test using \`qwen\` to evaluate real model outputs. Never paste a DashScope API key into GitHub files or chat.

## Run the complete evaluation corpus

Repeat the same steps, but use this as `source_file`:

`evals/corpus-v1`

That directory contains the current 120-case evaluation bank.

## Test your own questions

### Easiest option: TXT

Create a text file with one question per line, for example:

```text
How formal should I be when meeting an Italian professor?
How could family culture affect succession in an Italian family business?
What is the weather in Rome tomorrow?
```

Upload the file to `evals/inbox/` using **Add file → Upload files**. If you commit a supported question file to `main`, the Giulia Batch Tester starts automatically.

Supported formats: `.txt`, `.csv`, `.json`, `.jsonl`.

## Where the prompts are

All prompt files are in `prompts/`:

| File | Purpose |
|---|---|
| `prompts/core.md` | Shared public Giulia identity, voice, scope, evidence boundary, and no-web policy |
| `prompts/router.md` | Classifies each turn as Cultural, Business, Both, or out-of-scope |
| `prompts/cultural.md` | Cultural specialist instructions and grounding behavior |
| `prompts/business.md` | Business specialist instructions and grounding behavior |
| `prompts/synthesis.md` | Combines Cultural + Business drafts for true Both questions |

Current recommendation: preserve the validated router baseline unless you intentionally want to change routing. The first Qwen adaptation pass should concentrate on grounding, unsupported factual claims, verbosity, regional generalization, and synthesis behavior.

## Safest way to edit prompts

Use a branch so experimental prompts do not change `main` until they are reviewed.

1. From the repository, create a new branch, for example `kelsie-prompt-revision-1`.
2. Open the prompt file you want to change.
3. Click the pencil icon, edit it, and commit the edit to your branch.
4. Go to **Actions → Giulia Batch Tester**.
5. In **Use workflow from**, choose your branch.
6. Run `evals/examples/meeting-demo.json` first.
7. If the baseline still looks good, run a targeted test file or `evals/corpus-v1`.
8. Download the artifact and review the responses.
9. Open a pull request when the prompt revision is ready for review.

## What the four routes mean

- `cultural`: Italian culture, etiquette, social interpretation, language/register, regional identity, everyday social behavior.
- `business`: Italian business, management, market, legal/regulatory, workplace, investment, institutional, or operational decisions.
- `both`: only when Cultural and Business are independently necessary to answer the user's actual task.
- `out_of_scope`: no meaningful Italy-focused Cultural or Business task, including live tourist logistics such as weather.

Important boundary example: “What if the meeting is with a family-owned supplier in Naples?” remains `cultural` when the established question is how formal the introduction should be. The professional setting does not automatically make a social-meaning question Business or Both.

## Credentials and security

The hosted Qwen workflow expects credentials in GitHub Actions secrets. Only authorized maintainers can verify whether those are currently configured and valid. You should never need to see, copy, or paste the DashScope API key. The Action uses it automatically.

Do not add API keys to source files, prompts, test files, commits, issues, or pull requests.

## If something fails

Check these in order:

1. Did you choose a supported input file or `evals/corpus-v1`?
2. Is the provider set to `qwen` for a real model run?
3. Did the **Unit tests with mock provider** step pass?
4. Did **Check hosted Qwen configuration** pass?
5. Open the failed step for the exact error.
6. Send the run link or downloaded artifact to Jordan if you want a second look.

GitHub normally masks configured secret values, but avoid deliberately printing tokens, URLs with embedded credentials, or private prompts in logs.
