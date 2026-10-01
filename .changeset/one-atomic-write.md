---
"tumble-code": patch
---

Internal cleanup with no visible change: settings files, saved tool output (artifacts) and agent handoff files are now replaced through one atomic write that never leaves a half-written file behind.
