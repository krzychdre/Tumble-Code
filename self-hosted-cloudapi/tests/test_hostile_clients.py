"""What one hostile account sends cannot break another account's pages.

Any account that can sign in controls its Tumble client: its own
OpenAI-compatible server reports any usage, custom model info sets any price,
a custom mode any name, and a hand-made request any value at all, task ids
included. Here a member of an organization sends such values through the
real ingest routes; then the pages of the organization's admin and of an
unrelated account must render with figures bounded by what one request can
report, and the member's own pages must render too. Runs on SQLite and, with
RECALL_PG_URL, on Postgres, where most of these values used to fail.
"""

import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from src.auth.web_session import get_web_user_optional
from src.database import Base, get_db
from src.dependencies import get_current_user
from src.main import app
from src.models.organization import Membership, Organization
from src.models.task import Task
from src.services.metrics_service import compute_user_metrics
from src.utils.clientzone import as_utc
from src.web.presenters.charts import BREAKDOWN_ROWS
from tests.conftest import PG_URL
from tests.web_helpers import (
    _backfill_files,
    _override_current_user,
    _override_web_user,
    _seed_user,
)

ORG = "org_acme"
ADMIN = "user_admin"
MEMBER = "user_member"
VICTIM = "user_victim"
THEN = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)
# More distinct model names than a breakdown table shows.
MANY = BREAKDOWN_ROWS + 10


@pytest.fixture(params=["sqlite", "postgres"])
async def factory(request, session_factory):
    if request.param == "sqlite":
        yield session_factory
        return
    if not PG_URL:
        pytest.skip("RECALL_PG_URL is not set")
    engine = create_async_engine(PG_URL, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def http(factory):
    async def override_get_db():
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    saved = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = override_get_db
    async with factory() as db:
        for user in (ADMIN, MEMBER, VICTIM):
            await _seed_user(db, user, email=f"{user}@example.com")
        db.add(Organization(id=ORG, name="Acme"))
        db.add(Membership(user_id=ADMIN, organization_id=ORG, role="org:admin"))
        db.add(Membership(user_id=MEMBER, organization_id=ORG, role="org:member"))
        db.add(Task(id="t-victim", user_id=VICTIM, updated_at=THEN))
        await db.commit()
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved)


def _as(user: str, org: str | None = None) -> None:
    _override_current_user(app, user, org)
    _override_web_user(app, user, f"{user}@example.com")


def _event(event_type: str, **properties) -> None:
    # json.dumps escapes a lone surrogate, as a client's JSON.stringify does.
    body = json.dumps({"type": event_type, "properties": properties})
    resp = TestClient(app).post(
        "/api/events", content=body, headers={"Content-Type": "application/json"}
    )
    assert resp.status_code == 200, resp.text


def _completion(task_id: str, **figures) -> None:
    _event("LLM Completion", taskId=task_id, apiProvider="openai", **figures)


def _request(ts, **figures) -> dict:
    return {
        "ts": ts,
        "type": "say",
        "say": "api_req_started",
        "text": json.dumps(figures),
    }


def _backfill(task_id: str, messages: list) -> None:
    files, data = _backfill_files(task_id, messages)
    resp = TestClient(app).post("/api/events/backfill", files=files, data=data)
    assert resp.status_code == 200, resp.text


