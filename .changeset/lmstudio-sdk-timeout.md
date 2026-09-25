---
"tumble-code": patch
---

LM Studio no longer freezes the start of a task or the model list when the server does not answer (or runs a version the extension cannot read): listing gives up after 10 seconds, a model load gives up after 60 seconds without progress, and an error message explains what to check. The extension also closes its LM Studio connections after each use.
