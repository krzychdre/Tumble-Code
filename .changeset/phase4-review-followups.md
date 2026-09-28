---
"tumble-code": patch
---

Phase 4 review follow-ups: `TaskSlot.current` is now read-only — specs seed the slot via the new test-only `seedForTests` method instead of bypassing `set()`'s invariants, and `StreamToolCallHandler` takes a typed `Task` parameter instead of `any` (the duck-typed checkpoint guard stays for partial spec fixtures). No behavior change.
