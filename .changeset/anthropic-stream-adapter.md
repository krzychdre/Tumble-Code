---
"tumble-code": patch
---

Claude on Google Vertex now reports the request cost the same way as the Anthropic provider, without counting the first output token twice; the Anthropic, MiniMax and Vertex providers share one stream reader.
