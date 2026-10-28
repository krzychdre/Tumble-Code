"""Cross-session recall on the SQLite test database: words, cards, the
visibility rule, the API around the search. The full-text search itself is
Postgres-only and lives in test_recall_pg.py."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from src.models.organization import Membership, Organization
from src.models.project import Project
from src.models.recall import RecallDirty, SessionCard
from src.models.task import Task
from src.services import recall_cards
from src.services.organizations import ROLE_ADMIN, ROLE_MEMBER
from src.services.projects import resolve_project, update_project
from src.services.recall_cards import card_sections, rebuild_due
from src.services.recall_search import snippets, visible
from src.services.recall_text import tsquery, words
from src.services.telemetry_service import upsert_task_message
from tests.web_helpers import _override_current_user, _override_web_user, _seed_user

ORG = "org_acme"
ME = "user_me"
COLLEAGUE = "user_col"


# --- words ---------------------------------------------------------------------


def test_words_split_identifiers_fold_diacritics_and_drop_stop_words():
    assert words("Naprawiłem resolveMaxInline w źródle task_access.py") == [
        "naprawilem",
        "resolvemaxinline",
        "resolve",
        "max",
        "inline",
        "zrodle",
        "task",
        "access",
        "py",
    ]


@pytest.mark.parametrize(
    "query, expected",
    [
        ("Jak naprawić bridge bridge", "naprawic & bridge"),
        ("resolveMax", "resolvemax"),
        ("the a w", ""),
    ],
)
def test_tsquery_requires_every_distinct_word(query, expected):
    assert tsquery(query) == expected


def test_snippets_cut_around_the_query_words():
    body = "x " * 400 + "the resolveMaxInline helper caps results" + " y" * 400
    [snippet] = snippets(body, ["inline"])
    assert "resolveMaxInline" in snippet and snippet.startswith("...")
    assert snippets("short body", ["absent"]) == ["short body"]


# --- the card --------------------------------------------------------------------


def test_a_card_keeps_the_last_result_in_full_and_redacts_secrets():
    sections = card_sections(
        "Fix login",
        "Use token sk-ant-api03-" + "a" * 40,
        ["early " * 200, "final " * 300 + " sk-ant-api03-" + "b" * 40],
        ["no, also the logout"],
        ["src/auth.py"],
    )
    assert "sk-ant-api03" not in sections.body
    assert (
        sections.results.count("early") < 100 and sections.results.count("final") == 300
    )
    assert sections.results.endswith("[REDACTED_SECRET]")
    assert sections.body.startswith("Fix login\n\nAsked:\nUse token [REDACTED_SECRET]")
    assert "no, also the logout" in sections.asked
    assert sections.body.endswith("Files:\nsrc/auth.py")


# --- building and queueing ----------------------------------------------------------


@pytest.fixture
async def org(db_session):
    for user_id in (ME, COLLEAGUE):
        await _seed_user(db_session, user_id, email=f"{user_id}@example.com")
    db_session.add(Organization(id=ORG, name="Acme"))
    db_session.add(Membership(user_id=ME, organization_id=ORG, role=ROLE_ADMIN))
    db_session.add(Membership(user_id=COLLEAGUE, organization_id=ORG, role=ROLE_MEMBER))
    await db_session.commit()


async def _project(s, user_id=ME, path="/w/roo", repo="https://github.com/a/roo"):
    return await resolve_project(s, user_id, ORG, path, repo)


def _say(ts, say, text):
    return {"ts": ts, "type": "say", "say": say, "text": text}


async def _run_task(s, task_id, user_id=ME, path="/w/roo"):
    """A finished task streamed through the bridge's write path."""
    for message in (
        _say(1, "text", "Fix the bridge org claim"),
        _say(2, "completion_result", "The bridge keeps the org claim now."),
    ):
        await upsert_task_message(
            s, task_id, user_id, ORG, message, workspace_path=path
        )


async def _age_queue(s):
    old = datetime.now(timezone.utc) - recall_cards.IDLE - timedelta(seconds=1)
    for row in (await s.execute(select(RecallDirty))).scalars():
        row.dirty_at = old
    await s.flush()


async def _cards(s):
    return {c.task_id: c for c in (await s.execute(select(SessionCard))).scalars()}


