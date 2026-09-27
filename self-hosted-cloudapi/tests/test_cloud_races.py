"""R8: two write races in the cloud API (roadmap 2026-09-27, item R8).

Both races are reproduced deterministically — no sleeps, no production hooks.
Each racing caller gets its own session on a FILE-backed SQLite engine (the
suite's in-memory StaticPool shares one connection between sessions, which
would serialize the callers instead of racing them). A per-session wrapper
around ``session.execute`` parks each caller at a shared ``asyncio.Barrier``
immediately AFTER the read the race lives behind:

* Share: ``share_task`` does select-then-insert on ``TaskShare.task_id`` with
  no unique index, so two parallel requests both see "no share yet" and both
  insert → two share rows for one task. Every reader of a task's share uses
  ``scalar_one_or_none()`` (``shared_view_access`` etc.), so duplicates do
  not just waste a row — they break the shared page.
* Settings: ``update_user_settings`` reads the version, compares it in
  Python and writes ``version + 1``, so two parallel PATCHes carrying the
  same expected version both pass the check and one update is silently lost.

The barrier guarantees every caller completed its read before the first
caller's write runs, which is exactly the interleaving two real concurrent
requests produce. On main these tests are red for that reason (N share rows;
N × 200 on the settings PATCH). After the fix they stay green and
regress-guard it: the share insert becomes ON CONFLICT against a unique
index (the loser adopts the winner's row), and the settings write becomes an
atomic ``UPDATE ... WHERE version = :expected RETURNING`` (the loser updates
zero rows → 409).
"""

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy import Select, event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

import src.models  # noqa: F401 — registers every table on Base.metadata
from src.database import Base
from src.models.settings import UserSettings
from src.models.task import Task, TaskShare
from src.models.user import User
from src.schemas.settings import UserSettingsConfig
from src.services.settings_service import update_user_settings
from src.services.share_service import share_task


def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
    """Same pragma the suite's engine installs: make SQLite enforce foreign
    keys (and ON DELETE actions) the way the production Postgres does."""
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


