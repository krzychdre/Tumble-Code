---
"tumble-code": patch
---

Token usage and cost are no longer multiplied when an OpenAI-compatible server (o1/o3 family models, Qwen Code, or a Mistral/Codestral endpoint) repeats the running usage totals in every streamed chunk: only the final totals are counted.
