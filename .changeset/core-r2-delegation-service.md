---
"tumble-code": patch
---

Internal cleanup with no visible change: handing work to a subtask and returning its result to the parent task (including cancelling and resuming a subtask) is now handled in one place, so the separate copies of that logic can no longer drift apart.
