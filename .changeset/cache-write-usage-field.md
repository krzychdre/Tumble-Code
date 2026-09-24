---
"tumble-code": patch
---

Cache writes are now counted for every OpenAI-compatible server that reports them (OpenRouter, Moonshot Kimi, Alibaba Qwen explicit caching, LiteLLM), in background calls such as context condensing as well as in chat, so token and cost figures no longer miss those tokens.