@pytest.fixture
async def race_engine(tmp_path):
    """A file-backed engine: each session checks out its OWN connection, so
    two concurrent calls interleave the way two real HTTP requests do (the
    in-memory StaticPool would hand them the same connection and serialize
    them). SQLite's busy timeout (5 s default) makes a caller that arrives
    at a write while another holds the lock wait for the commit — the
    barrier below guarantees every read happens before any write, so there
    is no lock-ordering deadlock, only a bounded wait."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'races.db'}")
    event.listen(engine.sync_engine, "connect", _enable_sqlite_foreign_keys)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


def _sessions(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


async def _seed(engine, *objects) -> None:
    """Insert objects in the order given, committing between each, like the
    suite's own seeding does (a user is committed before anything references
    it, so the foreign keys hold at every step)."""
    for obj in objects:
        async with _sessions(engine)() as s:
            s.add(obj)
            await s.commit()


def _selects_entity(statement, entity) -> bool:
    """True for ``select(Entity)...`` statements (not updates/inserts/counts
    on other tables)."""
    return (
        isinstance(statement, Select)
        and statement.column_descriptions
        and statement.column_descriptions[0].get("entity") is entity
    )


class _PauseAfterFirstRead:
    """Park every racing caller at one barrier, right after its read.

    Wraps a session's ``execute`` so the FIRST ``Select`` on ``entity`` runs,
    and only then the caller waits at the shared barrier. When all parties
    have arrived — i.e. all of them hold the pre-read state — they are
    released together, and the write phase begins. One pause per session
    keeps the reproduction stable across code-path changes after the fix
    (the service may SELECT the same entity again later; only the first read
    gates the barrier).
    """

    def __init__(self, entity, parties: int):
        self._entity = entity
        self.barrier = asyncio.Barrier(parties)
        self.paused = 0

    def wrap(self, session) -> None:
        original = session.execute
        state = self
        paused_here = False

        async def execute(statement, *args, **kwargs):
            nonlocal paused_here
            result = await original(statement, *args, **kwargs)
            if not paused_here and _selects_entity(statement, state._entity):
                paused_here = True
                state.paused += 1
                await state.barrier.wait()
            return result

        session.execute = execute


# --- Share: select-then-insert race ------------------------------------------


async def _race_share_calls(engine, parties: int):
    """N parallel ``share_task`` calls, each with its own session, all paused
    after their "does a share exist yet?" read."""
    pause = _PauseAfterFirstRead(TaskShare, parties)

    async def one():
        async with _sessions(engine)() as s:
            pause.wrap(s)
            resp = await share_task(s, "task-race", "user_test", "public")
            await s.commit()
            return resp

    outcomes = await asyncio.wait_for(
        asyncio.gather(*[one() for _ in range(parties)]), timeout=20
    )
    return pause, outcomes


@pytest.mark.parametrize("parties", [2, 3])
async def test_concurrent_share_requests_create_exactly_one_share_row(
    race_engine, parties
):
    """R8 share race. N parallel share calls on one task must leave exactly
    one ``task_shares`` row, and exactly one caller may be told it created
    it.

    On main every caller's SELECT sees no share and every INSERT lands (N
    rows, N × is_new_share=True) — red. With the unique index + ON CONFLICT
    insert the losers adopt the winner's row and answer is_new_share=False.
    """
    await _seed(
        race_engine,
        User(id="user_test", authentik_id="ak_user_test", email="t@example.com"),
        Task(id="task-race", user_id="user_test"),
    )

    pause, outcomes = await _race_share_calls(race_engine, parties)

    # On main the service SELECTs TaskShare before inserting, so the barrier
    # fires for every caller and the race reproduces deterministically. Once
    # fixed there is no such read left to pause after (paused == 0) — which
    # is itself part of the proof; the concurrent calls then still happen,
    # and the unique index makes ANY interleaving produce one row.
    assert pause.paused in (0, parties), (
        f"unexpected partial reproduction: {pause.paused}/{parties} paused"
    )
    assert all(r.success for r in outcomes), "no caller may fail"
    assert sorted(1 if r.is_new_share else 0 for r in outcomes) == [0] * (
        parties - 1
    ) + [1], "exactly one caller created the share"

    async with _sessions(race_engine)() as s:
        count = (
            await s.execute(
                select(func.count(TaskShare.id)).where(
                    TaskShare.task_id == "task-race"
                )
            )
        ).scalar_one()
        assert count == 1, f"expected exactly 1 share row, found {count}"
        # And the survivor row is a normal, fully-formed share.
        share = (
            await s.execute(
                select(TaskShare).where(TaskShare.task_id == "task-race")
            )
        ).scalar_one()
        assert share.visibility == "public"
        assert share.share_url == "http://testserver/shared/task-race"
        assert share.manage_url == "http://testserver/app/tasks/task-race"


async def test_sharing_an_already_shared_task_returns_the_existing_share(
    race_engine,
):
    """The non-racing re-share path keeps today's contract: the existing row
    is refreshed in place (visibility/urls) and answered is_new_share=False.
    Pins the "idempotent fetch of the existing row" half of the fix — with
    it, a share call landing after another request already shared the task
    updates that row instead of creating a second one."""
    await _seed(
        race_engine,
        User(id="user_test", authentik_id="ak_user_test", email="t@example.com"),
        Task(id="task-reshare", user_id="user_test"),
    )

    async with _sessions(race_engine)() as s:
        first = await share_task(s, "task-reshare", "user_test", "organization")
        await s.commit()
    async with _sessions(race_engine)() as s:
        second = await share_task(s, "task-reshare", "user_test", "public")
        await s.commit()

    assert first.is_new_share is True
    assert second.success is True
    assert second.is_new_share is False

    async with _sessions(race_engine)() as s:
        share = (
            await s.execute(
                select(TaskShare).where(TaskShare.task_id == "task-reshare")
            )
        ).scalar_one()
        assert share.visibility == "public", "visibility must be refreshed"


# --- Settings: Python-side optimistic version check race ---------------------


async def _race_settings_calls(engine, parties: int):
    """N parallel ``update_user_settings`` calls, each with its own session,
    all paused after reading the settings row, all carrying the same expected
    version (1)."""
    pause = _PauseAfterFirstRead(UserSettings, parties)

    async def one():
        async with _sessions(engine)() as s:
            pause.wrap(s)
            try:
                data = await update_user_settings(
                    s,
                    "user_test",
                    UserSettingsConfig(task_sync_enabled=True),
                    version=1,
                )
                await s.commit()
                return ("ok", data.version)
            except HTTPException as exc:
                await s.rollback()
                return ("conflict", exc.status_code)

    outcomes = await asyncio.wait_for(
        asyncio.gather(*[one() for _ in range(parties)]), timeout=20
    )
    return pause, outcomes


@pytest.mark.parametrize("parties", [2, 3])
async def test_concurrent_settings_patches_let_exactly_one_win(
    race_engine, parties
):
    """R8 settings race. N parallel PATCHes all carrying the same expected
    version: exactly ONE may win; every other caller must get a 409.

    On main all callers read the same version, all pass the Python-side
    comparison, and all write — N × 200, the losers' payloads silently lost
    — red. With the SQL-side compare-and-swap the losers update zero rows
    and get the same 409 a sequential stale write gets.
    """
    await _seed(
        race_engine,
        User(id="user_test", authentik_id="ak_user_test", email="t@example.com"),
    )
    # Pre-create the settings row (version 0 → this update makes it 1), so
    # the race happens on an existing row rather than in get-or-create.
    async with _sessions(race_engine)() as s:
        await update_user_settings(
            s, "user_test", UserSettingsConfig(task_sync_enabled=False)
        )
        await s.commit()

    pause, outcomes = await _race_settings_calls(race_engine, parties)

    assert pause.paused == parties, "every caller must reach the read first"
    statuses = sorted(kind for kind, _ in outcomes)
    assert statuses == ["conflict"] * (parties - 1) + [
        "ok"
    ], f"exactly one winner expected, got {statuses}"
    assert all(
        code == 409 for kind, code in outcomes if kind == "conflict"
    ), "losers must see HTTP 409, not another status"

    winner_version = [v for kind, v in outcomes if kind == "ok"][0]
    assert winner_version == 2, "the winner advanced the version by exactly one"

    async with _sessions(race_engine)() as s:
        rows = (
            await s.execute(
                select(func.count(UserSettings.id)).where(
                    UserSettings.user_id == "user_test"
                )
            )
        ).scalar_one()
        assert rows == 1, "one settings row for the user"
        stored = (
            await s.execute(
                select(UserSettings.version).where(
                    UserSettings.user_id == "user_test"
                )
            )
        ).scalar_one()
        assert stored == 2


async def test_settings_version_conflict_response_is_unchanged(race_engine):
    """The sequential stale-version PATCH keeps today's shape: HTTP 409 with
    detail "Version conflict"."""
    await _seed(
        race_engine,
        User(id="user_test", authentik_id="ak_user_test", email="t@example.com"),
    )
    async with _sessions(race_engine)() as s:
        await update_user_settings(
            s, "user_test", UserSettingsConfig(task_sync_enabled=True)
        )
        await s.commit()

    async with _sessions(race_engine)() as s:
        with pytest.raises(HTTPException) as exc_info:
            await update_user_settings(
                s,
                "user_test",
                UserSettingsConfig(task_sync_enabled=False),
                version=0,  # stale: the stored row is already at version 1
            )
        await s.rollback()

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail == "Version conflict"


async def test_settings_update_without_version_always_succeeds(race_engine):
    """A PATCH that carries no expected version opts out of optimistic
    locking: it must keep succeeding unconditionally and bump the version by
    one, exactly as before the CAS change."""
    await _seed(
        race_engine,
        User(id="user_test", authentik_id="ak_user_test", email="t@example.com"),
    )

    async with _sessions(race_engine)() as s:
        first = await update_user_settings(
            s, "user_test", UserSettingsConfig(task_sync_enabled=True)
        )
        await s.commit()
    async with _sessions(race_engine)() as s:
        second = await update_user_settings(
            s, "user_test", UserSettingsConfig(task_sync_enabled=False)
        )
        await s.commit()

    assert first.version == 1
    assert second.version == 2
    assert second.settings.task_sync_enabled is False
