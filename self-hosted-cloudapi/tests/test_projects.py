"""Projects: which project a folder is, task stamping, the context API, the page."""

from datetime import datetime
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import event, select

from src.auth.jwt_issuer import issue_session_token
from src.models.llm_exchange import LlmExchange
from src.models.organization import Membership, Organization
from src.models.project import Project, ProjectBinding
from src.models.task import Task
from src.realtime import sio as sio_module
from src.realtime.hub import registry
from src.realtime.sio import EVT_MESSAGE
from src.routers.web_projects import ERROR_MESSAGES
from src.services.dataset_overview import dataset_overview
from src.services.organizations import ROLE_ADMIN, ROLE_MEMBER
from src.services.projects import (
    NAME_MAX,
    bind_recorded_folder,
    folder_key,
    name_candidates,
    repository_key,
    resolve_project,
)
from tests.web_helpers import (
    _backfill_files,
    _event_row,
    _override_current_user,
    _override_web_user,
    _seed_user,
)

ORG = "org_acme"
ADMIN = "user_admin"
MEMBER = "user_member"
REPO = "https://github.com/QUB-IT/Roo-Code"
OTHER_REPO = "https://github.com/QUB-IT/elsewhere"


@pytest.fixture(autouse=True)
def _clean_registry():
    registry.reset()
    yield
    registry.reset()


@pytest.fixture
async def org(db_session):
    for user_id in (ADMIN, MEMBER):
        await _seed_user(db_session, user_id, email=f"{user_id}@example.com")
    db_session.add(Organization(id=ORG, name="Acme"))
    db_session.add(Membership(user_id=ADMIN, organization_id=ORG, role=ROLE_ADMIN))
    db_session.add(Membership(user_id=MEMBER, organization_id=ORG, role=ROLE_MEMBER))
    await db_session.commit()


async def _resolve(session_factory, user_id, org_id, path, repo=""):
    async with session_factory() as s:
        project = await resolve_project(s, user_id, org_id, path, repo)
        await s.commit()
        return project.id


async def _project(session_factory, project_id):
    async with session_factory() as s:
        return await s.get(Project, project_id)


async def _task_project(session_factory, task_id):
    async with session_factory() as s:
        return await s.scalar(select(Task.project_id).where(Task.id == task_id))


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/QUB-IT/Roo-Code",
        "https://github.com/qub-it/roo-code.git",
        "https://x-token:secret@GitHub.com/QUB-IT/Roo-Code/",
    ],
)
def test_repository_key_drops_scheme_credentials_suffix_and_case(url):
    assert repository_key(url) == "github.com/qub-it/roo-code"


async def test_one_repository_is_one_project_per_tenant(org, session_factory):
    main = await _resolve(session_factory, ADMIN, ORG, "/home/a/Roo-Code", REPO)
    worktree = await _resolve(
        session_factory, ADMIN, ORG, "/tmp/wt-feature", REPO + ".git"
    )
    colleague = await _resolve(session_factory, MEMBER, ORG, "/Users/m/src/roo", REPO)
    personal = await _resolve(session_factory, ADMIN, None, "/home/a/Roo-Code", REPO)

    assert main == worktree == colleague
    assert personal != main
    project = await _project(session_factory, main)
    assert (project.name, project.tenant_id, project.recall_scope) == (
        "Roo-Code",
        ORG,
        "none",
    )
    assert (await _project(session_factory, personal)).tenant_id == ADMIN


async def test_a_folder_without_git_is_its_users_own_project(org, session_factory):
    mine = await _resolve(session_factory, ADMIN, ORG, "/srv/shared/notes")
    theirs = await _resolve(session_factory, MEMBER, ORG, "/srv/shared/notes")
    again = await _resolve(session_factory, ADMIN, ORG, "/srv/shared/notes")

    assert mine == again != theirs
    assert (await _project(session_factory, mine)).name == "notes"


async def _names(session_factory):
    async with session_factory() as s:
        rows = await s.execute(
            select(Project.tenant_id, Project.name, Project.wanted_name).order_by(
                Project.tenant_id, Project.name
            )
        )
        return [tuple(row) for row in rows]


