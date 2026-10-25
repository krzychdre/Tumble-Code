---
"tumble-code": patch
---

Fixed: **CLI: no exit when the cloud profile cannot be read.** A signed-in CLI no longer stops in the middle of a task when the cloud answers the session refresh but fails to return the user profile; the failure is logged instead.
