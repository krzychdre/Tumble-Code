# WP-R7: Cloud retention sweep isolates each user (savepoint per user)

Status: ready
Effort: S      Risk: low      Depends on: none
Branch name: fix/r7-retention-sweep-per-user      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

The background retention sweep runs every user's retention policy inside ONE database session and ONE
transaction. Make each user's sweep run inside its own SAVEPOINT (`AsyncSession.begin_nested()`), so a failure
for one user rolls back only that user's partial work, and every other user's deletions are still committed.

## 2. Why it matters (user-visible effect, 2-4 sentences)

On PostgreSQL (production) any failed statement aborts the whole transaction, so one user with a bad row makes the
final commit fail and NO user's retention policy is applied, every 6 hours, forever. On any database, a failed
flush makes SQLAlchemy roll back the whole session, with the same effect. Conversely, a Python error after a
partial delete currently leaves that user's half-done deletions in the transaction, and they get committed with
everybody else's.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `AGENTS.md` (test placement rules) and `docs/architecture.md`, section "Do not touch without a dedicated item",
  bullet "Cloud API (`self-hosted-cloudapi/`)".
- `self-hosted-cloudapi/src/services/retention_service.py`: `sweep_all_enabled`, `apply_sweep`, `plan_sweep`.
- `self-hosted-cloudapi/src/services/retention_scheduler.py`: `run_retention_loop` (it commits once after
  `sweep_all_enabled`; this WP does not change that file).
- `self-hosted-cloudapi/src/services/share_service.py`: `delete_tasks` (what `apply_sweep` calls to delete).
- `self-hosted-cloudapi/tests/conftest.py`: fixtures `session_factory`, `db_session` (SQLite in memory,
  StaticPool, foreign keys ON).
- `self-hosted-cloudapi/tests/web_helpers.py`: `_seed_user`.

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`self-hosted-cloudapi/src/services/retention_service.py`, `sweep_all_enabled` (near line 258, end of file):

```python
async def sweep_all_enabled(db: AsyncSession, now: Optional[datetime] = None) -> int:
    """Run the sweep for every user who has switched retention on.

    Returns the number of policies processed. Each user is handled
    independently: one user's data failing to delete must not stop the rest.
    """
    result = await db.execute(
        select(RetentionPolicy).where(RetentionPolicy.enabled == True)  # noqa: E712
    )
    policies = list(result.scalars().all())
    for policy in policies:
        try:
            await apply_sweep(db, policy.user_id, policy, now=now)
        except Exception:  # one user's failure must not abort the rest
            logger.exception("[retention] sweep failed for %s", policy.user_id)
    return len(policies)
```

`self-hosted-cloudapi/src/services/retention_scheduler.py`, `run_retention_loop` (the caller; unchanged here):

```python
    while True:
        try:
            async with async_session_factory() as db:
                count = await sweep_all_enabled(db)
                await db.commit()
```

## 5. Root cause / analysis

VERIFIED (read and ran):
- The `try/except` in `sweep_all_enabled` catches the Python exception but does nothing about the transaction.
- Ran the new test (section 7) against the unchanged code: both parametrized cases FAIL.
  - `python-error`: the failing user's tasks were deleted in the transaction before the error, and the final
    commit persisted that partial work (`assert "task-old-user_b_bad" in remaining` fails).
  - `flush-error`: a failed flush (a foreign-key violation) rolled back the whole session; the next user's
    statements and the final `db.commit()` raise `sqlalchemy.exc.PendingRollbackError`, so nothing is saved.
    This is the SQLite stand-in for PostgreSQL's "current transaction is aborted".
- With the fix below, the new tests and the whole suite pass (only the 2 pre-existing, unrelated
  `test_metrics_characterization.py` failures remain, see section 8).
- SQLite (aiosqlite, sqlite 3.45) handles `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` correctly here.
- A rolled-back savepoint EXPIRES the ORM objects changed inside it. Reading an expired attribute
  (`policy.user_id` in the `except` branch) would trigger a lazy load, which raises `MissingGreenlet` under
  AsyncSession. The fix therefore reads `user_id` into a local variable BEFORE entering the savepoint.

HYPOTHESIS (not testable in this repo): on PostgreSQL the savepoint confines a failed statement to that user.
This is standard PostgreSQL behavior (`ROLLBACK TO SAVEPOINT` clears the "current transaction is aborted"
state). The test suite cannot show it: `tests/conftest.py` hard-codes SQLite, and SQLite as the test database is a
do-not-touch contract. Do NOT add a PostgreSQL test; state this limitation in the PR body.

Alternative not taken: commit per user. It would need the policy list re-read per user (a rollback expires every
object in the session) and changes the scheduler contract; the savepoint keeps the function signature and the
scheduler unchanged.

