---
"tumble-code": patch
---

S6 refactor: the task engine (`src/core/task`) now types provider state as `ProviderState` instead of `any`, has no `as any` casts left, and logs the previously silent error swallows at debug level. No behavior change.
