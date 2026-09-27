# R7 — Cloud retention sweep per-user isolation

Roadmap item R7 from `ai_plans/2026-09-27_simplification-roadmap.md` (Priority 1, resilience):
"`sweep_all_enabled` uses one session for all users; on PostgreSQL one failing user aborts the
transaction for everyone." Branch: `fix/r7-retention-sweep-per-user-isolation`.

## Root cause (evidence from the code)

The scheduled sweep path:

- [`run_retention_loop()`](../self-hosted-cloudapi/src/services/retention_scheduler.py:36) opens
  **one session** per cycle:
    ```python
    async with async_session_factory() as db:
        count = await sweep_all_enabled(db)
        await db.commit()          # ← one commit for the whole cycle, line 38
    ```
- [`sweep_all_enabled()`](../self-hosted-cloudapi/src/services/retention_service.py:264) selects
  every enabled `RetentionPolicy` and loops **all users on that single session**:
    ```python
    result = await db.execute(
        select(RetentionPolicy).where(RetentionPolicy.enabled == True)  # noqa: E712
    )
    policies = list(result.scalars().all())
    for policy in policies:
        try:
            await apply_sweep(db, policy.user_id, policy, now=now)
        except Exception:  # one user's failure must not abort the rest
            logger.exception("[retention] sweep failed for %s", policy.user_id)
    ```
    The existing `try/except` only swallows the Python exception. It does nothing about the
    transaction: there is no savepoint, no rollback, no commit inside the loop.

So one session → many users → one commit at the end of the cycle. Two failure modes:

1. **PostgreSQL**: any DB error (lock timeout, constraint violation, serialization failure) puts
   the transaction in the _aborted_ state; every subsequent statement in the session raises
   `InFailedSqlTransaction` until a ROLLBACK. The `try/except` then "handles" an error per user,
   but nothing was deletable since the first failure — the sweep silently does nothing for
   everyone, and the final `commit()` persists nothing.
2. **Any engine, including SQLite (tests)**: a user that fails _mid-delete_ has already executed
   part of its DELETEs inside the shared transaction. Those partial deletions are **not** rolled
   back — the final `commit()` persists them. The failing user gets an arbitrary half-applied
   retention round, which is exactly the kind of silent data loss the module's own docstring
   promises cannot happen.

The second mode is what the regression test pins: it is observable on the SQLite test harness,
so no PostgreSQL is required in CI. The first mode is the production (PostgreSQL) consequence
that motivates the fix; the same savepoint covers both.

## Red test on main

`test_a_failing_user_does_not_poison_the_others`
([tests/test_web_settings.py](../self-hosted-cloudapi/tests/test_web_settings.py)) seeds two
enabled users, monkeypatches `delete_tasks` so that the "bad" user's delete completes for one
task and then raises, and runs `sweep_all_enabled` + `commit()` exactly as the scheduler does.
On main it fails:

```
AssertionError: the failing user keeps everything
assert {'bad-1'} == {'bad-1', 'bad-2'}
```

i.e. `bad-2` leaked into the commit — half of the failing user's round was applied. (The healthy
user assertion also demonstrates the PostgreSQL shape in spirit: without isolation, whatever the
loop manages to do depends on the first failure.)

## Fix — SAVEPOINT per user

Wrap each user's `apply_sweep` in `async with db.begin_nested():` inside
[`sweep_all_enabled()`](../self-hosted-cloudapi/src/services/retention_service.py:283).
`begin_nested()` emits `SAVEPOINT` (PostgreSQL) / `SAVEPOINT` (SQLite supports it too) and the
context manager rolls back to the savepoint on any exception — the failing user's partial work is
discarded whole, and the session stays usable for the remaining users.

### Savepoint vs commit-per-user — why savepoint

- **Durability semantics**: retention rounds should land as one unit per _cycle_. With
  commit-per-user, a crash mid-cycle leaves some users swept and others not, and the half-round
  state is invisible (per-user `last_run_at` would say "ran" only for the committed ones —
  consistent, but the cycle-level all-or-nothing that the current scheduler design implies is
  lost). A savepoint keeps the single `commit()` in `run_retention_loop` as the cycle boundary.
- **Cost**: one commit/fsync per cycle instead of one per user. The sweep is a handful of DELETEs
  every 6 hours; per-user commits would add fsyncs proportional to user count for zero benefit.
- **Metrics/log coherence**: `sweep_all_enabled` returns the count of _processed_ policies and the
  scheduler logs one line per cycle; with savepoints, "processed" still means "attempted inside
  this cycle's transaction", and the cycle log stays one atomic statement about one atomic unit.
- **Failure isolation is identical**: rollback-to-savepoint cancels exactly the failing user's
  work; `begin_nested` works on both asyncpg (PostgreSQL) and aiosqlite (verified by the test
  suite passing on SQLite — SQLite implements `SAVEPOINT`/`ROLLBACK TO`).

## Test

- `test_a_failing_user_does_not_poison_the_others` — after the fix: the healthy user is swept
  (`ok-1` gone), the failing user keeps **everything** (`bad-1` and `bad-2` both remain; the
  partial delete no longer leaks), and `processed == 2` (both policies attempted).
- Lowest layer: a service-level pytest with the standard SQLite fixtures
  (`tests/conftest.py`), no FastAPI client, no PostgreSQL needed in CI.
- A PostgreSQL-only case was considered and skipped: the _observable_ defect (partial work
  leaking into the shared commit) is fully provable on SQLite, and PG-only assertions about
  `InFailedSqlTransaction` would add CI machinery for the same guarantee.

## Results

- `uv run pytest tests/test_web_settings.py -q` → 18 passed (11 before, new test red→green).
- `uv run pytest -q` (full cloud suite) → **805 passed, 1 xfailed**.
- `uvx ruff@0.15.12 check .` → clean.

## Residuals

- `run_retention_loop`'s outer `try/except` still swallows a failure of the final `commit()` or
  of the initial policy SELECT; that is intentional (module docstring: a failure never kills the
  loop) and unchanged.
- If a future scheduler moves to a worker with per-user jobs, savepoints can be replaced by
  per-job sessions; the isolation requirement is now pinned by the test either way.
- `web_settings.py` "Run now" path (`apply_sweep` + `db.commit()`) is single-user by design and
  needs no isolation.
