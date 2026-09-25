# SVC-9 leftover: the query prefix was also applied to indexed code (2026-09-25)

Branch: `fix/svc-9-query-prefix-on-documents`

## Evidence (before the fix)

- `EMBEDDING_MODEL_PROFILES` (`src/shared/embeddingModels.ts`) has exactly one model with a
  `queryPrefix`: `nomic-embed-code`, under `ollama` and `openai-compatible`
  (`"Represent this query for searching relevant code: "`).
- `BaseHttpEmbedder.prepareTexts` put that prefix in front of EVERY input of `createEmbeddings`.
- Indexing (`DirectoryScanner.processBatch`, `FileWatcher.processFile`) and search
  (`CodeIndexSearchService.searchIndex`, reached from `codebase_search`) all call
  `createEmbeddings(texts)` the same way, so every indexed chunk was embedded as a query.
- Model card (huggingface.co/nomic-ai/nomic-embed-code, crawled 2026-09-25): queries are
  `'Represent this query for searching relevant code: ' + query`, code snippets are embedded as
  they are (`model.encode(code_snippets)` without `prompt_name`). So documents must get no prefix.
- `embedders/__tests__/query-prefix.spec.ts` (commit 1) runs the real embedder and search service
  and showed the prefixed document input.

Other models in the table have no prefix at all, before and after; their vectors do not change.
Not done here (would change their document vectors, left as a follow-up): nomic-embed-text
(`search_query: ` / `search_document: `) and Qwen3-Embedding (an `Instruct: ...\nQuery: ` only on
queries) are used without their recommended prefixes. That is consistent (both sides equal), just
not optimal.

## Fix

- `IEmbedder.createEmbeddings(texts, model?, inputType = "document")`; only `"query"` gets the
  query prefix. The search service passes `"query"`; indexing callers are unchanged (default).
- Existing indexes: changing document input changes every stored vector, so a nomic-embed-code
  collection would silently mix prefixed and unprefixed vectors. The metadata point
  (`__indexing_metadata__`) now records `document_prefix: ""` (`CURRENT_DOCUMENT_PREFIX`) in
  `markIndexingIncomplete`/`markIndexingComplete`. `QdrantVectorStore.initialize()` reads it for a
  non-empty, right-sized collection; an index without the field is legacy and its prefix is
  `legacyDocumentPrefix`, which the service factory sets to the model's query prefix. When the
  stored prefix differs from the current one the collection is deleted and recreated (reusing
  `_recreateCollectionWithNewDimension`), `initialize()` returns `true`, and the orchestrator clears
  the hash cache and runs a full scan, as for a dimension change.
- No needless reindex: a legacy collection of a model without a query prefix (every hosted model,
  the llama-swap ids `qwen3-embed`, `bge-m3`, `granite-...`) is kept; so is an empty collection and
  one whose marker cannot be read.
- Owner's llama-swap server on :11111: `qwen3-embed` and the others are unaffected. If
  `nomic-embed-code` from that server (openai-compatible) is the configured model, its index is
  rebuilt once.

## Tests

- `embedders/__tests__/query-prefix.spec.ts` (new), `vector-store/__tests__/qdrant-client.document-prefix.spec.ts`
  (new), one new wire test plus two updated wire expectations in `qdrant-client.wire.spec.ts`,
  two new factory tests plus the fifth constructor argument in the existing factory assertions,
  and a scanner pin that indexing calls `createEmbeddings(texts)` with one argument.
