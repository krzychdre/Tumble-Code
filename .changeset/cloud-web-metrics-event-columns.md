---
"tumble-code": patch
---

Improved: **Self-hosted cloud metrics and diagnostics pages load faster.** The cloud now keeps each model request's tokens, cost, model and mode ready to sum as soon as the request arrives, so these pages no longer decode the full record of every request in the period. The upgrade prepares the requests stored before it, once.
