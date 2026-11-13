---
"tumble-code": patch
---

Fixed: **Code index batch size now follows settings changes.** The embedding batch size (`tumble-code.codeIndex.embeddingBatchSize`) was captured once when the indexing services were created, so changing it mid-session left the scanner and the file watcher batching at the old size until restart. Both now read the setting on every scan and batch pass.
