"""End-to-end regression for the Clerk-compatible sign-in flow.

Covers the bug where POST /v1/client/sign_ins returned the ticket's session id
in the body but a Bearer token bound to a *different* (freshly-created) session,
causing the subsequent POST /v1/client/sessions/{id}/tokens to 404.
See ai_plans/2026-05-16_fix-self-hosted-auth-404.md.
"""

from datetime import datetime, timedelta, timezone

import pytest

from src.auth.jwt_issuer import decode_token
from src.models.user import Session as SessionModel, Ticket, User


async def _seed_user_session_ticket(db_session) -> tuple[User, SessionModel, str]:
    user = User(
        authentik_id="ak_test_user_1",
        email="test@example.com",
        first_name="Test",
        last_name="User",
    )
    db_session.add(user)
    await db_session.flush()

    session = SessionModel(user_id=user.id)
    db_session.add(session)
    await db_session.flush()

    ticket = Ticket(
        code="test_ticket_code_abc123",
        session_id=session.id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
    )
    db_session.add(ticket)
    await db_session.commit()
    return user, session, ticket.code


async def test_sign_in_then_create_session_token_succeeds(client, db_session):
    """Regression: ticket -> sign_ins -> sessions/{id}/tokens must return 200."""
    user, session, ticket_code = await _seed_user_session_ticket(db_session)

    resp = client.post(
        "/v1/client/sign_ins",
        data={"strategy": "ticket", "ticket": ticket_code},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["response"]["created_session_id"] == session.id

    raw_token = resp.headers.get("Authorization") or resp.headers.get("authorization")
    assert raw_token, "expected Authorization header on sign-in response"

    # The header value is the bare token (no "Bearer " prefix in current impl);
    # the client sends it back with "Bearer " prepended.
    if raw_token.lower().startswith("bearer "):
        raw_token = raw_token[7:]

    token_resp = client.post(
        f"/v1/client/sessions/{session.id}/tokens",
        data={"_is_native": "1"},
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert token_resp.status_code == 200, token_resp.text
    jwt_str = token_resp.json()["jwt"]
    assert jwt_str and isinstance(jwt_str, str)

    payload = decode_token(jwt_str)
    assert payload is not None
    assert payload["r"]["u"] == user.id
    assert payload["r"]["t"] == "auth"


async def test_me_after_sign_in_returns_user(client, db_session):
    """End-to-end smoke: sign in, then GET /v1/me with the client token."""
    user, session, ticket_code = await _seed_user_session_ticket(db_session)

    resp = client.post(
        "/v1/client/sign_ins",
        data={"strategy": "ticket", "ticket": ticket_code},
    )
    assert resp.status_code == 200
    raw_token = (resp.headers.get("Authorization") or "").removeprefix("Bearer ")

    me_resp = client.get(
        "/v1/me", headers={"Authorization": f"Bearer {raw_token}"}
    )
    assert me_resp.status_code == 200, me_resp.text
    assert me_resp.json()["response"]["id"] == user.id
    assert me_resp.json()["response"]["email_addresses"][0]["email_address"] == user.email


async def test_token_does_not_unlock_other_session(client, db_session):
    """The cross-session 404 guard must still hold: a token issued for session_A
    cannot mint a JWT for an unrelated session_B."""
    user, session_a, ticket_code = await _seed_user_session_ticket(db_session)

    # Sign in to get a token for session_a.
    resp = client.post(
        "/v1/client/sign_ins",
        data={"strategy": "ticket", "ticket": ticket_code},
    )
    assert resp.status_code == 200
    raw_token = (resp.headers.get("Authorization") or "").removeprefix("Bearer ")

    # Create a second, unrelated session for the same user.
    session_b = SessionModel(user_id=user.id)
    db_session.add(session_b)
    await db_session.commit()

    bad = client.post(
        f"/v1/client/sessions/{session_b.id}/tokens",
        data={"_is_native": "1"},
        headers={"Authorization": f"Bearer {raw_token}"},
    )
    assert bad.status_code == 404, bad.text


async def test_ticket_is_single_use(client, db_session):
    """validate_ticket flips used=True; second sign-in with the same ticket 401s."""
    _, _, ticket_code = await _seed_user_session_ticket(db_session)

    first = client.post(
        "/v1/client/sign_ins",
        data={"strategy": "ticket", "ticket": ticket_code},
    )
    assert first.status_code == 200

    second = client.post(
        "/v1/client/sign_ins",
        data={"strategy": "ticket", "ticket": ticket_code},
    )
    assert second.status_code == 401


async def _sign_in(client, db_session, authentik_id: str, ticket_code: str):
    """Seed a user with a session and a ticket, sign in, return (user id, session id, token).

    Ids, not ORM objects: the tests expire the seeding session to re-read rows,
    and touching an expired object's attribute outside the async context fails.
    """
    user = User(authentik_id=authentik_id, email=f"{authentik_id}@example.com")
    db_session.add(user)
    await db_session.flush()
    session = SessionModel(user_id=user.id)
    db_session.add(session)
    await db_session.flush()
    db_session.add(
        Ticket(
            code=ticket_code,
            session_id=session.id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        )
    )
    await db_session.commit()
    resp = client.post("/v1/client/sign_ins", data={"strategy": "ticket", "ticket": ticket_code})
    assert resp.status_code == 200, resp.text
    return user.id, session.id, (resp.headers.get("Authorization") or "").removeprefix("Bearer ")


async def _session_is_active(db_session, session_id: str) -> bool:
    from sqlalchemy import select

    db_session.expire_all()
    result = await db_session.execute(select(SessionModel.is_active).where(SessionModel.id == session_id))
    return bool(result.scalar_one())


# DEF-S6: POST /v1/client/sessions/{id}/remove ended whatever session the path
# named, as long as the caller held any valid client token.


async def test_logout_cannot_end_another_users_session(client, db_session):
    _, _, alice_token = await _sign_in(client, db_session, "ak_alice", "ticket_alice")
    _, bob_session_id, bob_token = await _sign_in(client, db_session, "ak_bob", "ticket_bob")

    resp = client.post(
        f"/v1/client/sessions/{bob_session_id}/remove",
        data={"_is_native": "1"},
        headers={"Authorization": f"Bearer {alice_token}"},
    )

    assert resp.status_code == 404, resp.text
    assert await _session_is_active(db_session, bob_session_id)
    # Bob is still signed in: his token still mints session JWTs.
    still = client.post(
        f"/v1/client/sessions/{bob_session_id}/tokens",
        data={"_is_native": "1"},
        headers={"Authorization": f"Bearer {bob_token}"},
    )
    assert still.status_code == 200, still.text


async def test_logout_ends_own_session(client, db_session):
    _, session_id, token = await _sign_in(client, db_session, "ak_carol", "ticket_carol")

    resp = client.post(
        f"/v1/client/sessions/{session_id}/remove",
        data={"_is_native": "1"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 200, resp.text
    assert not await _session_is_active(db_session, session_id)


# DEF-S7: the organization_id form field was copied into the session JWT's
# org claim (r.o) without checking that the user belongs to that organization.


async def _org_with_member(db_session, user_id: str | None, name: str) -> str:
    from src.models.organization import Membership, Organization

    org = Organization(name=name, slug=name)
    db_session.add(org)
    await db_session.flush()
    if user_id is not None:
        db_session.add(Membership(user_id=user_id, organization_id=org.id))
    await db_session.commit()
    return org.id


async def test_session_token_refuses_org_the_user_is_not_a_member_of(client, db_session):
    _, session_id, token = await _sign_in(client, db_session, "ak_dave", "ticket_dave")
    foreign_org = await _org_with_member(db_session, None, "foreign")

    for org_id in (foreign_org, "org_does_not_exist"):
        resp = client.post(
            f"/v1/client/sessions/{session_id}/tokens",
            data={"_is_native": "1", "organization_id": org_id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403, resp.text
        assert "jwt" not in resp.text


async def test_session_token_carries_org_the_user_belongs_to(client, db_session):
    user_id, session_id, token = await _sign_in(client, db_session, "ak_erin", "ticket_erin")
    own_org = await _org_with_member(db_session, user_id, "own")

    resp = client.post(
        f"/v1/client/sessions/{session_id}/tokens",
        data={"_is_native": "1", "organization_id": own_org},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert decode_token(resp.json()["jwt"])["r"]["o"] == own_org


async def test_session_token_without_org_is_personal(client, db_session):
    _, session_id, token = await _sign_in(client, db_session, "ak_frank", "ticket_frank")

    resp = client.post(
        f"/v1/client/sessions/{session_id}/tokens",
        data={"_is_native": "1", "organization_id": ""},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    assert "o" not in decode_token(resp.json()["jwt"])["r"]
