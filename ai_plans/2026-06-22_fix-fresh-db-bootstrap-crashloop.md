# Fix: api container crash-loop on a fresh database (Docker bring-up)

**Date:** 2026-06-22
**Scope:** `self-hosted-cloudapi/`

## Symptom

After `docker compose up -d`, every service is healthy **except `api`**, which is
stuck `Restarting (1)`. The backend is unreachable on `:8085`. Logs show:

```
sqlalchemy.exc.ProgrammingError: (...asyncpg...UndefinedTableError):
relation "authentik_state_store" does not exist
[SQL: ALTER TABLE authentik_state_store ALTER COLUMN created_at TYPE TIMESTAMP WITH TIME ZONE]
```

## Root cause (proven, not assumed)

The Dockerfile `CMD` runs `alembic upgrade head` **before** the app starts.
On a fresh `./.vol/postgres` volume that migration chain cannot build a schema:

- `a1b2c3d4e5f6_baseline.py` — `upgrade()` is `pass`. Creates **no tables**. Its
  own docstring says it represents a pre-existing `create_all`'d DB you are meant
  to `alembic stamp`.
- `b2c3d4e5f6a7_datetime_timezone.py` — immediately `ALTER`s `authentik_state_store`
  (and `users`, `sessions`, …), tables that were never created → **crash**.
- `c3d4…`, `d4e5…`, `e5f6…` — all evolution-only (`add_column`, `create_index`).

The only thing that _creates_ tables is `Base.metadata.create_all` — in the app
lifespan ([src/main.py:30](../self-hosted-cloudapi/src/main.py#L30)), with the
ORM models as the single source of truth. But the app never starts, because
alembic crashes first in the `&&` chain.

So: **alembic-first ordering + a no-op baseline = a fresh DB can never bootstrap.**

Note a tempting non-fix: making the baseline `create_all`. That breaks too —
`create_all` produces the **head** schema, so the later `add_column` migrations
(`task_message_ts`, `task.workspace_path`) would then fail with _column already
exists_. The migrations are evolution steps for a _pre-head_ schema; they must not
be replayed against a freshly created head schema.

## Fix

Replace the blind `alembic upgrade head` with a small startup reconciler that
matches the project's actual design (models = source of truth; migrations = how
_existing_ deployments evolve):

- **Fresh DB** (no `users` table): `Base.metadata.create_all` builds the current
  schema, then `alembic stamp head` records every migration as already applied
  (without running the evolution steps).
- **Legacy DB** (tables exist, no `alembic_version`): follow the baseline's
  documented path — `alembic stamp a1b2c3d4e5f6` then `alembic upgrade head` —
  so an old pre-tz schema gets evolved.
- **Managed DB** (`alembic_version` present): `alembic upgrade head` as normal.

### Files

- `src/db_bootstrap.py` (new) — async probe of the live DB; prints
  `FRESH` / `LEGACY` / `MANAGED` and runs `create_all` in the `FRESH` case. Uses
  the same engine/models as the app, so there is one schema source of truth.
- `docker-entrypoint.sh` (new) — runs the probe, dispatches the correct alembic
  command per state, then `exec`s uvicorn.
- `Dockerfile` — `CMD` now runs `docker-entrypoint.sh` (copied + `chmod +x`).

The app lifespan keeps its own idempotent `create_all` (harmless no-op once the
entrypoint has built the schema), so running the app outside Docker is unchanged.

## Verification

1. `docker compose down` + remove `./.vol/postgres` → truly fresh DB.
2. `docker compose up -d` → `api` reaches healthy/running, not restarting.
3. `docker compose logs api` shows `DB state: FRESH`, the stamp, and
   `Application startup complete` — no `UndefinedTableError`.
4. `curl -fsS localhost:${PORT:-8085}/health` (or `/`) returns 200.
5. `docker compose exec api uv run alembic current` shows head
   (`e5f6a7b8c9d0`), proving alembic and the schema agree.
6. Restart `api` → `DB state: MANAGED`, `upgrade head` no-op, still healthy
   (idempotency).
7. `uv run pytest` stays green (entrypoint is Docker-only; no app code path
   changed).

## Risks / follow-ups

- The `LEGACY` branch assumes a pre-tz schema (the baseline's documented
  assumption). A legacy DB that was `create_all`'d at _head_ and never stamped
  would fail `upgrade` on the `add_column` steps — but that is the pre-existing
  documented contract, not introduced here, and not the Docker path.
