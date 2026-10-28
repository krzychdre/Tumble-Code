---
"tumble-code": patch
---

Fixed: **Self-hosted cloud: parallel dataset uploads can no longer exhaust the server's memory.** The server now parses only a few recorded LLM exchanges at a time and asks the extension to retry the rest a few seconds later.
