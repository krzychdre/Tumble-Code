---
"@tumble-code/cli": patch
---

A `models` entry in cli-settings.json can set its own `provider`, `baseUrl`, `apiKey` and `apiKeyEnv`, so a model served by another server or another provider runs there wherever it is used: the top level, a mode entry, `--model` and `/model`. The entry overrides the top level and the mode entry, the flags still override it, and `/model` moves back to the mode's connection for a model without one of its own. Every such entry is checked at startup.
