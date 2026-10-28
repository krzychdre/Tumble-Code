"""Projects: which project a folder is, task stamping, the context API, the page."""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from src.auth.jwt_issuer import issue_session_token
from src.models.organization import Membership, Organization
from src.models.project import Project, ProjectBinding
from src.models.task import Task
from src.realtime import sio as sio_module
from src.realtime.hub import registry
from src.realtime.sio import EVT_MESSAGE
from src.services.organizations import ROLE_ADMIN, ROLE_MEMBER
from src.services.projects import repository_key, resolve_project
from tests.web_helpers import (
    _backfill_files,
    _override_current_user,
    _override_web_user,
    _seed_user,
)

ORG = "org_acme"
ADMIN = "user_admin"
MEMBER = "user_member"
REPO = "https://github.com/QUB-IT/Roo-Code"


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


# --- the page -----------------------------------------------------------------


def _post(client, path, **form):
    return client.post(path, data=form, follow_redirects=False)


async def test_an_admin_names_and_scopes_an_organization_project(
    org, client, session_factory
):
    project = await _resolve(session_factory, MEMBER, ORG, "/u/m/roo", REPO)

    _override_web_user(client.app, MEMBER, email="user_member@example.com")
    page = client.get("/app/projects")
    assert "Roo-Code" in page.text and "Recall: Off" in page.text
    assert (
        _post(client, f"/app/projects/{project}", name="X", scope="members").status_code
        == 404
    )

    _override_web_user(client.app, ADMIN, email="user_admin@example.com")
    resp = _post(client, f"/app/projects/{project}", name=" Tumble ", scope="members")
    assert resp.headers["location"] == "/app/projects"
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
    assert resp.headers["location"] == f"/app/projects?error={code}"
    assert "All my projects" in client.get(resp.headers["location"]).text


async def test_merging_moves_folders_and_sessions(
    org, db_session, client, session_factory
):
    mine = await _resolve(session_factory, ADMIN, ORG, "/a/notes")
    theirs = await _resolve(session_factory, MEMBER, ORG, "/m/notes")
    personal = await _resolve(session_factory, ADMIN, None, "/a/notes")
    db_session.add(
        Task(id="t-m", user_id=MEMBER, organization_id=ORG, project_id=theirs)
    )
    await db_session.commit()

    _override_web_user(client.app, ADMIN)
    cross = _post(client, f"/app/projects/{theirs}/merge", into=personal)
    assert cross.headers["location"] == "/app/projects?error=bad_merge"

    assert _post(client, f"/app/projects/{theirs}/merge", into=mine).status_code == 303
    assert await _project(session_factory, theirs) is None
    assert await _task_project(session_factory, "t-m") == mine
    assert await _resolve(session_factory, MEMBER, ORG, "/m/notes") == mine


async def test_others_cannot_manage_a_personal_project(org, client, session_factory):
    project = await _resolve(session_factory, ADMIN, None, "/a/notes")
    _override_web_user(client.app, MEMBER)
    assert (
        _post(client, f"/app/projects/{project}", name="x", scope="owner").status_code
        == 404
    )
    assert "notes" not in client.get("/app/projects").text
