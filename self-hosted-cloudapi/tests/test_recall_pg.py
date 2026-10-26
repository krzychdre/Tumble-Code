"""Recall search on a real Postgres: the full-text match, ranking, the index,
the statement timeout. What can break here is Postgres behaviour, so nothing
is faked. Runs when RECALL_PG_URL names an empty database the tests may own
(the CI job's service container, or a local throwaway one):

    docker run -d --rm -p 127.0.0.1:55433:5432 -e POSTGRES_PASSWORD=test \\
        -e POSTGRES_DB=recall --tmpfs /var/lib/postgresql/data postgres:16-alpine
    RECALL_PG_URL=postgresql+asyncpg://postgres:test@127.0.0.1:55433/recall \\
        uv run pytest tests/test_recall_pg.py
"""

import json
import os
import time

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from src.database import Base, get_db
from src.models.organization import Membership, Organization
from src.models.recall import RecallLog
from src.models.user import User
from src.services import recall_search
from src.services.organizations import ROLE_ADMIN
from src.services.projects import resolve_project, update_project
from src.services.recall_cards import rebuild_card
from src.services.telemetry_service import upsert_task_message
from tests.web_helpers import _override_current_user

PG_URL = os.environ.get("RECALL_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="RECALL_PG_URL is not set")

ORG = "org_acme"
ME = "user_me"
FOLDER = {"workspacePath": "/w/roo", "repositoryUrl": "https://github.com/a/roo"}


@pytest.fixture
async def pg_factory():
    # No pool: the test client runs the app on its own event loop, and an
    # asyncpg connection belongs to the loop that opened it.
    engine = create_async_engine(PG_URL, poolclass=NullPool)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as s:
        s.add(
            User(id=ME, authentik_id="ak_me", email="me@example.com", first_name="Me")
        )
        s.add(Organization(id=ORG, name="Acme"))
        await s.flush()
        s.add(Membership(user_id=ME, organization_id=ORG, role=ROLE_ADMIN))
        await s.commit()
    yield factory
    await engine.dispose()


@pytest.fixture
def pg_client(pg_factory):
    from fastapi.testclient import TestClient
    from src.main import app

    async def override_get_db():
        async with pg_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    saved = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = override_get_db
    _override_current_user(app, ME, ORG)
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(saved)


def _say(ts, say, body):
    return {"ts": ts, "type": "say", "say": say, "text": body}


# Real timestamps: the ranking decays with age, and a card from 1970 scores 0.
NOW_MS = int(time.time() * 1000)


async def _session(
    factory, task_id, prompt, result, path="/w/roo", touched=None, at=NOW_MS
):
    tool = {"tool": "readFile", "path": touched} if touched else None
    async with factory() as s:
        for message in (
            _say(at, "text", prompt),
            *([_say(at + 1, "tool", json.dumps(tool))] if tool else []),
            _say(at + 2, "completion_result", result),
        ):
            await upsert_task_message(s, task_id, ME, ORG, message, workspace_path=path)
        await rebuild_card(s, task_id)
        await s.commit()


async def _enable(
    factory, path="/w/roo", repo=FOLDER["repositoryUrl"], scope="members"
):
    async with factory() as s:
        project = await resolve_project(s, ME, ORG, path, repo)
        await update_project(s, project, project.name, scope)
        await s.commit()


def _search(client, q, **params):
    resp = client.get("/api/recall/search", params={**FOLDER, "q": q, **params})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_search_matches_every_word_ranks_the_title_first_and_logs(
    pg_factory, pg_client
):
    await _enable(pg_factory)
    three_years_ago = NOW_MS - 3 * 365 * 24 * 3600 * 1000
    await _session(pg_factory, "t-title", "Bridge org claim", "Fixed it.")
    # Each match twice in the results: still below a title match, and above a
    # title match if the title weighed what the files do.
    await _session(
        pg_factory,
        "t-body",
        "Something else",
        "The bridge keeps the org claim and the bridge claim stays.",
    )
    await _session(
        pg_factory, "t-files", "Unrelated", "Done.", touched="src/bridge/claim.ts"
    )
    # The strongest text, but old: the age decay puts it last.
    await _session(
        pg_factory,
        "t-old",
        "Bridge claim",
        "bridge claim bridge claim",
        at=three_years_ago,
    )
    await _session(pg_factory, "t-other", "Bridge reconnects", "Done.")

    # Ranked by weight (title, then results, then files) and by age.
    body = _search(pg_client, "bridge claim", limit=10)
    assert [r["sessionId"] for r in body["results"]] == [
        "t-title",
        "t-body",
        "t-files",
        "t-old",
    ]
    first = body["results"][0]
    assert (
        first["projectName"] == "roo" and first["author"] == "Me" and first["completed"]
    )
    assert any("claim" in snippet for snippet in body["results"][1]["snippets"])
    assert body["tooBroad"] is False

    # Whole words only: no prefix match.
    assert [r["sessionId"] for r in _search(pg_client, "reconnects")["results"]] == [
        "t-other"
    ]
    assert _search(pg_client, "reconn")["results"] == []
    assert (
        _search(pg_client, "bridge", excludeTaskId="t-title", limit=1)["results"][0][
            "sessionId"
        ]
        != "t-title"
    )

    async with pg_factory() as s:
        logged = (await s.execute(select(RecallLog.kind, RecallLog.hits))).all()
    assert ("search", 4) in logged


async def test_other_projects_answer_only_between_organization_scopes(
    pg_factory, pg_client
):
    other = {"workspacePath": "/w/docs", "repositoryUrl": "https://github.com/a/docs"}
    await _enable(pg_factory, scope="organization")
    await _enable(
        pg_factory, other["workspacePath"], other["repositoryUrl"], "organization"
    )
    await _session(
        pg_factory, "t-docs", "Deploy guide", "Wrote the deploy guide.", "/w/docs"
    )

    assert [r["projectName"] for r in _search(pg_client, "deploy")["results"]] == [
        "docs"
    ]
    assert _search(pg_client, "deploy", scope="this_project")["results"] == []

    await _enable(pg_factory, other["workspacePath"], other["repositoryUrl"], "members")
    assert _search(pg_client, "deploy")["results"] == []


async def test_create_all_builds_the_gin_index_over_project_and_words(
    pg_factory,
):
    async with pg_factory() as s:
        definition = await s.scalar(
            text(
                "SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_session_cards_search'"
            )
        )
    assert "USING gin (project_id, search_vector)" in definition


async def test_a_search_over_the_timeout_answers_too_broad(
    pg_factory, pg_client, monkeypatch
):
    await _enable(pg_factory)
    await _session(pg_factory, "t-seed", "Bridge", "Bridge.")
    async with pg_factory() as s:
        # Many matching cards, inserted directly: what is under test is the
        # timeout, not the card builder.
        await s.execute(
            text(
                "INSERT INTO tasks (id, user_id, client_kind, message_count, tokens_in, "
                "tokens_out, cache_reads, cache_writes, cost, q_requests, q_errors, q_retries, "
                "q_interventions, q_completion_replies, q_condense, q_tools, q_tool_paths, "
                "q_distinct_tool_paths, q_completed, recall_excluded, created_at, updated_at) "
                "SELECT 'bulk' || n, :me, 'vscode', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "
                "false, false, now(), now() FROM generate_series(1, 60000) n"
            ),
            {"me": ME},
        )
        await s.execute(
            text(
                "INSERT INTO session_cards SELECT 'bulk' || n, c.tenant_id, c.project_id, "
                "c.author_id, c.title, c.body, c.search_vector, c.last_ts, c.completed, now() "
                "FROM session_cards c, generate_series(1, 60000) n"
            )
        )
        await s.commit()
    monkeypatch.setattr(recall_search, "STATEMENT_TIMEOUT_MS", 1)

    assert _search(pg_client, "bridge") == {"results": [], "tooBroad": True}
