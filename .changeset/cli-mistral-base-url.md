---
"@tumble-code/cli": patch
---

`--base-url` (or `baseUrl` in cli-settings.json) with the `mistral` provider now stops the run with "Provider 'mistral' does not support a base URL". Before, the URL was stored as the Codestral URL, which the extension uses only for `codestral-*` models, so for every other Mistral model it was silently ignored.
