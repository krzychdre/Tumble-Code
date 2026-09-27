"""R10: expired auth rows must not accumulate, and sessions must expire.

Covers three hygiene fixes in the self-hosted cloud API's auth stack:

* OAuth state rows are single-use: the callback consumes (deletes) the row it
  read, and a replayed state finds nothing.
* Expired rows — OAuth state, login tickets, idle-expired client tokens — are
  purged by the retention cycle, and only expired ones.
* ``POST /app/logout`` deactivates the session (so the next request with the
  same cookie is sent to the login page), and ``Session.expires_at`` is
  checked during cookie validation: a session whose expiry is in the past is
  treated as if it did not exist.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from src.auth.web_session import COOKIE_NAME, _serializer, resolve_web_user
from src.models.oauth import AuthentikStateStore
from src.models.user import ClientToken, Session as SessionModel, Ticket, User
from src.services.auth_service import (
    get_oauth_state,
    purge_expired_auth_rows,
)


async def _seed_user(db, authentik_id="ak_r10", email="r10@example.com") -> User:
    user = User(authentik_id=authentik_id, email=email)
    db.add(user)
    await db.flush()
    return user


async def _seed_state(
    db,
    state="state-r10",
    *,
    expires_at=None,
    auth_redirect="vscode://QUB-IT.tumble-code",
) -> AuthentikStateStore:
    row = AuthentikStateStore(
        state=state,
        auth_redirect=auth_redirect,
        code_verifier="verifier",
        expires_at=expires_at or datetime.now(timezone.utc) + timedelta(minutes=10),
    )
    db.add(row)
    await db.flush()
    return row


async def _seed_session(db, user_id: str, *, expires_at=None, is_active=True) -> SessionModel:
    session = SessionModel(user_id=user_id, expires_at=expires_at, is_active=is_active)
    db.add(session)
    await db.flush()
    return session


async def _session_id_of(db, user_id: str) -> str:
    return await db.scalar(select(SessionModel.id).where(SessionModel.user_id == user_id))


def _web_cookie(user_id: str, session_id: str) -> dict:
    return {COOKIE_NAME: _serializer.dumps({"sid": session_id, "uid": user_id})}


# ---------------------------------------------------------------------------
# (a) OAuth state is single-use
# ---------------------------------------------------------------------------


async def test_get_oauth_state_consumes_the_row(db_session):
    """Reading a state row deletes it: the callback spends it, a replay finds nothing."""
    await _seed_state(db_session, "state-live")

    first = await get_oauth_state(db_session, "state-live")
    assert first is not None
    assert first.state == "state-live"

    remaining = await db_session.scalar(
        select(func.count()).select_from(AuthentikStateStore).where(AuthentikStateStore.state == "state-live")
    )
    assert remaining == 0, "the state row must be deleted on use"

    second = await get_oauth_state(db_session, "state-live")
    assert second is None, "a replayed state must be refused"


async def test_get_oauth_state_with_an_unknown_state_deletes_nothing(db_session):
    """The not-found path must not issue a DELETE for a state that isn't there."""
    await _seed_state(db_session, "state-live")

    assert await get_oauth_state(db_session, "state-missing") is None

    # The unrelated row is untouched.
    row = await db_session.scalar(
        select(AuthentikStateStore).where(AuthentikStateStore.state == "state-live")
    )
    assert row is not None


async def test_get_oauth_state_still_refuses_an_expired_row(db_session):
    await _seed_state(
        db_session, "state-old", expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)
    )
    assert await get_oauth_state(db_session, "state-old") is None


# ---------------------------------------------------------------------------
# (b) The purge removes only expired rows
# ---------------------------------------------------------------------------


async def _seed_purge_fodder(db):
    """One expired and one live row of each kind; returns the live session."""
    from config.settings import settings

    user = await _seed_user(db)
    session = await _seed_session(db, user.id)

    await _seed_state(db, "state-expired", expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    await _seed_state(db, "state-live")

    db.add(
        Ticket(
            code="ticket-expired",
            session_id=session.id,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
    )
    db.add(
        Ticket(
            code="ticket-live",
            session_id=session.id,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        )
    )

    expiry = (
        datetime.now(timezone.utc) + timedelta(days=settings.client_token_idle_days)
        if settings.client_token_idle_days > 0
        else None
    )
    db.add(
        ClientToken(
            session_id=session.id,
            token_hash="hash-expired",
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
        )
    )
    db.add(ClientToken(session_id=session.id, token_hash="hash-live", expires_at=expiry))
    await db.commit()
    return session


async def test_purge_removes_only_expired_rows(db_session):
    await _seed_purge_fodder(db_session)

    purged = await purge_expired_auth_rows(db_session)
    await db_session.commit()

    # The three expired rows are gone; the live ones all survive.
    assert purged == 3, "one expired state, ticket and client token"

    states = {r[0] for r in (await db_session.execute(select(AuthentikStateStore.state))).all()}
    assert states == {"state-live"}

    tickets = {r[0] for r in (await db_session.execute(select(Ticket.code))).all()}
    assert tickets == {"ticket-live"}

    hashes = {r[0] for r in (await db_session.execute(select(ClientToken.token_hash))).all()}
    assert "hash-expired" not in hashes
    assert "hash-live" in hashes


async def test_purge_takes_used_tickets_too(db_session):
    """A used ticket is dead weight like an expired one; the purge takes it once expired."""
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user.id)
    db_session.add(
        Ticket(
            code="ticket-used",
            session_id=session.id,
            expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
            used=True,
        )
    )
    await db_session.commit()

    await purge_expired_auth_rows(db_session)
    await db_session.commit()

    tickets = {r[0] for r in (await db_session.execute(select(Ticket.code))).all()}
    assert tickets == set()


async def test_purge_never_touches_tokens_when_expiry_is_off(db_session, monkeypatch):
    """client_token_idle_days=0 means tokens never expire by configuration; a
    leftover old expires_at must stay (validation still refuses the token — it
    is just not the purge's call to remove it)."""
    from config.settings import settings

    monkeypatch.setattr(settings, "client_token_idle_days", 0)
    user = await _seed_user(db_session)
    session = await _seed_session(db_session, user.id)
    db_session.add(
        ClientToken(
            session_id=session.id,
            token_hash="hash-old",
            expires_at=datetime.now(timezone.utc) - timedelta(days=400),
        )
    )
    await db_session.commit()

    await purge_expired_auth_rows(db_session)
    await db_session.commit()

    hashes = {r[0] for r in (await db_session.execute(select(ClientToken.token_hash))).all()}
    assert hashes == {"hash-old"}


async def test_purge_counts_the_deleted_rows(db_session):
    await _seed_state(
        db_session, "state-expired", expires_at=datetime.now(timezone.utc) - timedelta(minutes=1)
    )
    await purge_expired_auth_rows(db_session)
    # Nothing left to delete: a second run reports zero.
    assert await purge_expired_auth_rows(db_session) == 0


# ---------------------------------------------------------------------------
# (c) Session.expires_at is checked during validation
# ---------------------------------------------------------------------------


async def test_an_expired_session_does_not_resolve_a_web_user(db_session):
    user = await _seed_user(db_session)
    await _seed_session(
        db_session, user.id, expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)
    )

    cookie = _serializer.dumps({"sid": await _session_id_of(db_session, user.id), "uid": user.id})
    assert await resolve_web_user(cookie, db_session) is None


