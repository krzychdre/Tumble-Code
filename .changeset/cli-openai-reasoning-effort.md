---
"@tumble-code/cli": patch
---

With the `openai` (OpenAI-compatible) provider, a reasoning effort you configure with `--reasoning-effort`, `reasoningEffort` in cli-settings.json or a `modes` entry now reaches the model; before, it was silently dropped. When no effort is configured nothing is sent to that provider, as before, because many OpenAI-compatible servers reject the field.
