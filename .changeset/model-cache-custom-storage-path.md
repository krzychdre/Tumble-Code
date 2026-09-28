---
"tumble-code": patch
---

With a custom storage path set, the model list cached from OpenRouter, LiteLLM, Ollama, LM Studio or DeepSeek is now found on the first request after VS Code starts. Until now that first lookup searched the default storage folder instead of the custom one, so the request ran with default model information (context window, prices) even though a valid cached list existed.
