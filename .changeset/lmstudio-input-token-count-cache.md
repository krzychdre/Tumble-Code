---
"tumble-code": patch
---

LM Studio no longer re-tokenizes the whole conversation on every request to estimate the prompt size: counts of unchanged messages are remembered, so only the newest messages are counted and long local-model tasks spend far less CPU on each turn. The reported token numbers are exactly the same as before.
