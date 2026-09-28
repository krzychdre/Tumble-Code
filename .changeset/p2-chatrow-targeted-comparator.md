---
"tumble-code": patch
---

Performance: `ChatRow`'s memo no longer deep-compares the whole props tree (via `fast-deep-equal`) for every visible row on every streamed token. A targeted comparator compares `message` by reference (with a `ts`/`text`/`partial` fallback for rows the pipeline rebuilds per token, such as consolidated command rows), `meta` by its four fields (`previousTodos` by reference, stable through the tool-parse cache), and every other prop by identity. Measured on the characterization harness (20 rows × 100 token updates): 2000 deep-equal walks → 0; the comparator itself is ~2.2× faster per call. Non-streaming rows still never re-render during token updates, and the row height measurement logic is unchanged.
