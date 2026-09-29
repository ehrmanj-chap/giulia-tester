# Mei corpus and Chapman internal lab — 2026-09-29

## Source snapshot

Mei now has **154 source documents across 77 topics**: 74 cultural documents
(37 topics) and 80 business documents (40 topics). Each topic includes its
original research PDF and an Additional Research companion. Text was fetched
from all accessible files in the two Drive folders, without summarization.
Original PDFs stay in Drive; this repository stores their extracted text.

- Cultural: https://drive.google.com/drive/folders/17FpDD6srXP4A22-ZdC5dKxwbeFh7JDgr
- Business: https://drive.google.com/drive/folders/1sLYQ3wngvVUGBkxd0cpcTpmwLCO7w2mb
- `mei-backend/knowledge/manifest.json`: titles, Drive IDs/URLs, categories,
  original/supplementary classification, modification dates, text hashes.
- `knowledge/{cultural,business}/drive-corpus.json.gz`: deterministic compressed
  snapshots containing the full extracted text and source metadata.

The four earlier Markdown seed files remain as historical reference. The new
loader reads the Drive snapshots only, avoiding double-counting those summaries.
Kelsie's merged core, cultural, and business persona files are unchanged.

## Retrieval

The backend indexes 1,075 overlapping passages. A specialist receives at most
four passages and a 9,000-character evidence budget. Ranking combines term
frequency, inverse document frequency, length normalization, and title matches.
Diagnostics retain source ID, URL, passage index, and text offsets.
This is lexical retrieval, not semantic embeddings. Topic and paraphrase tests
verify representative coverage; they do not establish every source's factual
accuracy. Time-sensitive information should still be verified against current
primary sources.

## Running and deployment

The existing Giulia server now delegates `/api/mei/status` and `/api/mei/chat`
to Mei's isolated handler. `/api/status` and `/api/chat` continue serving Giulia.
On a backend-capable host the lab uses its own origin for both experts. Existing
custom backend settings remain editable under Internal lab tools. The old
standalone default is migrated to the integrated route on backend hosts.

The existing hosted Qwen environment variables are reused: `DASHSCOPE_API_KEY`,
`QWEN_BASE_URL`, and `QWEN_MODEL`. Mei continues to honor `MEI_LAB_TOKEN`,
`MEI_ALLOWED_ORIGIN`, and `MEI_DEV_DIAGNOSTICS` independently. When Mei-specific token/origin settings are absent, the integrated service inherits Giulia’s configured token/origin. No credentials
are shipped in browser assets or committed in this change.

For GitHub Pages, configure the actual hosted Giulia base URL in Internal lab
tools. For Mei on the integrated host, enter that base URL plus `/api/mei`.
Pages cannot run the backend itself. The interface is unlisted (`noindex`),
not an authentication boundary; existing hosting access controls still apply.

The standalone Mei project can also deploy directly from the `mei-backend/`
directory. Its `api/index.js` exports the same handler, and its `vercel.json`
includes knowledge/prompts and routes requests to the function. Use the
existing project and environment settings; do not create a replacement project.

Verify the actual served endpoint returns:

```json
{"agent":"mei","corpusVersion":"mei-drive-2026-09-29","knowledge":{"cultural":{"documents":74,"topics":37},"business":{"documents":80,"topics":40}}}
```

Additional chunk/version/model fields are expected. `ok:true` means Qwen is
configured, not that a live model request has succeeded.

## Interface and evaluation

The supplied portraits are Giulia (updo, hoop earrings) and Mei (side-parted bun,
notebook). Selection opens a separate conversation for each expert; Change
expert preserves both conversations within the tab. Chapman styling follows
the existing cultural-agents site: #7a0019, Georgia, #f6f6f6, white rounded cards.
Connection configuration, response diagnostics, and evaluation are contained
under Internal lab tools.

The suite remains 400 cases: 200 Giulia plus 200 Mei. Mei has two probes per
imported topic (154 cases) plus 46 mixed-domain, nuance, and boundary cases.
Mixed-domain routing is accepted for topic probes because the research folders
overlap. The test still records the exact expected and actual routes. Source
checks use Drive IDs instead of obsolete seed filenames.

Before spending model calls, the runner rejects mock providers, unavailable
backends, and Mei corpus versions/counts that differ from this snapshot.
Completed results are checkpointed in browser storage and can be downloaded
after interruption. A reload restores recorded results but does not silently
resume or rerun them. Download before clearing results. A full run can issue
more than 400 provider calls because mixed routes use both specialists and
synthesis, and transient failures can be retried.

Factual accuracy and persona/prosody require reading the replies. Automated
route/source/prose metrics are diagnostics, not a claim of verified correctness.

## Reimport and verification

`python scripts/import-mei-corpus.py /path/to/connector-batches` rebuilds the
snapshots and topic inventory from full-text Drive export records. It checks
unique IDs, nonempty text, and expected source counts. Update the expected
counts and corpus version deliberately for a future collection change.

`npm test` covers the existing Giulia behavior, corpus hashes and counts,
retrieval across all 77 topics, paraphrase retrieval, and the 400-case invariant.

## Validation performed for this change

48 automated tests passed locally, including inherited token protection. A real headless Chromium check exercised
the selection screen, both original portraits, separate conversation histories,
switching experts, a Mei request with a local provider fixture, the mock-provider
evaluation guard, and a 390px mobile viewport. No page JavaScript errors or
horizontal mobile overflow were detected. This is implementation verification,
not a completed live Qwen evaluation.
