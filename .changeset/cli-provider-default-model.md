---
"tumble-code": patch
---

The CLI picks the chosen provider's own default model when no model is given (for example GLM-5.3 with `--provider zai`); it used to send the OpenRouter id `anthropic/claude-opus-4.6` to every provider. The footer's context bar also knows the size of the models built into the extension (Z.ai, Anthropic, Gemini and the other providers with a fixed model list) instead of assuming 200,000 tokens, so GLM-5.3 is measured against 1,000,000.
