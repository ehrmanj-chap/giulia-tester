# Cultural knowledge corpus

Culture ingestion status: **complete for the current lab corpus (2026-08-18)**.

- 26 PDFs were supplied across two upload batches.
- 25 were unique; one duplicate copy of `999d4156-a1ed-40a3-af2c-ddaf1817ffe0.pdf` was removed during ingestion.
- The active corpus is stored as a Giulia batch JSON file and expanded into individual source documents by `lib/loaders.mjs`.
- `lib/retrieval.mjs` chunks and ranks the corpus locally; only the most relevant passages are sent to Cultural Giulia on each turn.
- No web search, external retrieval service, embeddings API, or database daemon is required.

The full raw PDF-to-text extraction artifact is retained separately during ingestion so source text and SHA-256 provenance can be checked when needed.

Retrieval defaults are deliberately small enough for `qwen3.5:9b`: up to six relevant chunks with a roughly 10.5k-character evidence budget before the specialist prompt and conversation history.
