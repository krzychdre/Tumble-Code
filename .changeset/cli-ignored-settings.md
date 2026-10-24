---
"tumble-code": patch
---

Fixed: **CLI: settings that were silently ignored.** The base-URL environment variables (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL` and the others) are read, a reasoning effort for the `openai` provider reaches the model, and `--base-url` with `mistral` stops with an error instead of being dropped.
