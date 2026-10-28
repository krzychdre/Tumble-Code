"""Organizations (/app/organizations): who may do what, and the last-admin rule."""

import pytest
from sqlalchemy import select

from src.models.organization import Membership, Organization
from src.services.organizations import ROLE_ADMIN, ROLE_MEMBER
from tests.web_helpers import _override_web_user, _seed_user

ORG = "org_acme"
ADMIN = "user_admin"
MEMBER = "user_member"
OUTSIDER = "user_out"


@pytest.fixture
async def org(db_session):
    for user_id in (ADMIN, MEMBER, OUTSIDER):
        await _seed_user(db_session, user_id, email=f"{user_id}@example.com")
    db_session.add(Organization(id=ORG, name="Acme"))
    db_session.add(Membership(user_id=ADMIN, organization_id=ORG, role=ROLE_ADMIN))
    db_session.add(Membership(user_id=MEMBER, organization_id=ORG, role=ROLE_MEMBER))
    await db_session.commit()


def _as(client, user_id):
    _override_web_user(client.app, user_id, email=f"{user_id}@example.com")
    return client


async def _roles(session_factory):
    async with session_factory() as s:
        rows = await s.execute(
            select(Membership.user_id, Membership.role).where(
                Membership.organization_id == ORG
            )
        )
        return dict(rows.all())


def _post(client, path, **form):
    return client.post(path, data=form, follow_redirects=False)


async def test_creating_an_organization_makes_the_creator_its_admin(
    client, db_session, session_factory
):
    await _seed_user(db_session, ADMIN)
    resp = _post(_as(client, ADMIN), "/app/organizations", name="  New Co  ")
    assert resp.status_code == 303

    async with session_factory() as s:
        organization = await s.scalar(select(Organization))
        membership = await s.scalar(select(Membership))
    assert organization.name == "New Co"
    assert resp.headers["location"] == f"/app/organizations/{organization.id}"
    assert (membership.user_id, membership.role) == (ADMIN, ROLE_ADMIN)

    listing = client.get("/app/organizations")
    assert "New Co" in listing.text and "Admin" in listing.text


@pytest.mark.parametrize("name", ["   ", "x" * 101])
async def test_a_bad_name_is_refused_with_a_message(client, db_session, name):
    await _seed_user(db_session, ADMIN)
    resp = _post(_as(client, ADMIN), "/app/organizations", name=name)
    assert resp.headers["location"] == "/app/organizations?error=bad_name"
    page = client.get(resp.headers["location"])
    assert "needs a name of at most 100 characters" in page.text


async def test_an_admin_adds_a_member_by_email_case_insensitively(
    client, org, session_factory
):
    resp = _post(
        _as(client, ADMIN),
        f"/app/organizations/{ORG}/members",
        email=" USER_OUT@Example.com ",
        role=ROLE_MEMBER,
    )
    assert resp.headers["location"] == f"/app/organizations/{ORG}"
    assert (await _roles(session_factory))[OUTSIDER] == ROLE_MEMBER


@pytest.mark.parametrize(
    "email, role, code",
    [
        ("nobody@example.com", ROLE_MEMBER, "unknown_email"),
        ("user_member@example.com", ROLE_MEMBER, "already_member"),
        ("user_out@example.com", "org:owner", "bad_role"),
        ("twin@example.com", ROLE_MEMBER, "ambiguous_email"),
    ],
)
async def test_adding_a_member_is_refused_with_a_reason(
    client, org, db_session, email, role, code
):
    await _seed_user(db_session, "user_twin1", email="twin@example.com")
    await _seed_user(db_session, "user_twin2", email="TWIN@example.com")
    resp = _post(
        _as(client, ADMIN), f"/app/organizations/{ORG}/members", email=email, role=role
    )
    assert resp.headers["location"] == f"/app/organizations/{ORG}?error={code}"


async def test_members_see_the_page_but_only_admins_change_it(
    client, org, session_factory
):
    _as(client, MEMBER)
    page = client.get(f"/app/organizations/{ORG}")
    assert page.status_code == 200
    assert "user_admin@example.com" in page.text
    assert "Add a member" not in page.text

    member_actions = [
        (
            f"/app/organizations/{ORG}/members",
            {"email": "user_out@example.com", "role": ROLE_MEMBER},
        ),
        (f"/app/organizations/{ORG}/members/{MEMBER}/role", {"role": ROLE_ADMIN}),
        (f"/app/organizations/{ORG}/members/{ADMIN}/remove", {}),
    ]
    for path, form in member_actions:
        assert _post(client, path, **form).status_code == 403
    assert await _roles(session_factory) == {ADMIN: ROLE_ADMIN, MEMBER: ROLE_MEMBER}


async def test_an_outsider_gets_not_found_everywhere(client, org, session_factory):
    _as(client, OUTSIDER)
    assert client.get(f"/app/organizations/{ORG}").status_code == 404
    assert client.get("/app/organizations/org_unknown").status_code == 404
    for path in (
        f"/app/organizations/{ORG}/members",
        f"/app/organizations/{ORG}/members/{OUTSIDER}/remove",
    ):
        assert (
            _post(
                client, path, email="user_out@example.com", role=ROLE_MEMBER
            ).status_code
            == 404
        )
    assert "Acme" not in client.get("/app/organizations").text
    assert OUTSIDER not in await _roles(session_factory)


async def test_the_last_admin_can_neither_be_demoted_nor_leave(
    client, org, session_factory
):
    _as(client, ADMIN)
    demote = _post(
        client, f"/app/organizations/{ORG}/members/{ADMIN}/role", role=ROLE_MEMBER
    )
    leave = _post(client, f"/app/organizations/{ORG}/members/{ADMIN}/remove")
    for resp in (demote, leave):
        assert resp.headers["location"] == f"/app/organizations/{ORG}?error=last_admin"
    assert (await _roles(session_factory))[ADMIN] == ROLE_ADMIN

    # With a second admin, the first may step down.
    _post(client, f"/app/organizations/{ORG}/members/{MEMBER}/role", role=ROLE_ADMIN)
    _post(client, f"/app/organizations/{ORG}/members/{ADMIN}/role", role=ROLE_MEMBER)
    assert await _roles(session_factory) == {ADMIN: ROLE_MEMBER, MEMBER: ROLE_ADMIN}


async def test_an_admin_removes_a_member_and_a_member_leaves(
    client, org, db_session, session_factory
):
    db_session.add(Membership(user_id=OUTSIDER, organization_id=ORG, role=ROLE_MEMBER))
    await db_session.commit()

    removed = _post(
        _as(client, ADMIN), f"/app/organizations/{ORG}/members/{OUTSIDER}/remove"
    )
    assert removed.headers["location"] == f"/app/organizations/{ORG}"

    left = _post(
        _as(client, MEMBER), f"/app/organizations/{ORG}/members/{MEMBER}/remove"
    )
    assert left.headers["location"] == "/app/organizations"

    assert await _roles(session_factory) == {ADMIN: ROLE_ADMIN}
