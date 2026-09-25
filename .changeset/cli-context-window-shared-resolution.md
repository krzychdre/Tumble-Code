---
"tumble-code": patch
---

The CLI's context gauge now sizes the model exactly like the extension does, so it fills at the same point where condensing starts. It used to assume 200,000 tokens for a model id the provider does not list (the extension uses the provider's default model, for example 1,000,000 for Z.ai), for DeepSeek aliases, for an Ollama or LM Studio model that is not loaded (the extension uses 128,000), and it ignored the 1M context option of Anthropic and Vertex Claude models.
