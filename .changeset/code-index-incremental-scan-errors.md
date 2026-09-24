---
"tumble-code": patch
---

When VS Code starts with an existing code index and the catch-up scan cannot index the changed files (for example because the embedding server is down), the index status now shows the error instead of "Indexed". The existing index is kept, the failed files are retried by the next scan, and a connection error triggers the usual automatic retry.
