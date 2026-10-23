---
"tumble-code": patch
---

Cloud api: `alembic downgrade` now works on a database built by create_all. The model names the parent-task foreign key the way its migration does, a new migration renames the old default name, and the datetime migration skips the retired provider_configs table a fresh database never had.
