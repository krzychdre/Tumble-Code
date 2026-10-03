---
"tumble-code": patch
---

The CLI takes model prices from `models` in `~/.roo/cli-settings.json`: `inputPrice`, `outputPrice`, `cacheReadsPrice` and `cacheWritesPrice` in USD per million tokens, the same fields the VS Code settings set for an OpenAI-compatible model. With the `openai` provider every request cost $0 before, so the task cost and the cost sent to Tumble Code Cloud stayed at zero. A malformed price fails at startup; prices for a model on another provider are ignored with a warning.
