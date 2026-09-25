---
"tumble-code": patch
---

Internal cleanup: background tasks and memory writers now run through their own module, with no change in behavior (stopping a task still never starts or waits for a memory writer).
