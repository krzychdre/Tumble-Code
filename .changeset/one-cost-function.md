---
"tumble-code": patch
---

Internal cleanup with no visible change: every place that prices a request (the task, the Anthropic stream, OpenAI-compatible usage, OpenAI Native service tiers and Gemini) now uses one cost function. A test pins the cost each of them computed before for a table of real models and usages.
