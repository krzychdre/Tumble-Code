"""Organizations come from Authentik groups: the sync, its triggers, the pages.

Only the network is replaced: conftest's ``authentik_groups`` stands in for
the groups Authentik answers with, and the request and failure tests swap
httpx's transport so our own ``fetch_groups`` runs for real.
"""

import httpx
import pytest
from sqlalchemy import select
from unittest.mock import AsyncMock, patch

import src.auth.authentik as authentik
from config.settings import settings
from src.models.organization import Membership, Organization
from src.services.auth_service import store_oauth_state
from src.services.organizations import ROLE_ADMIN, ROLE_MEMBER, sync_organizations
from tests.web_helpers import _override_web_user, _seed_user
from tests.web_helpers import started_here

ALICE = "user_alice"
BOB = "user_bob"
CAROL = "user_carol"
DAVE = "user_dave"
OUTSIDER = "user_out"


def _uid(user_id: str) -> str:
    """The Authentik uid of a seeded user (``_seed_user`` stores ``ak_<id>``)."""
    return f"ak_{user_id}"


def _group(name, user_ids, inactive=(), **attributes):
    """A group as Authentik's groups API lists it, trimmed to what we read."""
    users = [{"uid": _uid(u), "is_active": True} for u in user_ids]
    users += [{"uid": _uid(u), "is_active": False} for u in inactive]
    return {"name": name, "attributes": attributes, "users_obj": users}


def _acme(name="Acme", members=(ALICE, BOB), admins=(ALICE, CAROL)):
    return [
        _group(name, members, tumble_organization="acme"),
        _group(f"{name} admins", admins, tumble_organization_admins="acme"),
    ]


async def _seed_users(db_session, *user_ids):
    for user_id in user_ids:
        await _seed_user(db_session, user_id, email=f"{user_id}@example.com")


async def _state(session_factory):
    """Every organization as (slug, name, {user_id: role})."""
    async with session_factory() as s:
        organizations = (await s.scalars(select(Organization))).all()
        memberships = (await s.scalars(select(Membership))).all()
    return {
        o.slug: (
            o.name,
            {m.user_id: m.role for m in memberships if m.organization_id == o.id},
        )
        for o in organizations
    }


async def _sync(session_factory):
    async with session_factory() as s:
        await sync_organizations(s)


# --- The reconcile ----------------------------------------------------------


async def test_groups_become_an_organization_with_members_and_admins(
    db_session, session_factory, authentik_groups
):
    await _seed_users(db_session, ALICE, BOB, CAROL, DAVE)
    authentik_groups += _acme()
    # Dave is in the group but deactivated in Authentik; Erin never signed in
    # to the cloud, so there is no user row for her.
    authentik_groups[0]["users_obj"] += [
        {"uid": _uid(DAVE), "is_active": False},
        {"uid": "ak_user_erin", "is_active": True},
    ]

    await _sync(session_factory)

    assert await _state(session_factory) == {
        # Carol is an admin without being in the main group.
        "acme": ("Acme", {ALICE: ROLE_ADMIN, BOB: ROLE_MEMBER, CAROL: ROLE_ADMIN})
    }


async def test_a_later_sync_renames_and_moves_members_on_the_same_row(
    db_session, session_factory, authentik_groups
):
    await _seed_users(db_session, ALICE, BOB, CAROL, DAVE)
    authentik_groups += _acme()
    await _sync(session_factory)
    async with session_factory() as s:
        org_id = await s.scalar(select(Organization.id))

    authentik_groups[:] = _acme(name="Acme Inc", members=(ALICE, DAVE), admins=(BOB,))
    await _sync(session_factory)

    assert await _state(session_factory) == {
        "acme": ("Acme Inc", {ALICE: ROLE_MEMBER, BOB: ROLE_ADMIN, DAVE: ROLE_MEMBER})
    }
    async with session_factory() as s:
        assert await s.scalar(select(Organization.id)) == org_id


