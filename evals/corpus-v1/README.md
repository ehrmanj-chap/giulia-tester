# Giulia evaluation corpus v1

This corpus is designed for prompt and routing evaluation across the unified Cultural + Business Giulia system.

## Contents

- `cultural.json` — 30 clean Cultural cases.
- `business.json` — 30 clean Business cases.
- `both.json` — 20 cases that genuinely require both specialist domains.
- `out-of-scope.json` — 15 clear scope failures and live-logistics requests.
- `boundaries-and-guardrails.json` — 25 multi-turn, route-boundary, identity, stale-data, stereotype, false-premise, no-web, and hallucination tests.

Total: **120 cases**.

Expected route distribution:

- Cultural: 41
- Business: 42
- Both: 20
- out_of_scope: 17

Each JSON case may include:

- `id`
- `question` or a multi-turn `messages` array
- `expectedRoute`
- `tags`
- `evalFocus`
- `expectedBehavior`

The expected behavior metadata is qualitative. It is meant for human or model-assisted review after the run, not as a simplistic exact-string grader.

## Run the full corpus in GitHub Actions

Open **Actions → Giulia Batch Tester → Run workflow** and use:

- Question file or directory: `evals/corpus-v1`
- Brain: `qwen`
- Parallel conversations: `4` to start

The workflow accepts a directory and runs each supported question file inside it. The artifact contains CSV and JSON reports plus forensic traces.

The JSON report snapshots the Git commit and the exact `core.md`, `router.md`, `cultural.md`, `business.md`, and `synthesis.md` prompts used for that run. This makes comparisons between prompt revisions self-contained.

## Review strategy

Do not optimize solely for route accuracy. Review failures by layer:

1. Routing: wrong Cultural / Business / Both / out-of-scope choice.
2. Retrieval: correct route but poor or irrelevant evidence reached the specialist.
3. Specialist behavior: evidence was adequate but the Cultural or Business draft was weak.
4. Synthesis: both specialist drafts were useful but the merged answer lost nuance or introduced duplication.
5. Public persona: internal names or architecture leaked, language choice was wrong, or tone drifted.
6. Knowledge boundary: Giulia invented current facts, citations, web verification, or unsupported detail.

The boundary bank is intentionally difficult and should be used to diagnose prompt behavior rather than treated as a leaderboard.
