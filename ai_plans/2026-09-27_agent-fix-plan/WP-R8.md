# WP-R8: Cloud races - one share row per task, atomic settings version check

Status: ready
Effort: M      Risk: medium      Depends on: none (touches no file that WP-R7, WP-R9 or WP-R10 touch)
Branch name: fix/r8-share-and-settings-races      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

(a) Sharing: make `task_shares.task_id` unique (a migration that first deletes duplicate rows, keeping the oldest)
and replace select-then-insert in `share_task` with `INSERT ... ON CONFLICT (task_id) DO NOTHING`, then update the
row if it already existed. (b) User settings: do the optimistic `version` check inside the SQL
(`UPDATE ... WHERE version = :v RETURNING version`), raise a domain error `SettingsVersionConflict` from the
service, and map it to HTTP 409 in the router (the service must no longer raise `HTTPException`).

## 2. Why it matters (user-visible effect, 2-4 sentences)

Two overlapping share requests (double click, or the extension's backfill-and-retry) insert two share rows; from
then on `scalar_one_or_none()` on that task's share raises `MultipleResultsFound`, so the `/shared/<id>` page
and every later share of that task answer 500. Two settings saves carrying the same `version` can both pass the
Python comparison, and the later one silently overwrites the earlier one instead of getting 409.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `AGENTS.md`; `docs/architecture.md` "Do not touch", bullet "Cloud API" (share 404 for unknown tasks,
  `response_model_exclude_none=True`, SQLite as the test DB).
- `self-hosted-cloudapi/src/services/share_service.py`: `share_task`.
- `self-hosted-cloudapi/src/routers/extension.py`: `share_task_endpoint` (the 404 contract; unchanged).
- `self-hosted-cloudapi/src/services/task_access.py`: `shared_view_access` (uses `scalar_one_or_none()` on the
  share; this is what duplicates break).
- `self-hosted-cloudapi/src/models/task.py`: `class TaskShare`, `class TaskMessage` (its `__table_args__` comment
  explains why the model declares a unique INDEX that matches the migration).
- `self-hosted-cloudapi/src/services/telemetry_service.py`: `get_or_create_task` (the existing
  dialect-specific `on_conflict_do_nothing` pattern this WP copies).
- `self-hosted-cloudapi/alembic/versions/a3b4c5d6e7f8_telemetry_metrics_index.py` (current head) and
  `d4e5f6a7b8c9_task_messages_unique_ts.py` (a previous dedupe-then-unique-index migration).
- `self-hosted-cloudapi/tests/test_migration_drift.py`: fixtures `migrate_env`, helpers `_load_baseline`,
  `_seed_legacy_rows`, `_alembic`, constant `SQLITE_START_REVISION`; tests `test_migrations_reach_the_models`,
  `test_migrated_database_matches_the_models_exactly`.
- `self-hosted-cloudapi/src/services/settings_service.py`: `update_user_settings`.
- `self-hosted-cloudapi/src/routers/settings.py`: `update_user_settings_endpoint`.
- `self-hosted-cloudapi/src/services/user_service.py`: `get_or_create_user_settings`.
- `self-hosted-cloudapi/src/models/settings.py`: `class UserSettings` (`version = Column(Integer, default=0)`).

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/models/task.py`, `class TaskShare` (near line 150):

```python
class TaskShare(Base):
    """Task share model."""
    __tablename__ = "task_shares"

    id = Column(String, primary_key=True, default=lambda: generate_id("sh_"))
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    visibility = Column(String, default="organization")
```

`src/services/share_service.py`, `share_task`, second half (near line 58):

```python
    # Check for existing share
    result = await db.execute(
        select(TaskShare).where(TaskShare.task_id == task_id)
    )
    existing_share = result.scalar_one_or_none()

    # Absolute URLs so the link the extension copies to the clipboard is
    # directly openable in a browser.
    base = settings.api_base_url.rstrip("/")
    share_url = f"{base}/shared/{task_id}"
    manage_url = f"{base}/app/tasks/{task_id}"

    if existing_share:
        # Refresh visibility and (legacy relative) URLs to the absolute form.
        existing_share.visibility = visibility
        existing_share.share_url = share_url
        existing_share.manage_url = manage_url
        await db.flush()
        return ShareResponse(
            success=True,
            share_url=share_url,
            is_new_share=False,
            manage_url=manage_url,
        )

    # Create new share
    share = TaskShare(
        task_id=task_id,
        visibility=visibility,
        share_url=share_url,
        manage_url=manage_url,
    )
    db.add(share)
    await db.flush()

    return ShareResponse(
        success=True,
        share_url=share_url,
        is_new_share=True,
        manage_url=manage_url,
    )
```

The FIRST half of `share_task` (task lookup returning `ShareResponse(success=False, error="Task not found")`, and
the organization policy checks) stays exactly as it is: that is what produces the 404 contract.

`src/services/settings_service.py`, `update_user_settings` (near line 98):

```python
async def update_user_settings(
    db: AsyncSession,
    user_id: str,
    settings: UserSettingsConfig,
    version: Optional[int] = None,
) -> UserSettingsData:
    """Update user settings with optimistic locking."""
    user_settings = await get_or_create_user_settings(db, user_id)

    # Optimistic locking check
    if version is not None and user_settings.version != version:
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail="Version conflict")

    user_settings.settings = json.dumps(settings.model_dump(by_alias=False))
    user_settings.version += 1
    await db.flush()