async def test_an_organization_without_groups_keeps_its_row_and_loses_members(
    db_session, session_factory, authentik_groups
):
    await _seed_users(db_session, ALICE, BOB, CAROL)
    authentik_groups += _acme()
    await _sync(session_factory)

    # Left: only an admins group, which names no organization on its own.
    authentik_groups[:] = [
        _group("Ghost admins", [ALICE], tumble_organization_admins="ghost")
    ]
    await _sync(session_factory)

    assert await _state(session_factory) == {"acme": ("Acme", {})}


# --- The Authentik request --------------------------------------------------


@pytest.fixture
def authentik_http(monkeypatch, authentik_groups):
    """Run the real ``fetch_groups`` against ``handler`` instead of Authentik."""
    monkeypatch.setattr(
        "src.services.organizations.fetch_groups", authentik.fetch_groups
    )
    monkeypatch.setattr(settings, "authentik_base_url", "https://auth.example.com")
    monkeypatch.setattr(settings, "authentik_internal_url", "http://auth_server:9000")
    requests: list[httpx.Request] = []
    real_client = httpx.AsyncClient

    def install(handler):
        def record(request):
            requests.append(request)
            return handler(request)

        transport = httpx.MockTransport(record)
        monkeypatch.setattr(
            authentik.httpx,
            "AsyncClient",
            lambda **kwargs: real_client(transport=transport, **kwargs),
        )
        return requests

    return install


def _page(groups, next_page):
    return {"pagination": {"next": next_page}, "results": groups}


async def test_the_groups_request_pages_through_with_the_api_token(authentik_http):
    pages = {"1": _page([{"name": "a"}], 2), "2": _page([{"name": "b"}], 0)}
    requests = authentik_http(
        lambda request: httpx.Response(200, json=pages[request.url.params["page"]])
    )

    assert await authentik.fetch_groups() == [{"name": "a"}, {"name": "b"}]

    for number, request in enumerate(requests, start=1):
        assert request.method == "GET"
        assert str(request.url).startswith(
            "http://auth_server:9000/api/v3/core/groups/?"
        )
        assert request.url.params["page"] == str(number)
        assert request.url.params["page_size"] == "100"
        assert (
            request.headers["authorization"] == f"Bearer {settings.authentik_api_token}"
        )
        assert request.headers["host"] == "auth.example.com"
    assert len(requests) == 2


async def _sign_in(client, db_session, sub):
    """A web sign-in through the real callback; only Authentik's two answers
    (tokens, userinfo) are stood in for."""
    await store_oauth_state(db_session, "st", "web:/app", "verifier")
    await db_session.commit()
    with (
        patch(
            "src.routers.browser.exchange_code_for_tokens",
            AsyncMock(return_value={"access_token": "at"}),
        ),
        patch(
            "src.routers.browser.get_userinfo",
            AsyncMock(return_value={"sub": sub, "email": f"{sub}@example.com"}),
        ),
    ):
        return client.get(
            "/auth/clerk/callback?code=c&state=st",
            headers=started_here("st"),
            follow_redirects=False,
        )


async def test_a_first_sign_in_gets_the_memberships_at_once(
    client, db_session, session_factory, authentik_groups
):
    authentik_groups += _acme(members=("newcomer",), admins=())
    await _sync(session_factory)
    assert await _state(session_factory) == {"acme": ("Acme", {})}

    resp = await _sign_in(client, db_session, _uid("newcomer"))

    assert resp.status_code == 303
    [(name, roles)] = (await _state(session_factory)).values()
    assert list(roles.values()) == [ROLE_MEMBER]


def _unreachable(request):
    raise httpx.ConnectError("Connection refused", request=request)


