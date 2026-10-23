---
"tumble-code": patch
---

CLI internals: the extension host options lose three fields nobody needed (`extensionAPI`, `forcedReasoningEffort`, the host-level `exitOnComplete`, which now belongs to the TUI alone), and /model always takes its settings from the run's resolver instead of a second, test-only way of building them. No user-visible change.