## 6. Step-by-step changes

Step 1. File `self-hosted-cloudapi/src/services/retention_service.py`.

Find (unique):

```python
    """Run the sweep for every user who has switched retention on.

    Returns the number of policies processed. Each user is handled
    independently: one user's data failing to delete must not stop the rest.
    """
    result = await db.execute(
        select(RetentionPolicy).where(RetentionPolicy.enabled == True)  # noqa: E712
    )
    policies = list(result.scalars().all())
    for policy in policies:
        try:
            await apply_sweep(db, policy.user_id, policy, now=now)
        except Exception:  # one user's failure must not abort the rest
            logger.exception("[retention] sweep failed for %s", policy.user_id)
    return len(policies)
```

Replace with:

```python
    """Run the sweep for every user who has switched retention on.

    Returns the number of policies processed. Each user is handled
    independently: one user's data failing to delete must not stop the rest,
    and must not undo them either. Every user runs inside its own SAVEPOINT
    (``begin_nested``): a failure rolls back that user's partial work only,
    and the session stays usable for the next user and for the caller's
    commit. Without it, PostgreSQL aborts the whole transaction on the first
    failed statement, and SQLAlchemy rolls back the whole session on a failed
    flush, so the final commit raised and nobody's sweep was saved.
    """
    result = await db.execute(
        select(RetentionPolicy)
        .where(RetentionPolicy.enabled == True)  # noqa: E712
        .order_by(RetentionPolicy.user_id)
    )
    policies = list(result.scalars().all())
    for policy in policies:
        # Read before the savepoint: a rolled-back savepoint expires the
        # objects changed inside it, and reading an expired attribute would
        # lazy-load, which raises under the async session.
        user_id = policy.user_id
        try:
            async with db.begin_nested():
                await apply_sweep(db, user_id, policy, now=now)
        except Exception:  # one user's failure must not abort the rest
            logger.exception("[retention] sweep failed for %s", user_id)
    return len(policies)
```

(The `order_by` makes the order deterministic; the test relies on the failing user sitting between two healthy
ones.)

Step 2. File `docs/08-cloud.md`, section "### Background work". Find:

```
`retention_scheduler.py` runs `sweep_all_enabled` every few hours (default 6) and deletes tasks older than each
user's retention policy. The loop starts and stops with the app's lifespan.
```

Replace with:

```
`retention_scheduler.py` runs `sweep_all_enabled` every few hours (default 6) and deletes tasks older than each
user's retention policy. Each user runs in its own savepoint, so one user's failure rolls back only that user.
The loop starts and stops with the app's lifespan.
```