```

`src/routers/settings.py`, `update_user_settings_endpoint` (near line 50):

```python
    """Update user settings with optimistic locking."""
    return await update_user_settings(
        db=db,
        user_id=current_user["user_id"],
        settings=body.settings,
        version=body.version,
    )
```

Alembic chain (verified by reading every `revision`/`down_revision`): a1b2c3d4e5f6 -> b2c3d4e5f6a7 ->
c3d4e5f6a7b8 -> d4e5f6a7b8c9 -> e5f6a7b8c9d0 -> f6a7b8c9d0e1 -> a7b8c9d0e1f2 -> b8c9d0e1f2a3 -> c9d0e1f2a3b4 ->
d0e1f2a3b4c5 -> e1f2a3b4c5d6 -> f2a3b4c5d6e7 -> a3b4c5d6e7f8 (HEAD). The new revision is `b4c5d6e7f8a9`.

The existing index is named `ix_task_shares_task_id` (see `tests/fixtures/baseline_schema_sqlite.sql`:
`CREATE INDEX ix_task_shares_task_id ON task_shares (task_id);`; production databases were built by
`create_all` from the same model, so the name is the same there).

## 5. Root cause / analysis

VERIFIED:
- Ran `tests/test_share_unique.py::test_overlapping_shares_create_one_row` (two `share_task` calls in two sessions
  under `asyncio.gather`) on the unchanged code: FAILS, two rows are created. With the fix: one row, one response
  `is_new_share=True`, the other `False`.
- `test_the_database_refuses_a_second_share_row_for_a_task` fails before (no unique index), passes after.
- The model change `index=True, unique=True` makes SQLAlchemy create a UNIQUE index with the SAME name
  `ix_task_shares_task_id`. With the migration, `tests/test_migration_drift.py` passes; with the model change but
  WITHOUT the migration, `test_migrations_reach_the_models` and
  `test_migrated_database_matches_the_models_exactly` FAIL (checked), so the drift guard covers this.
- The dedupe SQL (window function + `CASE` for NULL ordering) runs on SQLite 3.45 (checked by the new migration
  test) and is standard SQL that PostgreSQL accepts.
- Settings: `test_a_write_based_on_a_stale_read_is_refused` fails on the unchanged code (the stale session sees
  version 0 in its identity map and overwrites; no conflict raised). With the fix it raises
  `SettingsVersionConflict` and the stored row keeps the first writer's value.
- The whole suite passes with the fix except the 2 pre-existing `test_metrics_characterization.py` failures.
- `share_task` still returns `success=False, error="Task not found"` for an unknown or foreign task before any
  insert, so the endpoint's 404 is unchanged (pinned by the new endpoint test and by the existing
  `tests/test_web_and_share.py::test_share_task_by_non_owner_returns_not_found`).

HYPOTHESIS: production PostgreSQL may already contain duplicate share rows (the 500 on `/shared/<id>` would be
the symptom). The migration handles both cases. To check before deploying (optional, read-only):
`SELECT task_id, count(*) FROM task_shares GROUP BY task_id HAVING count(*) > 1;`. Whatever the answer, the
migration is the same.

Why keep the OLDEST row: share URLs are built from the task id (`/shared/<task_id>`), not the share id, so every
link keeps working whichever row survives. Duplicates could only come from the race (after the first duplicate,
`scalar_one_or_none()` raised, so no later share could succeed), so the rows were created moments apart with the
same visibility.

Design notes:
- `db.bind.dialect.name` is how `telemetry_service.get_or_create_task` picks the dialect insert; reuse that.
- The `update(UserSettings)` uses `execution_options(synchronize_session=False)`: the ORM object loaded by
  `get_or_create_user_settings` is not read again in the request. The `TimestampMixin.updated_at`
  `onupdate=func.now()` still applies to a Core UPDATE.
- SQLite supports `UPDATE ... RETURNING` (3.35+); SQLAlchemy 2.0.54 emits it for both dialects.

## 6. Step-by-step changes

Step 1. File `self-hosted-cloudapi/src/models/task.py`. Find:

```python
    task_id = Column(String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    visibility = Column(String, default="organization")
```

(`task_id = Column(String, ForeignKey("tasks.id", ...` appears in other classes too; this two-line snippet with
`visibility` is unique.) Replace with:

```python
    # One share per task. unique=True with index=True makes the existing
    # ix_task_shares_task_id a UNIQUE index (migration b4c5d6e7f8a9), which is
    # what share_service's ON CONFLICT (task_id) DO NOTHING relies on.
    task_id = Column(
        String, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True, unique=True
    )
    visibility = Column(String, default="organization")
```

Step 2. New file `self-hosted-cloudapi/alembic/versions/b4c5d6e7f8a9_task_shares_unique_task.py`, full content:

```python
"""One share row per task: deduplicate task_shares and make task_id unique.

``share_service.share_task`` selected the task's share and inserted one when
it found none, with only a plain index on ``task_shares.task_id``. Two share
requests that overlapped (a double click, a retry after a slow backfill) both
inserted, and every later ``scalar_one_or_none()`` on that task's share (the
/shared page, the next share) raised MultipleResultsFound.

This keeps the OLDEST row of each task (earliest ``created_at``, rows without
one last, then the smallest id) and turns ``ix_task_shares_task_id`` into a
UNIQUE index under the same name, so the model (``index=True, unique=True``)
and a migrated database hold the same object. The share URL is built from the
task id, not the share id, so every link handed out keeps working.

Duplicates only ever came from the race, so they were created moments apart
with the same visibility; nothing is lost by keeping the first.

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-09-27 12:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "b4c5d6e7f8a9"
down_revision = "a3b4c5d6e7f8"
branch_labels = None
depends_on = None

_INDEX = "ix_task_shares_task_id"


def upgrade() -> None:
    # Portable SQL: window functions run on PostgreSQL and on SQLite >= 3.25,
    # and the CASE puts NULL created_at last on both without NULLS LAST.
    op.execute(
        """
        DELETE FROM task_shares
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY task_id
                           ORDER BY CASE WHEN created_at IS NULL THEN 1 ELSE 0 END,
                                    created_at,
                                    id
                       ) AS rn
                FROM task_shares
            ) ranked
            WHERE ranked.rn > 1
        )
        """
    )
    op.drop_index(_INDEX, table_name="task_shares")
    op.create_index(_INDEX, "task_shares", ["task_id"], unique=True)


def downgrade() -> None:
    op.drop_index(_INDEX, table_name="task_shares")
    op.create_index(_INDEX, "task_shares", ["task_id"], unique=False)
```

Step 3. File `self-hosted-cloudapi/src/services/share_service.py`. The import line
`from sqlalchemy import select, delete, update` already exists; keep it. Find the whole block quoted in section 4
starting at `    # Check for existing share` and ending at the end of `share_task` (the final
`return ShareResponse(... is_new_share=True, ...)`), and replace it with:

```python
    # Absolute URLs so the link the extension copies to the clipboard is
    # directly openable in a browser.
    base = settings.api_base_url.rstrip("/")
    share_url = f"{base}/shared/{task_id}"
    manage_url = f"{base}/app/tasks/{task_id}"

    # Insert first, then read: two overlapping share requests used to both
    # SELECT nothing and both INSERT, leaving two rows that made every later
    # scalar_one_or_none() on the share raise. task_shares.task_id is unique
    # now, so the loser of the race inserts nothing and updates the winner's row.
    is_new_share = await _insert_share_if_missing(
        db, task_id, visibility, share_url, manage_url
    )
    if not is_new_share:
        # Refresh visibility and (legacy relative) URLs to the absolute form.
        await db.execute(
            update(TaskShare)
            .where(TaskShare.task_id == task_id)
            .values(visibility=visibility, share_url=share_url, manage_url=manage_url)
        )
    await db.flush()

    return ShareResponse(
        success=True,
        share_url=share_url,
        is_new_share=is_new_share,
        manage_url=manage_url,
    )


async def _insert_share_if_missing(
    db: AsyncSession,
    task_id: str,
    visibility: str,
    share_url: str,
    manage_url: str,
) -> bool:
    """Insert the task's share row unless it has one. True when it was inserted.

    ``INSERT ... ON CONFLICT (task_id) DO NOTHING`` on PostgreSQL and SQLite,
    the same pattern as telemetry_service.get_or_create_task.
    """
    dialect = db.bind.dialect.name
    if dialect not in ("postgresql", "sqlite"):
        # No portable ON CONFLICT: select, then insert (the old behavior).
        existing = await db.execute(select(TaskShare.id).where(TaskShare.task_id == task_id))
        if existing.first() is not None:
            return False
        db.add(TaskShare(task_id=task_id, visibility=visibility, share_url=share_url, manage_url=manage_url))
        await db.flush()
        return True

    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as _insert
    else:
        from sqlalchemy.dialects.sqlite import insert as _insert

    result = await db.execute(
        _insert(TaskShare)
        .values(
            task_id=task_id,
            visibility=visibility,
            share_url=share_url,
            manage_url=manage_url,
        )
        .on_conflict_do_nothing(index_elements=["task_id"])
    )
    return result.rowcount == 1
```

(`_insert_share_if_missing` is a new module-level function placed directly after `share_task` and before
`delete_shared_task`. The replacement text above already contains it.)

Step 4. File `self-hosted-cloudapi/src/services/settings_service.py`.

4a. Find:

```python
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings as app_settings
```

Replace with:

```python
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings as app_settings
from src.models.settings import UserSettings
```

4b. Find `def _content_version(payload: dict) -> int:` and insert directly ABOVE it (keep two blank lines between
top-level definitions):

```python
class SettingsVersionConflict(Exception):
    """The caller's ``version`` is not the stored one: someone saved in between.

    Raised by ``update_user_settings``; routers/settings.py answers it with 409.
    """


```

4c. Find the body of `update_user_settings` from its docstring to its `return` (quoted in section 4, plus the
`return UserSettingsData(... version=user_settings.version,)` that follows) and replace the body (everything after
the signature line `) -> UserSettingsData:`) with:

```python
    """Update user settings with optimistic locking.

    The version check is part of the UPDATE itself (``WHERE version = :v``),
    so two requests carrying the same version cannot both pass it: the second
    matches no row and gets ``SettingsVersionConflict``. Comparing in Python
    after a SELECT let both through, and the later write silently replaced the
    earlier one. ``version=None`` skips the check, as before.
    """
    # Makes sure the row exists; its (possibly stale) values are not used.
    await get_or_create_user_settings(db, user_id)

    stmt = (
        update(UserSettings)
        .where(UserSettings.user_id == user_id)
        .values(
            settings=json.dumps(settings.model_dump(by_alias=False)),
            version=UserSettings.version + 1,
        )
        .returning(UserSettings.version)
        # The row object loaded above is not refreshed here; nothing in this
        # request reads it again, and "fetch"/"evaluate" would only add a query.
        .execution_options(synchronize_session=False)
    )
    if version is not None:
        stmt = stmt.where(UserSettings.version == version)

    new_version = (await db.execute(stmt)).scalar_one_or_none()
    if new_version is None:
        raise SettingsVersionConflict(f"user settings for {user_id} are not at version {version}")

    return UserSettingsData(
        features=UserFeatures(),
        settings=settings,
        version=new_version,
    )
```

Step 5. File `self-hosted-cloudapi/src/routers/settings.py`.

5a. Find `from fastapi import APIRouter, Depends` and replace with
`from fastapi import APIRouter, Depends, HTTPException, status`.

5b. Find `from src.services.settings_service import get_extension_settings, update_user_settings` and replace with:

```python
from src.services.settings_service import (
    SettingsVersionConflict,
    get_extension_settings,
    update_user_settings,
)
```

5c. Find:

```python
    """Update user settings with optimistic locking."""
    return await update_user_settings(
        db=db,
        user_id=current_user["user_id"],
        settings=body.settings,
        version=body.version,
    )
```

Replace with:

```python
    """Update user settings with optimistic locking (409 on a stale version)."""
    try:
        return await update_user_settings(
            db=db,
            user_id=current_user["user_id"],
            settings=body.settings,
            version=body.version,
        )
    except SettingsVersionConflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Version conflict")
```

Keep the decorator `@router.patch("/user-settings", response_model_exclude_none=True)` exactly as it is.

Step 6. `docs/08-cloud.md`: no text describes share or settings internals; no change. `README.md`: no change.

## 7. Tests to add or change

7.1 New file `self-hosted-cloudapi/tests/test_share_unique.py`:

```python
"""One share row per task (R8a).

