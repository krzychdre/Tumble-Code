---
"tumble-code": patch
---

D8 refactor: merged the 15-line `RepoPerTaskCheckpointService` subclass into `ShadowCheckpointService`, which is now a single concrete class. The subclass overrode nothing — it only carried the static `create()` factory that computes the per-task checkpoints directory, so the factory moved to the parent verbatim and the dead `taskRepoDir()` static was removed. Constructor, factory, and static-API signatures unchanged; no behavior change.
