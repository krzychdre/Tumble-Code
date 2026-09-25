---
"tumble-code": patch
---

OpenAI and OpenAI Codex no longer send a failed request a second time: a rate limit (429), an authentication error (401), a server error or a stream that broke off mid-answer used to make the same request reach OpenAI twice.