``share_task`` used to SELECT the share and INSERT one when it found none,
with only a plain index on ``task_shares.task_id``. Two share clicks that
overlapped both found nothing and both inserted, and from then on every
``scalar_one_or_none()`` on the task's share (the share page, the next share)
raised MultipleResultsFound, a 500. The column now has a unique index and the
insert is ``ON CONFLICT (task_id) DO NOTHING``.
"""

import asyncio

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from src.dependencies import get_current_user
from src.models.task import Task, TaskShare
from src.services.share_service import share_task
from tests.web_helpers import _override_current_user, _seed_user


async def _share_count(session_factory, task_id: str) -> int:
    async with session_factory() as s:
        return (
            await s.execute(select(func.count(TaskShare.id)).where(TaskShare.task_id == task_id))
        ).scalar_one()


async def _seed_task(session_factory, db_session, task_id="task-share-1"):
    await _seed_user(db_session)
    async with session_factory() as s:
        s.add(Task(id=task_id, user_id="user_test"))
        await s.commit()
    return task_id


async def test_the_database_refuses_a_second_share_row_for_a_task(session_factory, db_session):
    task_id = await _seed_task(session_factory, db_session)
    async with session_factory() as s:
        s.add(TaskShare(task_id=task_id, visibility="organization"))
        await s.commit()

    async with session_factory() as s:
        s.add(TaskShare(task_id=task_id, visibility="public"))
        with pytest.raises(IntegrityError):
            await s.commit()


async def test_overlapping_shares_create_one_row(session_factory, db_session):
    """Two share calls whose SELECT and INSERT interleave, as two clicks do."""
    task_id = await _seed_task(session_factory, db_session)

    async def share_once():
        async with session_factory() as s:
            response = await share_task(s, task_id, "user_test", "organization")
            await s.commit()
            return response

    first, second = await asyncio.gather(share_once(), share_once())

    assert first.success and second.success
    assert first.share_url == second.share_url
    assert sorted([first.is_new_share, second.is_new_share]) == [False, True]
    assert await _share_count(session_factory, task_id) == 1


async def test_sharing_again_updates_the_one_row(session_factory, db_session):
    task_id = await _seed_task(session_factory, db_session)

    async with session_factory() as s:
        first = await share_task(s, task_id, "user_test", "organization")
        await s.commit()
    async with session_factory() as s:
        second = await share_task(s, task_id, "user_test", "public")
        await s.commit()

    assert first.is_new_share is True
    assert second.is_new_share is False
    assert await _share_count(session_factory, task_id) == 1
    async with session_factory() as s:
        share = (await s.execute(select(TaskShare).where(TaskShare.task_id == task_id))).scalar_one()
    assert share.visibility == "public"
    assert share.share_url == "http://testserver/shared/task-share-1"


async def test_share_endpoint_still_answers_404_for_an_unknown_task(client, db_session, session_factory):
    """Do-not-touch contract: the extension backfills and retries on this 404."""
    await _seed_user(db_session)
    from src.main import app

    _override_current_user(app)
    try:
        resp = client.post("/api/extension/share", json={"taskId": "task-missing", "visibility": "organization"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert resp.status_code == 404
    assert await _share_count(session_factory, "task-missing") == 0
```

Fails without the fix: `test_the_database_refuses_a_second_share_row_for_a_task` (no IntegrityError) and
`test_overlapping_shares_create_one_row` (2 rows). The other two pin behavior that must not change.

7.2 New file `self-hosted-cloudapi/tests/test_user_settings_version.py`:

```python
"""PATCH /api/user-settings: the optimistic version check is atomic (R8b).

