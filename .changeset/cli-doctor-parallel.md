---
"tumble-code": patch
---

Improved: **CLI: faster `tumble doctor` when something is down.** Its checks run at the same time, so a hanging ripgrep and an unreachable cloud cost at most 5 seconds together instead of 8; the report keeps its order.
