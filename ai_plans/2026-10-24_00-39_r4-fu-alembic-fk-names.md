# R4 follow-up: alembic downgrade on a create_all database

## Status

Done.

## Related plans

- ai_plans/2026-10-23_17-20_maintenance-audit-round-4.md (section "Follow-ups found during execution")

## Touched files

- self-hosted-cloudapi/src/models/task.py
- self-hosted-cloudapi/alembic/versions/a9b0c1d2e3f4_task_parent_fk_name.py (new)
- self-hosted-cloudapi/alembic/versions/b2c3d4e5f6a7_datetime_timezone.py
- self-hosted-cloudapi/tests/test_migration_drift.py

## Problem

A database reaches head two ways: create_all from the models (FRESH, src/db_bootstrap.py) or the migration chain.
They disagreed in two places that only `alembic downgrade` sees:

1. Migration a7b8c9d0e1f2 creates the foreign key of `tasks.parent_task_id` as `fk_tasks_parent_task_id` and its
   downgrade drops it by that name. The model did not name the key, so create_all got Postgres' default
   `tasks_parent_task_id_fkey` (on SQLite: no name) and the downgrade failed with
   `constraint "fk_tasks_parent_task_id" of relation "tasks" does not exist`.
2. Once that passed, the downgrade of b2c3d4e5f6a7 failed on `provider_configs`: its model was retired in D6, so
   a create_all database never has that table.

`alembic check` was clean on both kinds of database: autogenerate does not compare foreign key names.

## Change

- The model names the key `fk_tasks_parent_task_id`, so a new create_all database matches a migrated one.
- New head a9b0c1d2e3f4 renames `tasks_parent_task_id_fkey` to `fk_tasks_parent_task_id` on Postgres when the old
  name exists (a create_all database built before this change, like the live one). Every other database is left
  alone. Its downgrade is a no-op: the new name is the one a7b8c9d0e1f2 expects. SQLite is skipped: it cannot
  rename a constraint, and a migrated SQLite database already has the name.
- b2c3d4e5f6a7 keeps its 26 columns in one table that both directions walk, and skips tables the database does
  not have (provider_configs on a create_all database).

The live database needs no manual step: the container's `db-migrate.sh` (MANAGED, `alembic upgrade head`) runs
a9b0c1d2e3f4 on start, which renames the key in place (a catalog change, no table rewrite).

## Tests

- New `test_a_fresh_database_downgrades_through_the_chain` (SQLite): db-migrate.sh on an empty database, then
  `alembic downgrade` to b2c3d4e5f6a7. Mutation: dropping `name=` from the model turns it red with
  `No such constraint: 'fk_tasks_parent_task_id'`.
- By hand on a throwaway PostgreSQL 16.15 container:
  - origin/main code: db-migrate.sh on an empty database, `alembic check` clean, `alembic downgrade base` fails
    on `fk_tasks_parent_task_id` (the reproduction). This database is the "old live-like" one.
  - This branch on the old database: `upgrade head` renames the key, `alembic check` clean, `downgrade base` and
    `upgrade head` both pass, `alembic check` clean; downgrade and upgrade of a9b0c1d2e3f4 again is a no-op.
  - This branch on an empty database: db-migrate.sh (FRESH), `alembic check` clean, key already named,
    `downgrade base`, `upgrade head`, `alembic check` clean.
  - `pg_dump -s` of the upgraded old database and of a new create_all database differ only in column order
    (a downgrade plus upgrade re-adds columns at the end); constraints and indexes are identical.
- Full `uv run pytest -q`.

## Notes

The Postgres-only paths (the rename and the provider_configs skip) have no automated test: CI has no Postgres
(owner decision 23, see the drift test's docstring).