The service used to read the row, compare ``version`` in Python and then
write. Two PATCHes carrying the same version could both pass the comparison
(or one could compare against a copy of the row read before the other
committed), and the second silently overwrote the first. The check is now
part of the UPDATE (``WHERE version = :v RETURNING version``), and a miss is
a domain error the router turns into 409.
"""

import pytest
from sqlalchemy import select

from src.dependencies import get_current_user
from src.models.settings import UserSettings
from src.schemas.settings import UserSettingsConfig
from src.services.settings_service import SettingsVersionConflict, update_user_settings
from src.services.user_service import get_or_create_user_settings
from tests.web_helpers import _override_current_user, _seed_user


async def _stored(session_factory) -> UserSettings:
    async with session_factory() as s:
        return (
            await s.execute(select(UserSettings).where(UserSettings.user_id == "user_test"))
        ).scalar_one()


async def test_a_write_based_on_a_stale_read_is_refused(session_factory, db_session):
    await _seed_user(db_session)
    async with session_factory() as s:
        await get_or_create_user_settings(s, "user_test")
        await s.commit()

    async with session_factory() as slow, session_factory() as fast:
        # The slow request has already read the row at version 0 (kept in a
        # variable, as the old code kept it between its check and its write) ...
        read_before = await get_or_create_user_settings(slow, "user_test")
        assert read_before.version == 0
        # ... when a faster one, sent with the same version, commits first.
        await update_user_settings(fast, "user_test", UserSettingsConfig(task_sync_enabled=True), version=0)
        await fast.commit()

        with pytest.raises(SettingsVersionConflict):
            await update_user_settings(
                slow, "user_test", UserSettingsConfig(task_sync_enabled=False), version=0
            )
        await slow.rollback()

    stored = await _stored(session_factory)
    assert stored.version == 1
    assert '"task_sync_enabled": true' in stored.settings


async def test_matching_version_updates_and_bumps(session_factory, db_session):
    await _seed_user(db_session)
    async with session_factory() as s:
        result = await update_user_settings(s, "user_test", UserSettingsConfig(task_sync_enabled=True), version=0)
        await s.commit()
    assert result.version == 1

    async with session_factory() as s:
        result = await update_user_settings(s, "user_test", UserSettingsConfig(task_sync_enabled=False), version=1)
        await s.commit()
    assert result.version == 2
    assert (await _stored(session_factory)).version == 2


async def test_no_version_means_no_check(session_factory, db_session):
    await _seed_user(db_session)
    for expected in (1, 2):
        async with session_factory() as s:
            result = await update_user_settings(s, "user_test", UserSettingsConfig(), version=None)
            await s.commit()
        assert result.version == expected


def _patch(client, body):
    from src.main import app

    _override_current_user(app)
    try:
        return client.patch("/api/user-settings", json=body)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


async def test_endpoint_answers_409_for_a_stale_version(client, db_session, session_factory):
    await _seed_user(db_session)

    ok = _patch(client, {"settings": {"taskSyncEnabled": True}, "version": 0})
    stale = _patch(client, {"settings": {"taskSyncEnabled": False}, "version": 0})

    assert ok.status_code == 200, ok.text
    assert ok.json() == {"features": {}, "settings": {"taskSyncEnabled": True}, "version": 1}
    assert stale.status_code == 409
    assert stale.json() == {"detail": "Version conflict"}
    stored = await _stored(session_factory)
    assert stored.version == 1
    assert '"task_sync_enabled": true' in stored.settings
```

Fails without the fix: ImportError on `SettingsVersionConflict` (the whole module). If you want to see the
behavioral failure first, temporarily alias it (`from fastapi import HTTPException as SettingsVersionConflict`):
then only `test_a_write_based_on_a_stale_read_is_refused` fails (checked). Revert the alias before committing.
Note `read_before` must stay assigned: the identity map is weak-referencing, and without a live reference the
old code would re-load a fresh row and the stale-read scenario would not be reproduced.

7.3 Append to the END of `self-hosted-cloudapi/tests/test_migration_drift.py`, after two blank lines (it reuses
that module's fixtures and helpers; `pytest` and `sqlite3` are already imported there):

```python
# --- Data migrations ------------------------------------------------------------


def test_task_shares_migration_keeps_the_oldest_share_of_each_task(migrate_env):
    """b4c5d6e7f8a9 collapses duplicate shares (R8) before adding the unique index."""
    db_file, run = migrate_env
    _load_baseline(db_file)
    _seed_legacy_rows(db_file)
    _alembic(run, "stamp", SQLITE_START_REVISION)
    _alembic(run, "upgrade", "a3b4c5d6e7f8")
    with sqlite3.connect(db_file) as conn:
        conn.execute("INSERT INTO tasks (id, user_id) VALUES ('task_2', 'user_1')")
        conn.executemany(
            "INSERT INTO task_shares (id, task_id, visibility, created_at) VALUES (?, ?, ?, ?)",
            [
                ("sh_new", "task_1", "public", "2026-09-02 10:00:00.000000"),
                ("sh_old", "task_1", "organization", "2026-09-01 10:00:00.000000"),
                ("sh_undated", "task_1", "public", None),
                ("sh_only", "task_2", "organization", "2026-09-03 10:00:00.000000"),
            ],
        )

    _alembic(run, "upgrade", "head")

    with sqlite3.connect(db_file) as conn:
        kept = conn.execute("SELECT id FROM task_shares ORDER BY id").fetchall()
        assert kept == [("sh_old",), ("sh_only",)]
        # The index is unique now: a second share for the task is refused.
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO task_shares (id, task_id) VALUES ('sh_dup', 'task_1')")
```

Fails without the migration file (checked): the upgrade leaves all 3 rows of `task_1` and inserting `sh_dup` does
not raise.

## 8. Commands to run (exact, from which directory) and the expected result

All from `self-hosted-cloudapi/`:

1. `uv sync --frozen --extra dev`.
2. Add the three test changes first; run
   `uv run pytest -q tests/test_share_unique.py tests/test_user_settings_version.py tests/test_migration_drift.py`
   -> share: 2 failed / 2 passed; settings: collection error (ImportError); drift: the new test fails.
3. Apply steps 1-5, rerun the same command -> all pass (4 + 4 + 13).
4. Wider: `uv run pytest -q tests/test_web_and_share.py tests/test_web_shared.py tests/test_shared_access.py tests/test_route_table.py`
   -> all pass.
5. Whole suite: `uv run pytest` -> all pass except the two pre-existing failures in
   `tests/test_metrics_characterization.py` (they fail on untouched main too; see WP-R7 section 8).
6. `make lint` -> "All checks passed!".
7. Type check / eslint / prettier: not applicable. Do not run `ruff format .` over the repo.
8. No PostgreSQL run is possible in CI or with the bundled compose (its postgres is not published to the host).
   The migration's SQL is portable; say in the PR that the Postgres path was not executed.

## 9. Do not touch / pitfalls

- Share must keep returning 404 for unknown tasks (do-not-touch). Do not move the insert above the
  `Task`-lookup/ownership check.
- `response_model_exclude_none=True` on `/api/user-settings` and `/api/extension/share` must stay.
- Do not change `TaskMessage`'s `uq_task_messages_task_ts` or the monotonic upsert in `telemetry_service.py`.
- `ON CONFLICT` must name the column (`index_elements=["task_id"]`), never `constraint="ix_task_shares_task_id"`:
  PostgreSQL accepts `ON CONFLICT ON CONSTRAINT` only for a constraint, not an index (see the comment on
  `TaskMessage.__table_args__`).
- Do not rename the index; the drift test compares names. Do not add a `UniqueConstraint` in `__table_args__`
  (that would create a constraint where migrated databases have an index).
- The migration uses plain `op.drop_index`/`op.create_index` (no batch mode needed: SQLite supports dropping and
  creating indexes directly). It must run inside alembic's transaction; do not use `CONCURRENTLY`.
- `KNOWN_DRIFT` in `test_migration_drift.py` must stay empty.
- Settings: keep `version=None` meaning "no check" (the extension may omit it).
- `get_or_create_user_settings` itself can still race on the very first save of a brand-new user (two inserts,
  `user_id` is unique, one gets IntegrityError -> 500). Out of scope; mention in the PR as a follow-up.

## 10. Acceptance checklist (checkboxes)

- [ ] `TaskShare.task_id` declared `index=True, unique=True`.
- [ ] Migration `b4c5d6e7f8a9` (down_revision `a3b4c5d6e7f8`) dedupes keeping the oldest, recreates
      `ix_task_shares_task_id` as unique; downgrade restores the non-unique index.
- [ ] Exactly one alembic head, `b4c5d6e7f8a9` (the drift tests' `_head_revision()` would break on two heads;
      `tests/test_migration_drift.py` passing is the check).
- [ ] `share_task` uses `_insert_share_if_missing` (ON CONFLICT DO NOTHING) then an UPDATE for an existing row.
- [ ] Unknown/foreign task still -> 404.
- [ ] `update_user_settings` issues one `UPDATE ... WHERE version = :v RETURNING version`; raises
      `SettingsVersionConflict`; no `HTTPException` import left in `settings_service.py`.
- [ ] Router maps `SettingsVersionConflict` to 409 `{"detail": "Version conflict"}`.
- [ ] New tests fail before and pass after; `uv run pytest` has no new failures; `make lint` passes.
- [ ] `ai_plans/` note added.

## 11. Commit, changeset and PR text

- Commit title: `fix(cloudapi): one share row per task and an atomic settings version check (R8)`
- Commit body:
  ```
  Share: task_shares.task_id had only a plain index and share_task did
  select-then-insert, so overlapping share requests created two rows and
  every later scalar_one_or_none() on the share (the /shared page, the next
  share) raised. Migration b4c5d6e7f8a9 keeps the oldest row per task and
  makes ix_task_shares_task_id unique; share_task inserts with ON CONFLICT
  (task_id) DO NOTHING and updates the existing row otherwise. Unknown tasks
  still get 404.

  Settings: the optimistic version check ran in Python after a SELECT, so
  two PATCHes with the same version could both pass. It is now part of the
  UPDATE (WHERE version = :v RETURNING version); a miss raises
  SettingsVersionConflict, which the router maps to 409.

  Tests: tests/test_share_unique.py, tests/test_user_settings_version.py,
  and a data-migration test in tests/test_migration_drift.py.
  ```
  End with the attribution lines the session requires.
- Changeset: none (cloud API only).
- `ai_plans/<today as YYYY-MM-DD>_cloud-share-and-settings-races.md`: title "Cloud: share and settings races
  (R8)", Status line, Touched files (model, migration, share_service, settings_service, routers/settings, three
  test files), Problem (two paragraphs from the commit body), Change, Tests, Follow-up (first-save race in
  `get_or_create_user_settings`).
- PR body outline: Problem (a) and (b), Change, Migration notes (what the dedupe keeps; how to check for duplicates
  beforehand with the read-only SQL in section 5), Tests (before/after), Do-not-touch respected (404, exclude_none),
  Not covered (no Postgres in CI), Pre-existing failures. End with the PR attribution line.

## 12. If stuck

- If the drift tests fail after the migration, print the diff with
  `uv run pytest -q tests/test_migration_drift.py -k reach -vv` and report it; do not add entries to `KNOWN_DRIFT`.
- If `result.rowcount` is `-1` or `None` for the dialect insert (it is 1/0 on SQLite and asyncpg in the checked
  versions), stop and report the SQLAlchemy/driver versions (`uv run python -c "import sqlalchemy; print(sqlalchemy.__version__)"`).
- If `UPDATE ... RETURNING` is rejected by SQLite, report `sqlite3.sqlite_version`; do not fall back to the
  Python comparison.
