---
"tumble-code": patch
---

Codebase indexing now writes the same search entries whether a file was indexed by the initial scan or by the file watcher after an edit. The watcher used a different id for each code block, so when a long line was split into several pieces only the last piece survived, and a file re-indexed by the watcher could end up with duplicate entries next to the ones written by the scan.