(If WP-R10 was merged first, this paragraph was already rewritten; then add only the sentence "Each user runs in
its own savepoint, so one user's failure rolls back only that user." after the first sentence.)

No other file changes. Do not touch `retention_scheduler.py` in this WP.

## 7. Tests to add or change

New file `self-hosted-cloudapi/tests/test_retention_sweep.py` (service-level, SQLite; lowest layer that shows the
bug). Full content:

```python
"""The scheduled retention sweep isolates users from each other (R7).

``sweep_all_enabled`` runs every enabled policy in ONE session. Before R7 a
failure part-way through one user's sweep either left that user's half-done
deletes in the transaction (committed later with everybody else's), or, when
the failure was a database error raised by a flush, rolled back the whole
session so the final commit raised and nobody's sweep was saved. On
PostgreSQL any statement error aborts the transaction, so one bad user always
cost every user their sweep. Each user now runs inside its own SAVEPOINT.
"""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.models.retention import RetentionPolicy
from src.models.task import Task
from src.services import retention_service
from src.services.retention_service import sweep_all_enabled
from tests.web_helpers import _seed_user

NOW = datetime(2026, 9, 20, 12, 0, tzinfo=timezone.utc)
OLD = NOW - timedelta(days=30)

# Sorted by id on purpose: the sweep visits policies in user_id order, so the
# failing user sits between two healthy ones and both orders are covered.
GOOD_FIRST = "user_a_good"
BAD = "user_b_bad"
GOOD_LAST = "user_c_good"


async def _seed(session_factory, db_session):
    for user_id in (GOOD_FIRST, BAD, GOOD_LAST):
        await _seed_user(db_session, user_id=user_id, email=f"{user_id}@example.com")
    async with session_factory() as s:
        for user_id in (GOOD_FIRST, BAD, GOOD_LAST):
            s.add(Task(id=f"task-old-{user_id}", user_id=user_id, updated_at=OLD, created_at=OLD))
            s.add(Task(id=f"task-new-{user_id}", user_id=user_id, updated_at=NOW, created_at=NOW))
            s.add(RetentionPolicy(user_id=user_id, enabled=True, max_age_days=7))
        await s.commit()


async def _task_ids(session_factory) -> set[str]:
    async with session_factory() as s:
        return set((await s.execute(select(Task.id))).scalars().all())


async def _last_runs(session_factory) -> dict:
    async with session_factory() as s:
        rows = await s.execute(select(RetentionPolicy.user_id, RetentionPolicy.last_run_at))
        return {user_id: last_run for user_id, last_run in rows.all()}


def _fail_after_deleting(monkeypatch, failure):
    """Make BAD's sweep fail AFTER its tasks were deleted in the transaction.

    The real delete runs first, so the test also proves the failing user's own
    partial work is rolled back, not just that the others survive.
    """
    real_delete_tasks = retention_service.delete_tasks

    async def flaky_delete_tasks(db, task_ids, user_id, **kwargs):
        deleted = await real_delete_tasks(db, task_ids, user_id, **kwargs)
        if user_id == BAD:
            await failure(db)
        return deleted

    monkeypatch.setattr(retention_service, "delete_tasks", flaky_delete_tasks)


async def _python_error(db):
    raise RuntimeError("injected failure for one user")


async def _flush_error(db):
    # A foreign-key violation raised by a flush: SQLAlchemy then rolls back
    # the transaction the flush ran in. Without a savepoint that is the whole
    # sweep (the next statement or the commit raises PendingRollbackError),
    # which is the SQLite stand-in for PostgreSQL's aborted transaction.
    db.add(RetentionPolicy(user_id="user_that_does_not_exist", enabled=False))
    await db.flush()


@pytest.mark.parametrize("failure", [_python_error, _flush_error], ids=["python-error", "flush-error"])
async def test_one_failing_user_does_not_undo_the_others(
    failure, monkeypatch, session_factory, db_session
):
    await _seed(session_factory, db_session)
    _fail_after_deleting(monkeypatch, failure)

    async with session_factory() as db:
        processed = await sweep_all_enabled(db, now=NOW)
        # The scheduler commits once after the sweep (retention_scheduler.py).
        await db.commit()

    assert processed == 3
    remaining = await _task_ids(session_factory)
    # The healthy users' old tasks are gone, before and after the failure.
    assert f"task-old-{GOOD_FIRST}" not in remaining
    assert f"task-old-{GOOD_LAST}" not in remaining
    # The failing user's delete was rolled back with its savepoint.
    assert f"task-old-{BAD}" in remaining
    # Nobody's recent task was touched.
    assert {f"task-new-{u}" for u in (GOOD_FIRST, BAD, GOOD_LAST)} <= remaining

    last_runs = await _last_runs(session_factory)
    assert last_runs[GOOD_FIRST] is not None
    assert last_runs[GOOD_LAST] is not None
    # The failed sweep is not recorded as a run.
    assert last_runs[BAD] is None


async def test_a_clean_sweep_still_processes_every_enabled_policy(session_factory, db_session):
    await _seed(session_factory, db_session)

    async with session_factory() as db:
        processed = await sweep_all_enabled(db, now=NOW)
        await db.commit()

    assert processed == 3
    remaining = await _task_ids(session_factory)
    assert remaining == {f"task-new-{u}" for u in (GOOD_FIRST, BAD, GOOD_LAST)}
```

Why it fails without the fix: `python-error` keeps the failing user's partial delete (the old task is gone after
commit); `flush-error` raises `PendingRollbackError` at `await db.commit()`. The third test pins that a clean
sweep still processes every policy (passes before and after).

How the failure is injected: `monkeypatch.setattr(retention_service, "delete_tasks", ...)` replaces the name
`apply_sweep` looks up in `retention_service`'s module globals (it was imported with
`from src.services.share_service import delete_tasks`), so patch `retention_service.delete_tasks`, NOT
`share_service.delete_tasks`.

## 8. Commands to run (exact, from which directory) and the expected result

All from `self-hosted-cloudapi/`:

1. `uv sync --frozen --extra dev` (once; CI does the same).
2. Before the code change (test file added only):
   `uv run pytest -q tests/test_retention_sweep.py` -> 2 failed, 1 passed.
3. After step 1: `uv run pytest -q tests/test_retention_sweep.py` -> 3 passed.
4. Wider: `uv run pytest -q tests/test_web_settings.py tests/test_retention_sweep.py` -> all pass.
5. Whole suite (what CI runs): `uv run pytest` -> all pass EXCEPT two pre-existing failures that also fail on an
   untouched checkout today: `tests/test_metrics_characterization.py::test_metrics_result_is_pinned_for_every_period`
   and `::test_unknown_period_falls_back_to_the_default` (baseline on 2026-09-27: 2 failed, 789 passed, 13 skipped,
   1 xfailed). Do not try to fix them in this WP; mention them in the PR.
