---
"@tumble-code/cli": patch
---

The CLI's OpenRouter default model is now the extension's default (`anthropic/claude-opus-5`) instead of its own `anthropic/claude-opus-4.6`, so `tumble` without `--model` runs the same model as the extension.
