---
"tumble-code": patch
---

LiteLLM: DeepSeek cache misses are no longer counted as cache writes. LiteLLM passes DeepSeek's miss count through, and it was shown as cache writes and priced at the model's cache write price (free for DeepSeek, so the uncached part of every prompt cost nothing). Misses are now ordinary input at the input price, and cache writes that LiteLLM reports under its standard `prompt_tokens_details.cache_write_tokens` name are counted.
