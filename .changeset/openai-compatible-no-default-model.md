---
"tumble-code": patch
---

Opening the OpenAI Compatible settings with no model id no longer writes `gpt-4o` into the profile. An OpenAI-compatible endpoint (vLLM, llama.cpp, a gateway) has no common model, so the model id now stays empty until the user names one, which the settings already require. The Bedrock custom ARN example now uses Claude Opus 5 instead of Claude Sonnet 4.5.
