---
"tumble-code": patch
---

Internal type-safety cleanup: the last untyped casts in the provider event forwarding, the LiteLLM, OpenRouter, xAI and OpenAI message conversion, and the retry error handling now use real types. No behaviour change.