6. Lint (blocking in CI): `make lint` (runs `uvx ruff@0.15.12 check .`) -> "All checks passed!".
7. Type check / eslint / prettier: not applicable (Python service; there is no mypy step). Formatting is not
   enforced in CI (`ruff format --check .` reports 107 files on main); do NOT reformat existing files.

## 9. Do not touch / pitfalls

- Do-not-touch (docs/architecture.md, Cloud API): the monotonic `ON CONFLICT` upsert,
  `response_model_exclude_none=True`, share returning 404 for unknown tasks, the `/bridge` socket path, the
  database bootstrap classification, SQLite as the test database, the denormalized summary columns. None is
  touched here. Do not change conftest to use PostgreSQL.
- Keep `except Exception` (not `BaseException`): `asyncio.CancelledError` must still propagate so the lifespan can
  cancel the loop.
- Do not reference `policy.<attr>` inside the `except` branch; use the local `user_id` (expired-object lazy load
  raises `MissingGreenlet`).
- Do not add `await db.commit()` inside `sweep_all_enabled`; the caller (scheduler, and the web "Run now" path via
  `apply_sweep`) owns the commit.
- The flaky tests F1/F2 named in the template are TypeScript tests elsewhere in the monorepo; not relevant here.
- `tests/test_web_settings.py` exercises `apply_sweep` via "Run now"; it must stay green.

## 10. Acceptance checklist (checkboxes)

- [ ] `sweep_all_enabled` wraps each `apply_sweep` in `async with db.begin_nested():` and orders by `user_id`.
- [ ] `user_id` is read before the savepoint and used in the log line.
- [ ] `tests/test_retention_sweep.py` added; 2 of its cases fail before the change, all 3 pass after.
- [ ] `uv run pytest` shows no new failures (only the 2 pre-existing metrics characterization failures).
- [ ] `make lint` passes.
- [ ] `docs/08-cloud.md` background-work paragraph mentions the per-user savepoint.
- [ ] `ai_plans/` note added.

## 11. Commit, changeset and PR text

- Commit title: `fix(cloudapi): isolate each user's retention sweep in a savepoint (R7)`
- Commit body:
  ```
  sweep_all_enabled ran every enabled policy in one transaction. On
  PostgreSQL the first failing statement aborted it, and on any database a
  failed flush rolled back the whole session, so the scheduler's commit
  raised and nobody's sweep was saved. A Python error after a partial delete
  left that user's half-done deletes to be committed with the rest.

  Each user now runs inside begin_nested(); a failure rolls back only that
  user. Policies are visited in user_id order.

  Tests: tests/test_retention_sweep.py (a Python error and a flush error
  for one of three users).
  ```
  End with the attribution lines the session requires.
- Changeset: none (the cloud API is not part of the `tumble-code` extension package).
- `ai_plans/<today as YYYY-MM-DD>_cloud-retention-sweep-per-user.md`:
  ```
  # Cloud: retention sweep isolates each user (R7)

  **Status:** done on `fix/r7-retention-sweep-per-user`.
  **Touched:** `self-hosted-cloudapi/src/services/retention_service.py`, `tests/test_retention_sweep.py`,
  `docs/08-cloud.md`

  ## Problem
  `sweep_all_enabled` used one transaction for all users. One failing user aborted it on PostgreSQL (and a failed
  flush rolled back the session anywhere), so no user's policy was applied; a Python error after a partial delete
  committed that user's half-done work.

  ## Change
  One SAVEPOINT (`begin_nested`) per user; `user_id` read before it; policies ordered by `user_id`.

  ## Tests
  `tests/test_retention_sweep.py`: failing user between two healthy ones, with a Python error and with a flush
  error; the healthy users' deletes and `last_run_at` persist, the failing user's delete is rolled back.
  ```
- PR body outline: Problem (roadmap R7), Change, Tests (new file; before/after), Not covered (no PostgreSQL in CI;
  savepoint semantics on Postgres are standard), Pre-existing failures (the two metrics characterization tests).
  End with the PR attribution line the session requires.

## 12. If stuck

- If `begin_nested()` raises on SQLite (for example "no such savepoint"), stop and report the full traceback and
  the output of `uv run python -c "import sqlite3; print(sqlite3.sqlite_version)"`; do not switch to a
  commit-per-user design on your own.
- If `tests/test_web_settings.py` starts failing, report the failing test names and the diff; do not edit those
  tests.