async def test_a_taken_default_name_is_qualified_then_numbered(
    org, session_factory, caplog
):
    """By the folder's user, or the repository's owner; case-insensitively;
    only within the tenant."""
    await _resolve(session_factory, ADMIN, ORG, "/a/notes")
    await _resolve(session_factory, MEMBER, ORG, "/m/notes")
    await _resolve(session_factory, MEMBER, ORG, "/m/old/notes")
    await _resolve(session_factory, ADMIN, ORG, "/a/roo", REPO)
    await _resolve(
        session_factory, ADMIN, ORG, "/a/fork", "https://gitlab.com/me/roo-code.git"
    )
    await _resolve(session_factory, MEMBER, None, "/m/notes")

    assert await _names(session_factory) == [
        (ORG, "Roo-Code", None),
        (ORG, "notes", None),
        (ORG, "notes (user_member)", "notes"),
        (ORG, "notes (user_member, 2)", "notes"),
        (ORG, "roo-code (me)", "roo-code"),
        (MEMBER, "notes", None),
    ]
    assert (
        "[projects] tenant org_acme already has a project named 'notes': the new "
        f"project {folder_key(MEMBER, '/m/old/notes')} is named 'notes (user_member, 2)'"
    ) in caplog.text


def test_a_qualified_name_is_cut_to_fit():
    candidates = name_candidates("x" * NAME_MAX, "alice")
    assert [next(candidates)[-12:] for _ in range(3)] == [
        "x" * 12,
        "xxxx (alice)",
        "x (alice, 2)",
    ]
    assert len(next(candidates)) == NAME_MAX


