---
"@tumble-code/cli": patch
---

`tumble --help` and the CLI README now say that `--reasoning-effort` falls back to a Claude model's own default level on the anthropic, vertex and bedrock providers before `medium`, which is what the CLI already did.
