---
"tumble-code": minor
---

Improved: **CLI: breaking, the `-k, --api-key` option is gone.** A key on the command line was visible to every user of the machine in the process list; set the provider's environment variable (for example `OPENROUTER_API_KEY`) or `apiKey` / `apiKeyEnv` in `~/.roo/cli-settings.json` instead.
