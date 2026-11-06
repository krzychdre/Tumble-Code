---
"tumble-code": patch
---

Improved: **CLI: less CPU and memory on long tasks.** Each update of a long transcript no longer re-searches the whole conversation for every message, and `--output-format stream-json` no longer keeps every event it has already printed.
