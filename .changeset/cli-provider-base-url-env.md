---
"@tumble-code/cli": patch
---

The CLI now reads the documented base-URL environment variables (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `OLLAMA_BASE_URL` and the others in the README). Before, they were ignored. A `--base-url` flag or a `baseUrl` in the settings file still wins over the variable.
