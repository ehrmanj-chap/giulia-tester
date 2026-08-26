# Business knowledge corpus

Business ingestion status: **complete for the current lab corpus**.

- 26 PDFs were supplied.
- 25 were unique; the `(1)` copy of `194902f2-7a25-4b63-9b86-55f698ce0025.pdf` was byte-for-byte duplicate and was removed.
- The active corpus is `business-corpus.json.gz`, a gzip-compressed normalized Giulia batch with title, original PDF identity, SHA-256 provenance, and extracted text for every source.
- `lib/loaders.mjs` expands the batch into individual source documents, and `lib/retrieval.mjs` chunks and ranks the corpus locally.
- The complete 25-document Business corpus produces 267 retrieval passages with the current chunking configuration.
- No web search, external retrieval service, embeddings API, or database daemon is required.

Only the best relevant passages are sent to Business Giulia for a given conversation. Forensic traces retain the selected source IDs and retrieval scores.