async def test_a_name_taken_meanwhile_retries_with_the_next(
    org, test_engine, session_factory
):
    """Another sign-in names a project "notes" after the look-up found the
    name free: the insert does nothing and the next free name is taken."""
    await _resolve(session_factory, ADMIN, ORG, "/a/x")
    raced = []

    def other_sign_in(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO projects") and not raced:
            raced.append(statement)
            cursor.execute(
                "INSERT INTO projects (id, tenant_id, organization_id, user_id, key, name) "
                f"VALUES ('prj_other', '{ORG}', '{ORG}', '{ADMIN}', 'folder:other', 'notes')"
            )

    event.listen(test_engine.sync_engine, "before_cursor_execute", other_sign_in)
    try:
        project = await _resolve(session_factory, MEMBER, ORG, "/m/notes")
    finally:
        event.remove(test_engine.sync_engine, "before_cursor_execute", other_sign_in)

    assert raced
    saved = await _project(session_factory, project)
    assert (saved.name, saved.wanted_name) == ("notes (user_member)", "notes")


async def test_the_binding_decides_once_a_folder_is_known(org, session_factory):
    first = await _resolve(session_factory, ADMIN, ORG, "/home/a/x")
    later = await _resolve(session_factory, ADMIN, ORG, "/home/a/x", REPO)
    assert later == first
    async with session_factory() as s:
        assert (await s.execute(select(Project.id))).scalars().all() == [first]


async def test_binding_a_folder_claims_its_earlier_tasks_in_the_tenant(
    org, db_session, session_factory
):
    path = "/home/a/Roo-Code"
    db_session.add_all(
        [
            Task(id="t-org", user_id=ADMIN, organization_id=ORG, workspace_path=path),
            Task(id="t-personal", user_id=ADMIN, workspace_path=path),
            Task(
                id="t-other-folder",
                user_id=ADMIN,
                organization_id=ORG,
                workspace_path="/x",
            ),
            Task(
                id="t-colleague",
                user_id=MEMBER,
                organization_id=ORG,
                workspace_path=path,
            ),
        ]
    )
    await db_session.commit()

    project = await _resolve(session_factory, ADMIN, ORG, path, REPO)

    assert await _task_project(session_factory, "t-org") == project
    for task_id in ("t-personal", "t-other-folder", "t-colleague"):
        assert await _task_project(session_factory, task_id) is None


@pytest.fixture
def bridge(monkeypatch, session_factory):
    monkeypatch.setattr(sio_module, "async_session_factory", session_factory)
    monkeypatch.setattr(sio_module.sio, "emit", AsyncMock())


async def test_a_registered_window_binds_its_folder_and_new_tasks_join_it(
    bridge, org, session_factory, client
):
    path = "/home/a/Roo-Code"
    token = issue_session_token(ADMIN, ORG, expires_in=300)
    await sio_module.connect("ext", {}, {"token": token})
    await sio_module.on_extension_register(
        "ext", {"workspacePath": path, "repositoryUrl": REPO}
    )
    async with session_factory() as s:
        binding = await s.scalar(select(ProjectBinding))
    assert (binding.user_id, binding.tenant_id, binding.workspace_path) == (
        ADMIN,
        ORG,
        path,
    )

    message = {"ts": 1, "type": "say", "say": "text", "text": "hi"}
    await sio_module.on_task_event(
        "ext", {"taskId": "t-live", "type": EVT_MESSAGE, "message": message}
    )
    _override_current_user(client.app, ADMIN, ORG)
    files, data = _backfill_files("t-uploaded", [message])
    data["workspacePath"] = path
    assert (
        client.post("/api/events/backfill", files=files, data=data).status_code == 200
    )

    assert await _task_project(session_factory, "t-live") == binding.project_id
    assert await _task_project(session_factory, "t-uploaded") == binding.project_id


async def test_context_resolves_the_folder_in_the_tokens_tenant(
    org, client, session_factory
):
    _override_current_user(client.app, MEMBER, ORG)
    resp = client.get(
        "/api/recall/context",
        params={"workspacePath": "/Users/m/roo", "repositoryUrl": REPO},
    )
    assert resp.status_code == 200
    body = resp.json()
    project = await _project(session_factory, body["projectId"])
    assert body == {"projectId": project.id, "projectName": "Roo-Code", "scope": "none"}
    assert project.tenant_id == ORG

    assert client.get("/api/recall/context").status_code == 422


# --- folders that only recordings report ------------------------------------


async def _bind_recorded(session_factory, org_id, path, task_id, parent=None):
    async with session_factory() as s:
        await bind_recorded_folder(s, ADMIN, org_id, path, task_id, parent)
        await s.commit()
        return await s.scalar(
            select(Project)
            .join(ProjectBinding, ProjectBinding.project_id == Project.id)
            .where(ProjectBinding.workspace_path == path)
        )


def _exchange_row(task_id, path):
    return LlmExchange(
        id=f"ex-{task_id}",
        user_id=ADMIN,
        organization_id=ORG,
        task_id=task_id,
        occurred_at=datetime(2026, 10, 1),
        workspace_path=path,
        status="completed",
        payload="{}",
    )


def _event(user_id, task_id, created_at, **properties):
    return _event_row(
        "Task Message", {"taskId": task_id, **properties}, user_id, created_at
    )


async def test_a_recorded_folder_takes_the_remote_the_tasks_telemetry_named_last(
    org, db_session, session_factory
):
    path = "/home/a/.roo/worktrees/Roo-Code-1"
    db_session.add_all(
        [
            Task(id="t1", user_id=ADMIN, organization_id=ORG, workspace_path=path),
            _event(ADMIN, "t1", datetime(2026, 10, 1), repositoryUrl=OTHER_REPO),
            _event(ADMIN, "t1", datetime(2026, 10, 2), repositoryUrl=REPO),
            _event(MEMBER, "t1", datetime(2026, 10, 4), repositoryUrl=OTHER_REPO),
        ]
    )
    await db_session.commit()

    project = await _bind_recorded(session_factory, ORG, path, "t1")

    assert (project.key, project.tenant_id) == ("github.com/qub-it/roo-code", ORG)
    assert await _task_project(session_factory, "t1") == project.id


@pytest.mark.parametrize("child_org", [ORG, None], ids=["same-tenant", "other"])
async def test_a_worktree_without_a_remote_joins_its_parents_project_in_its_tenant(
    org, db_session, session_factory, child_org
):
    parent_path = "/home/a/Roo-Code"
    parent_project = await _resolve(session_factory, ADMIN, ORG, parent_path, REPO)
    # The same folder in the personal space is another project.
    await _resolve(session_factory, ADMIN, None, parent_path, OTHER_REPO)
    db_session.add(_exchange_row("parent", parent_path))
    await db_session.commit()

    project = await _bind_recorded(
        session_factory, child_org, "/home/a/.roo/worktrees/x-1", "child", "parent"
    )

    if child_org == ORG:
        assert project.id == parent_project
    else:
        assert project.key.startswith("folder:")


async def test_the_dataset_overview_counts_an_exchange_in_its_users_project(
    org, db_session, session_factory
):
    """Colleagues can have the same path: the exchange is the project of its
    own user's folder, in its own tenant."""
    path = "/srv/checkout"
    mine = await _resolve(session_factory, ADMIN, ORG, path, REPO)
    await _resolve(session_factory, MEMBER, ORG, path, OTHER_REPO)
    await _resolve(session_factory, ADMIN, None, path, OTHER_REPO)
    db_session.add(_exchange_row("t1", path))
    await db_session.commit()

    async with session_factory() as s:
        overview = await dataset_overview(s, ADMIN, "all")

    assert [(p["id"], p["exchanges"]) for p in overview["projects"]] == [(mine, 1)]


async def test_a_folder_bound_already_stays_as_it_is(org, db_session, session_factory):
    first = await _resolve(session_factory, ADMIN, ORG, "/home/a/x")
    db_session.add(_event(ADMIN, "t1", datetime(2026, 10, 1), repositoryUrl=REPO))
    await db_session.commit()

    assert (await _bind_recorded(session_factory, ORG, "/home/a/x", "t1")).id == first
    async with session_factory() as s:
        assert (await s.execute(select(Project.id))).scalars().all() == [first]


# --- the pages ----------------------------------------------------------------

OUTSIDER = "user_outsider"


def _post(client, path, **form):
    return client.post(path, data=form, follow_redirects=False)


def _listed(page) -> list[str]:
    """The project names in the list's rows, in order."""
    return [
        chunk.split('">', 1)[1].split("</a>", 1)[0]
        for chunk in page.text.split('<a href="/app/projects/')[1:]
    ]


def _add_project(db_session, name, key, owner=ADMIN, org_id=None, scope="none"):
    project = Project(
        tenant_id=org_id or owner,
        organization_id=org_id,
        user_id=owner,
        key=key,
        name=name,
        recall_scope=scope,
    )
    db_session.add(project)
    return project


@pytest.fixture
async def spread(org, db_session):
    """The admin's projects in both spaces, and a colleague's personal one."""
    _add_project(db_session, "Alpha", "folder:a1")
    _add_project(db_session, "Website", "github.com/acme/www", scope="owner")
    _add_project(
        db_session, "Backend", "github.com/acme/api", org_id=ORG, scope="members"
    )
    _add_project(db_session, "notes", "folder:n1", owner=MEMBER, org_id=ORG)
    _add_project(db_session, "Alphabet", "folder:m1", owner=MEMBER)
    await db_session.commit()


@pytest.mark.parametrize(
    "query, names",
    [
        ("", ["Alpha", "Backend", "notes", "Website"]),
        ("q=ALP", ["Alpha"]),
        ("q=acme/api", ["Backend"]),
        ("space=personal", ["Alpha", "Website"]),
        (f"space={ORG}", ["Backend", "notes"]),
        ("space=org_elsewhere", []),
        ("recall=off", ["Alpha", "notes"]),
        ("recall=on&q=web", ["Website"]),
    ],
)
async def test_the_list_filters_by_text_space_and_recall(spread, client, query, names):
    _override_web_user(client.app, ADMIN)
    page = client.get(f"/app/projects?{query}")
    assert _listed(page) == names
    assert ('<th scope="col">Space</th>' in page.text) == bool(names)
    assert ("No projects match these filters." in page.text) == (not names)


async def test_the_list_pages_by_25_and_keeps_its_filters(db_session, client):
    await _seed_user(db_session, ADMIN)
    for n in range(30):
        _add_project(db_session, f"p{n:02}", f"folder:{n}")
    _add_project(db_session, "other", "folder:x")
    await db_session.commit()
    _override_web_user(client.app, ADMIN)

    first = client.get("/app/projects?q=p")
    assert _listed(first) == [f"p{n:02}" for n in range(25)]
    assert 'href="/app/projects?q=p&amp;page=2"' in first.text
    assert '<th scope="col">Space</th>' not in first.text
    second = client.get("/app/projects?q=p&page=2")
    assert _listed(second) == [f"p{n:02}" for n in range(25, 30)]
    assert _listed(client.get("/app/projects?q=p&page=9")) == _listed(second)


async def test_a_member_views_and_an_admin_manages_an_organization_project(
    org, client, session_factory
):
    project = await _resolve(session_factory, MEMBER, ORG, "/u/m/roo", REPO)

    _override_web_user(client.app, MEMBER, email="user_member@example.com")
    assert _listed(client.get("/app/projects")) == ["Roo-Code"]
    page = client.get(f"/app/projects/{project}")
    assert "Recall: Off" in page.text and 'name="scope"' not in page.text
    assert "/u/m/roo</code> · user_member@example.com" in page.text
    assert (
        _post(client, f"/app/projects/{project}", name="X", scope="members").status_code
        == 404
    )

    _override_web_user(client.app, ADMIN, email="user_admin@example.com")
    assert 'name="scope"' in client.get(f"/app/projects/{project}").text
    resp = _post(client, f"/app/projects/{project}", name=" Tumble ", scope="members")
    assert resp.headers["location"] == f"/app/projects/{project}"
    saved = await _project(session_factory, project)
    assert (saved.name, saved.recall_scope) == ("Tumble", "members")


@pytest.mark.parametrize(
    "form, code",
    [
        ({"name": "x", "scope": "members"}, "bad_scope"),
        ({"name": " ", "scope": "owner"}, "bad_name"),
    ],
)
async def test_a_personal_project_refuses_what_it_does_not_offer(
    db_session, client, session_factory, form, code
):
    await _seed_user(db_session, ADMIN)
    project = await _resolve(session_factory, ADMIN, None, "/home/a/notes")
    _override_web_user(client.app, ADMIN)
    resp = _post(client, f"/app/projects/{project}", **form)
    assert resp.headers["location"] == f"/app/projects/{project}?error={code}"
    page = client.get(resp.headers["location"])
    assert ERROR_MESSAGES[code] in page.text and "All my projects" in page.text


@pytest.fixture
async def notes(org, db_session, session_factory):
    """Two folders named notes in the organization, one in the admin's
    personal space renamed to private; the colleague's has a session."""
    mine = await _resolve(session_factory, ADMIN, ORG, "/a/notes")
    theirs = await _resolve(session_factory, MEMBER, ORG, "/m/notes")
    personal = await _resolve(session_factory, ADMIN, None, "/a/notes")
    (await db_session.get(Project, personal)).name = "private"
    db_session.add(
        Task(id="t-m", user_id=MEMBER, organization_id=ORG, project_id=theirs)
    )
    await db_session.commit()
    return mine, theirs


async def test_merging_by_name_moves_folders_and_sessions(
    notes, client, session_factory
):
    mine, theirs = notes
    _override_web_user(client.app, ADMIN)
    page = client.get(f"/app/projects/{theirs}")
    assert '<option value="notes">' in page.text and "private" not in page.text

    resp = _post(client, f"/app/projects/{theirs}/merge", into=" NOTES ")
    assert resp.headers["location"] == f"/app/projects/{mine}"
    assert await _project(session_factory, theirs) is None
    assert await _task_project(session_factory, "t-m") == mine
    assert await _resolve(session_factory, MEMBER, ORG, "/m/notes") == mine


@pytest.mark.parametrize(
    "into",
    ["private", "nothing", "Notes (user_member)"],
    ids=["other-space", "unknown", "itself"],
)
async def test_a_merge_target_is_another_project_of_the_same_space(
    notes, client, session_factory, into
):
    mine, theirs = notes
    _override_web_user(client.app, ADMIN)
    resp = _post(client, f"/app/projects/{theirs}/merge", into=into)
    assert resp.headers["location"] == f"/app/projects/{theirs}?error=bad_merge"
    assert await _project(session_factory, theirs) is not None


async def test_a_renamed_project_says_so_until_a_name_is_saved(
    notes, client, session_factory
):
    mine, theirs = notes
    note = "Renamed automatically because another project of this space was already called notes."
    _override_web_user(client.app, MEMBER)
    page = client.get(f"/app/projects/{theirs}").text
    assert note in page and "Rename it if you like" not in page
    assert "1 project was renamed automatically" in client.get("/app/projects").text

    _override_web_user(client.app, ADMIN)
    assert "Rename it if you like" in client.get(f"/app/projects/{theirs}").text
    renamed = client.get("/app/projects?renamed=1&q=notes")
    assert _listed(renamed) == ["notes (user_member)"]
    assert '<input type="hidden" name="renamed" value="1">' in renamed.text

    for name, location in [
        (" NOTES ", f"/app/projects/{theirs}?error=name_taken"),
        ("PRIVATE", f"/app/projects/{theirs}"),
    ]:
        resp = _post(client, f"/app/projects/{theirs}", name=name, scope="none")
        assert resp.headers["location"] == location
    assert (
        ERROR_MESSAGES["name_taken"]
        in client.get(f"/app/projects/{theirs}?error=name_taken").text
    )
    assert note not in client.get(f"/app/projects/{theirs}").text
    assert "renamed automatically" not in client.get("/app/projects").text
    # Its own name in other letters is no conflict.
    resp = _post(client, f"/app/projects/{mine}", name="Notes", scope="none")
    assert resp.headers["location"] == f"/app/projects/{mine}"
    assert (await _project(session_factory, mine)).name == "Notes"


@pytest.mark.parametrize(
    "owner, org_id, reader",
    [(ADMIN, None, MEMBER), (MEMBER, ORG, OUTSIDER)],
    ids=["someone-elses-personal", "organization-of-others"],
)
async def test_a_foreign_project_is_not_listed_and_answers_404(
    org, db_session, client, session_factory, owner, org_id, reader
):
    await _seed_user(db_session, OUTSIDER)
    project = await _resolve(session_factory, owner, org_id, "/x/secret")
    _override_web_user(client.app, reader)
    assert "secret" not in client.get("/app/projects").text
    assert client.get(f"/app/projects/{project}").status_code == 404
    assert (
        _post(client, f"/app/projects/{project}", name="x", scope="owner").status_code
        == 404
    )
    assert _post(client, f"/app/projects/{project}/merge", into="x").status_code == 404
