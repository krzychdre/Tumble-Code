---
"tumble-code": patch
---

Fix two write races in the self-hosted cloud API: sharing a task now upserts against a new unique index (two concurrent share requests used to create duplicate share rows, breaking the shared page), and user-settings PATCH now does the optimistic version check atomically in SQL (UPDATE ... WHERE version = :expected RETURNING), so two parallel updates with the same expected version can no longer both succeed and silently lose one of them. Adds an alembic migration that deduplicates existing task_shares rows and creates the unique index.
