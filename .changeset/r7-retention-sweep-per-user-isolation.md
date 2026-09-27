---
"tumble-code": patch
---

Self-hosted cloud: the scheduled retention sweep now runs each user inside a savepoint, so a database error while deleting one user's data (lock timeout, constraint violation) no longer aborts the sweep for every other user, and a user whose sweep fails halfway keeps all of its data instead of a partially applied round.
