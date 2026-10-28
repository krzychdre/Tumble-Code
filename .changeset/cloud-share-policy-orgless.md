---
"tumble-code": patch
---

Fixed: **Self-hosted cloud: switching task sharing off now works.** `ENABLE_TASK_SHARING=false` and `ALLOW_PUBLIC_TASK_SHARING=false` now hold for tasks without an organization too, and they also close the links shared before the switch: a public link then needs a sign-in, and with sharing off only the task's owner can open it.
