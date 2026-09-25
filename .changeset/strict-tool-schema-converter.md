---
"tumble-code": patch
---

OpenAI, OpenAI Codex and the OpenAI-compatible providers now prepare tool schemas with one shared converter; the schemas sent to models are unchanged, and a malformed custom tool property no longer makes an OpenAI or Codex request fail.
