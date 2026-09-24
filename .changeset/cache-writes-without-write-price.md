---
"tumble-code": patch
---

Cache writes on a model that has no cache write price are now charged at the model's input price instead of being free. This affects models whose details you typed in yourself or that were fetched from a server without a write price, for example Claude through LiteLLM or an OpenAI Compatible endpoint, or Qwen explicit caching: their shown and recorded costs were too low (by up to about 75% on cache-heavy requests) and now rise to the correct level. A write price set explicitly to 0 still means free writes, and the built-in model list is not affected. Costs recorded before this change are not recalculated.