async def test_a_live_session_still_resolves_a_web_user(db_session):
    user = await _seed_user(db_session)
    await _seed_session(
        db_session, user.id, expires_at=datetime.now(timezone.utc) + timedelta(days=1)
    )

    cookie = _serializer.dumps({"sid": await _session_id_of(db_session, user.id), "uid": user.id})
    resolved = await resolve_web_user(cookie, db_session)
    assert resolved is not None
    assert resolved["user_id"] == user.id


async def test_a_session_without_expiry_still_resolves_a_web_user(db_session):
    """expires_at is NULL on this deployment (nothing sets it today); NULL must
    keep meaning "does not expire", not "already expired"."""
    user = await _seed_user(db_session)
    await _seed_session(db_session, user.id, expires_at=None)

    cookie = _serializer.dumps({"sid": await _session_id_of(db_session, user.id), "uid": user.id})
    assert await resolve_web_user(cookie, db_session) is not None


# ---------------------------------------------------------------------------
# (d) POST /app/logout deactivates the session
# ---------------------------------------------------------------------------


async def test_post_logout_deactivates_the_session(client, db_session):
    user = await _seed_user(db_session, "ak_out", "out@example.com")
    user_id = user.id
    session = await _seed_session(db_session, user_id)
    session_id = session.id
    await db_session.commit()

    resp = client.post("/app/logout", cookies=_web_cookie(user_id, session_id), follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"

    # The session row is deactivated in the DB.
    db_session.expire_all()
    still_active = await db_session.scalar(
        select(SessionModel.is_active).where(SessionModel.id == session_id)
    )
    assert still_active is False

    # A request with the same cookie is sent to the login page: the session no
    # longer resolves, so require_web_user raises LoginRequired.
    follow = client.get("/app", cookies=_web_cookie(user_id, session_id), follow_redirects=False)
    assert follow.status_code == 303
    assert follow.headers["location"] == "/app/login"


async def test_post_logout_clears_the_cookie(client, db_session):
    user = await _seed_user(db_session, "ak_clear", "clear@example.com")
    session = await _seed_session(db_session, user.id)
    await db_session.commit()

    resp = client.post("/app/logout", cookies=_web_cookie(user.id, session.id), follow_redirects=False)
    set_cookie = resp.headers.get("set-cookie", "")
    assert COOKIE_NAME in set_cookie
    assert "max-age=0" in set_cookie.lower()


async def test_post_logout_without_a_session_still_redirects(client, db_session):
    """The old GET link, bookmarks and stale cookies must not 4xx: an
    anonymous logout lands on the login page exactly like a signed-in one."""
    resp = client.post("/app/logout", follow_redirects=False)
    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/login"


async def test_get_logout_is_gone(client, db_session):
    """The old GET endpoint is removed, not deprecated: a GET is refused with
    405 so no same-site page can sign the reader out with an <img> tag."""
    resp = client.get("/app/logout", follow_redirects=False)
    assert resp.status_code == 405


async def test_post_logout_from_an_untrusted_origin_is_refused(client, db_session):
    """The new POST rides the same CSRF origin check as the other panel forms."""
    user = await _seed_user(db_session, "ak_csrf", "csrf@example.com")
    session = await _seed_session(db_session, user.id)
    session_id = session.id
    await db_session.commit()

    resp = client.post(
        "/app/logout",
        cookies=_web_cookie(user.id, session_id),
        headers={"Origin": "https://evil.example"},
        follow_redirects=False,
    )
    assert resp.status_code == 403

    # The session survives the refused request.
    db_session.expire_all()
    still_active = await db_session.scalar(
        select(SessionModel.is_active).where(SessionModel.id == session_id)
    )
    assert still_active is True