def _attack() -> None:
    """Everything the member sends, as the member, in the organization."""
    _as(MEMBER, ORG)
    huge = 9 * 10**18
    _backfill(
        "t-evil",
        [
            {"ts": 1, "type": "say", "say": "text", "text": "Plan"},
            _request(2, tokensIn=huge, tokensOut=huge, cost=1e300, durationMs=huge),
            _request(3, tokensIn=-(10**12), cost=-1000.0),
            {"ts": huge, "type": "say", "say": "completion_result", "text": "a\u0000b"},
            {"ts": 5, "type": "say", "say": "text", "text": 12345},
            {"ts": 6.5, "type": "say", "say": "text", "text": "late"},
        ],
    )
    _backfill("t-evil-sub", [_request(1, tokensIn=huge, cost=1.5e308)])
    _event("Task Created", taskId="t-evil-sub", parentTaskId="t-evil")
    for figures in (
        {"inputTokens": 5 * 10**18, "outputTokens": 5 * 10**18},
        {"inputTokens": 5 * 10**18},
        {"cost": 1.5e308},
        {"cost": 1.5e308},
        {"cost": -1000.0, "inputTokens": -(10**12)},
        {"durationMs": huge},
    ):
        _completion("t-evil", modelId="glm", mode="code", **figures)
    for odd in ("evil\u0000model", "\ud800zai", 12345, {"a": 1}, "x" * 3000):
        _completion("t-evil", modelId=odd, mode=odd, completionKind=odd)
    for n in range(MANY):
        _completion("t-evil", modelId=f"model-{n:03}", inputTokens=10, cost=0.01)
    # Another account's task, named by id: a completion and a parent link.
    _completion("t-victim", modelId="evil", inputTokens=1)
    _event("Task Created", taskId="t-victim", parentTaskId="t-evil")
    _event("Task Created", taskId="t-evil", parentTaskId="t-victim")


def _get(path: str, user: str, **params):
    _as(user)
    resp = TestClient(app).get(path, params=params)
    app.dependency_overrides.pop(get_web_user_optional, None)
    app.dependency_overrides.pop(get_current_user, None)
    return resp


async def test_another_accounts_and_the_admins_pages_survive_a_hostile_member(
    http, factory
):
    _as(ADMIN, ORG)
    _backfill("t-admin", [_request(1, tokensIn=1000, tokensOut=0, cost=0.5)])
    _completion("t-admin", modelId="opus", inputTokens=1000, cost=0.5)

    _attack()

    for group in ("project", "model", "user", "none"):
        page = _get("/app/metrics", ADMIN, space=ORG, period="all", group=group)
        assert page.status_code == 200, (group, page.text[:300])
    async with factory() as db:
        m = await compute_user_metrics(db, ADMIN, "all", organization_id=ORG)
    # The admin's request, the member's named ones; nothing else counts.
    assert m["totals"]["input"] == 1000 + 10 * MANY
    assert m["totals"]["output"] == 0
    assert m["totals"]["cost"] == pytest.approx(0.5 + 0.01 * MANY)
    assert m["duration_ms"] == 0
    assert all(len(row["name"].encode()) <= 256 for row in m["by_model"])
    # The breakdown tables show the biggest names and fold the rest.
    page = _get("/app/metrics", ADMIN, space=ORG, period="all", group="none").text
    assert f"{len(m['by_model']) - BREAKDOWN_ROWS} others" in page

    assert _get("/app", ADMIN).status_code == 200
    victim_list = _get("/app", VICTIM)
    assert victim_list.status_code == 200 and "t-victim" in victim_list.text
    async with factory() as db:
        victim = await db.get(Task, "t-victim")
        evil = await db.get(Task, "t-evil")
    assert (victim.parent_task_id, victim.models) == (None, None)
    assert as_utc(victim.updated_at) == THEN
    assert evil.parent_task_id is None


async def test_the_hostile_members_own_pages_render(http, factory):
    _attack()

    for path, params in (
        ("/app", {}),
        ("/app", {"group": "none"}),
        ("/app", {"group": "model"}),
        ("/app/tasks/t-evil", {}),
        ("/app/metrics", {"period": "all"}),
        ("/app/metrics", {"period": "all", "space": ORG}),
        ("/app/diagnostics", {"period": "all"}),
    ):
        resp = _get(path, MEMBER, **params)
        assert resp.status_code == 200, (path, params, resp.text[:300])
    async with factory() as db:
        own = (
            await db.execute(
                select(Task.cost, Task.tokens_in, Task.run_cost, Task.last_ts).where(
                    Task.id == "t-evil"
                )
            )
        ).one()
    assert own == (0.0, 0, 0.0, 5)
