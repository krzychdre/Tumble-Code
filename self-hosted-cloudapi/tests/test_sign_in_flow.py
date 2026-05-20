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