@pytest.mark.parametrize(
    "answer",
    [
        lambda request: httpx.Response(403, json={"detail": "Token invalid"}),
        lambda request: httpx.Response(200, text="<html>proxy error</html>"),
        _unreachable,
    ],
    ids=["forbidden", "html", "unreachable"],
)
async def test_a_failing_authentik_keeps_memberships_and_sign_in_works(
    client, db_session, session_factory, authentik_groups, authentik_http, answer
):
    await _seed_users(db_session, ALICE, BOB, CAROL)
    authentik_groups += _acme()
    # The first sync reads the groups above through a working Authentik.
    authentik_http(lambda request: httpx.Response(200, json=_page(authentik_groups, 0)))
    await _sync(session_factory)
    before = await _state(session_factory)
    assert before["acme"][1]

    authentik_http(answer)
    resp = await _sign_in(client, db_session, _uid(ALICE))

    assert resp.status_code == 303 and resp.headers["location"] == "/app"
    assert await _state(session_factory) == before


# --- The pages --------------------------------------------------------------


@pytest.fixture
async def acme(db_session, session_factory, authentik_groups):
    await _seed_users(db_session, ALICE, BOB, CAROL, OUTSIDER)
    authentik_groups += _acme()
    await _sync(session_factory)
    async with session_factory() as s:
        return await s.scalar(select(Organization.id))


async def test_members_see_read_only_pages_that_point_to_authentik(client, acme):
    _override_web_user(client.app, BOB, email=f"{BOB}@example.com")

    listing = client.get("/app/organizations")
    detail = client.get(f"/app/organizations/{acme}")

    assert detail.status_code == 200
    assert "Acme" in listing.text and "Member" in listing.text
    assert f"{CAROL}@example.com" in detail.text and "Admin" in detail.text
    for page in (listing, detail):
        assert 'method="post" action="/app/organizations' not in page.text
        assert "http://authentik-test.local/if/admin/#/identity/groups" in page.text


async def test_an_outsider_gets_not_found(client, acme):
    _override_web_user(client.app, OUTSIDER, email=f"{OUTSIDER}@example.com")

    assert client.get(f"/app/organizations/{acme}").status_code == 404
    assert client.get("/app/organizations/org_unknown").status_code == 404
    assert "Acme" not in client.get("/app/organizations").text


async def test_the_list_pages_by_name_and_filters_by_name(
    client, db_session, session_factory, authentik_groups
):
    await _seed_users(db_session, ALICE)
    names = [f"team {i:02d}" for i in range(26)] + ["ACME Lab", "Old acme"]
    authentik_groups += [
        _group(name, [ALICE], tumble_organization=f"slug-{n}")
        for n, name in enumerate(names)
    ]
    await _sync(session_factory)
    _override_web_user(client.app, ALICE, email=f"{ALICE}@example.com")

    first = client.get("/app/organizations")
    second = client.get("/app/organizations?page=2")
    found = client.get("/app/organizations?q=%20Acme%20")

    assert first.text.count("<tr>") == 1 + 25
    assert first.text.index("ACME Lab") < first.text.index("Old acme")
    assert 'href="/app/organizations?page=2"' in first.text
    assert "Next →" in first.text and "Older →" not in first.text
    assert second.text.count("<tr>") == 1 + 3 and "team 25" in second.text
    assert found.text.count("<tr>") == 1 + 2 and 'value="Acme"' in found.text
    assert (
        "No organization matches this filter"
        in client.get("/app/organizations?q=zzz").text
    )


async def test_the_members_page_lists_admins_first_and_pages(
    client, db_session, session_factory, authentik_groups
):
    people = [f"user_{i:02d}" for i in range(27)]
    await _seed_users(db_session, *people)
    authentik_groups += _acme(members=people, admins=("user_26",))
    await _sync(session_factory)
    async with session_factory() as s:
        org_id = await s.scalar(select(Organization.id))
    _override_web_user(client.app, "user_00", email="user_00@example.com")

    first = client.get(f"/app/organizations/{org_id}")
    second = client.get(f"/app/organizations/{org_id}?page=2")

    assert "You are a member" in first.text
    # The admin sorts last by e-mail but comes first.
    assert first.text.count("<tr>") == 1 + 25
    assert "user_26@example.com" in first.text
    assert f'href="/app/organizations/{org_id}?page=2"' in first.text
    assert second.text.count("<tr>") == 1 + 2
    assert "user_24@example.com" in second.text and "user_25@example.com" in second.text
