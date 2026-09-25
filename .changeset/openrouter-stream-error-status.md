---
"tumble-code": patch
---

OpenRouter: an error reported in the middle of a response (for example a rate limit or an upstream provider failure) now keeps its HTTP status, so automatic retries and the background-model fallback recognise it.