async def test_cards_follow_the_scope_and_the_exclusion(org, session_factory):
    async with session_factory() as s:
        project = await _project(s)
        await _run_task(s, "t1")
        await _age_queue(s)
        await rebuild_due(s)
        assert await _cards(s) == {}, "recall is off by default"

        await update_project(s, project, project.name, "members")
        assert await rebuild_due(s) == 1
        [card] = (await _cards(s)).values()
        assert (card.tenant_id, card.project_id, card.author_id, card.completed) == (
            ORG,
            project.id,
            ME,
            True,
        )
        assert "keeps the org claim" in card.body

        task = await s.get(Task, "t1")
        task.recall_excluded = True
        await recall_cards.rebuild_card(s, "t1")
        assert await _cards(s) == {}

        task.recall_excluded = False
        await recall_cards.rebuild_card(s, "t1")
        await update_project(s, project, project.name, "none")
        assert await _cards(s) == {}


async def test_one_card_failing_leaves_the_other_cards_built(
    org, session_factory, monkeypatch
):
    """The batch holds the tasks of every account: a card that fails rolls
    back alone and leaves the queue, so it cannot stop the others on every
    tick. A completion whose text is no string (a client sends any JSON)
    failed the whole batch; it now makes a card without a result."""
    async with session_factory() as s:
        project = await _project(s)
        await update_project(s, project, project.name, "members")
        await _run_task(s, "t1")
        await _run_task(s, "t-broken")
        for message in (_say(1, "text", "Odd"), _say(2, "completion_result", 12345)):
            await upsert_task_message(
                s, "t-odd", ME, ORG, message, workspace_path="/w/roo"
            )
        await _age_queue(s)
        build = recall_cards.rebuild_card

        async def failing(db, task_id):
            if task_id == "t-broken":
                raise RuntimeError("a failure no one foresaw")
            await build(db, task_id)

        monkeypatch.setattr(recall_cards, "rebuild_card", failing)

        assert await rebuild_due(s) == 3
        assert sorted(await _cards(s)) == ["t-odd", "t1"]
        assert (await s.execute(select(RecallDirty))).first() is None


async def test_only_the_writes_that_change_a_card_queue_it(org, session_factory):
    async with session_factory() as s:
        await _project(s)
        await upsert_task_message(s, "t1", ME, ORG, _say(1, "text", "Ask"), "/w/roo")
        assert (await s.execute(select(RecallDirty.task_id))).scalars().all() == ["t1"]
        await s.execute(RecallDirty.__table__.delete())

        await upsert_task_message(
            s, "t1", ME, ORG, _say(2, "text", "thinking"), "/w/roo"
        )
        assert (await s.execute(select(RecallDirty))).first() is None
        await upsert_task_message(
            s, "t1", ME, ORG, _say(3, "completion_result", "Done"), "/w/roo"
        )
        assert (await s.execute(select(RecallDirty.task_id))).scalars().all() == ["t1"]

        # A fresh mark waits until the task has been idle a while.
        assert await rebuild_due(s) == 0


async def test_a_bound_folder_claims_old_tasks_into_an_enabled_project(
    org, db_session, session_factory
):
    db_session.add(
        Task(id="old", user_id=ME, organization_id=ORG, workspace_path="/w/clone2")
    )
    await db_session.commit()
    async with session_factory() as s:
        project = await _project(s)
        await update_project(s, project, project.name, "owner")
        await s.execute(RecallDirty.__table__.delete())
        await _project(s, path="/w/clone2")
        assert (await s.execute(select(RecallDirty.task_id))).scalars().all() == ["old"]


# --- the visibility rule --------------------------------------------------------------

# Readers: me in project A. Cards: mine and a colleague's in A, mine in B, and
# one of another tenant (my personal space).
CARDS = {
    "mine-A": (ORG, "A", ME),
    "theirs-A": (ORG, "A", COLLEAGUE),
    "mine-B": (ORG, "B", ME),
    "personal": (ME, "P", ME),
}


