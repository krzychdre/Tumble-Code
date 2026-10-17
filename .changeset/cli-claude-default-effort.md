---
"@tumble-code/cli": patch
---

The CLI now runs a Claude model (anthropic, vertex and bedrock providers) at the reasoning effort the model lists as its default, for example "medium" on Opus 5.5 and "high" on Sonnet 5.5, when neither `--reasoning-effort` nor `models.<id>.reasoningEffort` sets a level. Before, the CLI default "medium" would have reached every Claude model now that the extension sends the effort level.
