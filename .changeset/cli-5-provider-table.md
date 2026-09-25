---
"tumble-code": patch
---

The CLI and the settings page now use one rule for which providers need an API key. The settings page no longer saves a DeepSeek, Moonshot, MiniMax, xAI or Z.ai profile without a key (every request of such a profile failed). The CLI passes an Ollama API key on (from `--api-key`, the settings file or `OLLAMA_API_KEY`) instead of dropping it, and with `--provider openai`, `ollama` or `lmstudio` but no model it now says that a model is needed instead of sending the OpenRouter model id to your server.
