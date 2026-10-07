---
"tumble-code": patch
---

The system prompt no longer tells every mode that it can run commands and read or write files, so a mode without those tools (such as Orchestrator) stops calling tools it does not have and getting stuck on empty responses.