@pytest.mark.parametrize(
    "scope_a, scope_b, wide, expected",
    [
        ("owner", "organization", True, {"mine-A"}),
        ("members", "organization", True, {"mine-A", "theirs-A"}),
        ("organization", "organization", True, {"mine-A", "theirs-A", "mine-B"}),
        ("organization", "organization", False, {"mine-A", "theirs-A"}),
        ("organization", "members", True, {"mine-A", "theirs-A"}),
    ],
)
async def test_visible_is_symmetric_and_never_crosses_tenants(
    org, db_session, session_factory, scope_a, scope_b, wide, expected
):
    projects = {
        "A": Project(
            id="A",
            tenant_id=ORG,
            organization_id=ORG,
            user_id=ME,
            key="a",
            name="A",
            recall_scope=scope_a,
        ),
        "B": Project(
            id="B",
            tenant_id=ORG,
            organization_id=ORG,
            user_id=ME,
            key="b",
            name="B",
            recall_scope=scope_b,
        ),
        "P": Project(
            id="P",
            tenant_id=ME,
            user_id=ME,
            key="p",
            name="P",
            recall_scope="organization",
        ),
    }
    db_session.add_all(projects.values())
    for task_id, (tenant, project_id, author) in CARDS.items():
        db_session.add(Task(id=task_id, user_id=author, project_id=project_id))
        await db_session.flush()
        db_session.add(
            SessionCard(
                task_id=task_id,
                tenant_id=tenant,
                project_id=project_id,
                author_id=author,
                title=task_id,
                body=task_id,
                search_vector=task_id,
                last_ts=0,
                completed=True,
                is_subtask=False,
                built_at=datetime.now(timezone.utc),
            )
        )
    await db_session.commit()

    async with session_factory() as s:
        reader = await s.get(Project, "A")
        found = await s.execute(
            select(SessionCard.task_id).where(visible(ME, reader, wide))
        )
        assert set(found.scalars()) == expected


# --- the API ------------------------------------------------------------------------


def _folder(path="/w/roo"):
    return {"workspacePath": path, "repositoryUrl": "https://github.com/a/roo"}


async def test_recall_off_answers_404_and_a_bad_query_400(org, client, session_factory):
    _override_current_user(client.app, ME, ORG)
    context = client.get("/api/recall/context", params=_folder()).json()
    assert context["scope"] == "none"
    assert (
        client.get(
            "/api/recall/search", params={**_folder(), "q": "bridge"}
        ).status_code
        == 404
    )
    assert client.get("/api/recall/sessions/t1", params=_folder()).status_code == 404

    async with session_factory() as s:
        project = await s.get(Project, context["projectId"])
        await update_project(s, project, project.name, "owner")
        await s.commit()
    for q in ("the a", "x" * 201):
        assert (
            client.get("/api/recall/search", params={**_folder(), "q": q}).status_code
            == 400
        )


async def test_reading_a_session_pages_the_conversation(
    org, client, session_factory, monkeypatch
):
    async with session_factory() as s:
        project = await _project(s)
        await update_project(s, project, project.name, "members")
        await _project(s, COLLEAGUE, "/c/roo")
        await _run_task(s, "t1", user_id=COLLEAGUE, path="/c/roo")
        await recall_cards.rebuild_card(s, "t1")
        await s.commit()

    _override_current_user(client.app, ME, ORG)
    summary = client.get("/api/recall/sessions/t1", params=_folder()).json()
    assert summary["part"] == "summary" and summary["author"] == "Test User"
    assert (
        summary["title"] == "Fix the bridge org claim" and summary["nextOffset"] is None
    )

    monkeypatch.setattr("src.services.recall_search.PAGE_CHARS", 20)
    page = client.get(
        "/api/recall/sessions/t1",
        params={**_folder(), "part": "conversation", "offset": 20},
    ).json()
    full = (
        "User: Fix the bridge org claim\n\nResult: The bridge keeps the org claim now."
    )
    assert page["text"] == full[20:40] and page["nextOffset"] == 40

    async with session_factory() as s:
        project = await s.get(Project, project.id)
        await update_project(s, project, project.name, "owner")
        await s.commit()
    assert client.get("/api/recall/sessions/t1", params=_folder()).status_code == 404


async def test_the_owner_keeps_a_task_out_of_recall(org, client, session_factory):
    async with session_factory() as s:
        project = await _project(s)
        await update_project(s, project, project.name, "owner")
        await _run_task(s, "t1")
        await recall_cards.rebuild_card(s, "t1")
        await s.commit()

    _override_web_user(client.app, COLLEAGUE)
    assert (
        client.post("/app/tasks/t1/recall", follow_redirects=False).status_code == 404
    )
    _override_web_user(client.app, ME)
    assert "Keep it out of recall" in client.get("/app/tasks/t1").text
    assert (
        client.post("/app/tasks/t1/recall", follow_redirects=False).status_code == 303
    )
    async with session_factory() as s:
        assert await _cards(s) == {}
        assert (await s.get(Task, "t1")).recall_excluded is True
