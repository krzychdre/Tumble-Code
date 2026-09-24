"""DEF-S11: deployment hygiene.

- the Docker build context must not carry local secrets (.env.backup,
  .env.bak-ip141, ...) or the developer's 100+ MB .venv;
- the container must not run as root;
- startup must fail on the placeholder secrets from .env.example and
  docker-compose.yml, which anyone can read and use to forge web session
  cookies (SECRET_KEY) or session JWTs (JWT_SECRET);
- client tokens must expire when unused;
- the sign-in log lines must name the user by id, not by e-mail address.
"""

import fnmatch
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from config.settings import Settings, settings
from src.models.user import ClientToken, Session as SessionModel, User
from src.services.auth_service import create_client_token

ROOT = Path(__file__).resolve().parent.parent

STRONG = "x" * 20 + "0123456789abcdef"  # 36 characters, not a placeholder


# --- Docker build context ---------------------------------------------------


def _dockerignore_excludes(path: str) -> bool:
    """Tiny model of Docker's .dockerignore matching: the last pattern that
    matches the path or one of its parent directories decides."""
    patterns = []
    for line in (ROOT / ".dockerignore").read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        negated = line.startswith("!")
        patterns.append((line[1:] if negated else line, negated))
    parts = path.split("/")
    candidates = ["/".join(parts[: i + 1]) for i in range(len(parts))]
    excluded = False
    for pattern, negated in patterns:
        pattern = pattern.rstrip("/")
        if any(fnmatch.fnmatchcase(c, pattern) for c in candidates):
            excluded = not negated
    return excluded


@pytest.mark.parametrize(
    "path",
    [
        ".env",
        ".env.backup",
        ".env.bak-ip141",
        ".env.local",
        ".venv/lib/python3.13/site-packages/x.py",
        ".pytest_cache/v/cache/lastfailed",
        ".ruff_cache/x",
        ".mypy_cache/x",
        "htmlcov/index.html",
        ".coverage",
        ".vol/postgres/PG_VERSION",
    ],
)
def test_build_context_excludes_secrets_and_local_state(path):
    assert _dockerignore_excludes(path), path


@pytest.mark.parametrize(
    "path", [".env.example", "src/main.py", "pyproject.toml", "uv.lock", "docker-entrypoint.sh", "db-migrate.sh"]
)
def test_build_context_keeps_the_application(path):
    assert not _dockerignore_excludes(path), path


def test_container_does_not_run_as_root():
    users = [
        line.split(None, 1)[1].strip()
        for line in (ROOT / "Dockerfile").read_text().splitlines()
        if line.strip().upper().startswith("USER ")
    ]
    assert users, "Dockerfile never sets USER, so the app runs as root"
    assert users[-1].split(":")[0] not in ("root", "0")


# --- Secrets ----------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"secret_key": "change-me-to-a-random-secret-key"},
        {"jwt_secret": "change-me-to-a-random-jwt-secret"},
        {"secret_key": "CHANGE-ME"},
        {"secret_key": ""},
        {"secret_key": "short-but-real"},
        {"jwt_secret": "short-but-real"},
        {"jwt_secret": None},
    ],
)
def test_startup_refuses_placeholder_or_weak_secrets(overrides):
    values = {"secret_key": STRONG, "jwt_secret": STRONG, "jwt_algorithm": "HS256"} | overrides
    with pytest.raises(ValidationError):
        Settings(**values)


def test_startup_accepts_strong_secrets():
    s = Settings(secret_key=STRONG, jwt_secret=STRONG, jwt_algorithm="HS256")
    assert s.secret_key == STRONG


def test_rs256_needs_no_shared_jwt_secret():
    s = Settings(
        secret_key=STRONG,
        jwt_secret=None,
        jwt_algorithm="RS256",
        jwt_private_key="-----BEGIN PRIVATE KEY-----",
        jwt_public_key="-----BEGIN PUBLIC KEY-----",
    )
    assert s.jwt_secret is None


# --- Client token expiry ----------------------------------------------------


async def _user_session(db_session, authentik_id="ak_ttl") -> str:
    user = User(authentik_id=authentik_id, email=f"{authentik_id}@example.com")
    db_session.add(user)
    await db_session.flush()
    session = SessionModel(user_id=user.id)
    db_session.add(session)
    await db_session.flush()
    return session.id


async def _token_row(db_session, raw: str) -> ClientToken:
    db_session.expire_all()
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    result = await db_session.execute(select(ClientToken).where(ClientToken.token_hash == token_hash))
    return result.scalar_one()


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _me(client, raw: str) -> int:
    return client.get("/v1/me", headers={"Authorization": f"Bearer {raw}"}).status_code


def test_client_token_idle_days_defaults_to_30():
    assert Settings(secret_key=STRONG, jwt_secret=STRONG).client_token_idle_days == 30


async def test_new_client_token_expires_after_the_idle_period(db_session, monkeypatch):
    monkeypatch.setattr(settings, "client_token_idle_days", 30)
    session_id = await _user_session(db_session)
    token, _ = await create_client_token(db_session, session_id)
    await db_session.commit()

    expected = datetime.now(timezone.utc) + timedelta(days=30)
    assert abs(_aware(token.expires_at) - expected) < timedelta(minutes=1)


async def test_expired_client_token_is_refused(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "client_token_idle_days", 30)
    session_id = await _user_session(db_session)
    token, raw = await create_client_token(db_session, session_id)
    token.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()

    assert _me(client, raw) == 401


async def test_using_a_client_token_pushes_its_expiry_forward(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "client_token_idle_days", 30)
    session_id = await _user_session(db_session)
    token, raw = await create_client_token(db_session, session_id)
    token.expires_at = datetime.now(timezone.utc) + timedelta(days=2)
    await db_session.commit()

    assert _me(client, raw) == 200
    row = await _token_row(db_session, raw)
    assert _aware(row.expires_at) > datetime.now(timezone.utc) + timedelta(days=29)


async def test_token_issued_before_expiry_existed_keeps_working_and_gets_an_expiry(
    client, db_session, monkeypatch
):
    """Tokens in the database today have expires_at NULL. They are not logged
    out by this change; the first use starts their idle period."""
    monkeypatch.setattr(settings, "client_token_idle_days", 30)
    session_id = await _user_session(db_session)
    token, raw = await create_client_token(db_session, session_id)
    token.expires_at = None
    await db_session.commit()

    assert _me(client, raw) == 200
    row = await _token_row(db_session, raw)
    assert row.expires_at is not None
    assert _aware(row.expires_at) > datetime.now(timezone.utc) + timedelta(days=29)


async def test_zero_idle_days_means_tokens_never_expire(client, db_session, monkeypatch):
    monkeypatch.setattr(settings, "client_token_idle_days", 0)
    session_id = await _user_session(db_session)
    token, raw = await create_client_token(db_session, session_id)
    await db_session.commit()
    assert token.expires_at is None
    assert _me(client, raw) == 200


# --- Logs -------------------------------------------------------------------


@pytest.mark.parametrize("auth_redirect", ["vscode://QUB-IT.tumble-code", "web:/app"])
def test_sign_in_logs_name_the_user_by_id_not_email(client, caplog, auth_redirect):
    with patch("src.routers.browser.get_oauth_state") as get_state, \
         patch("src.routers.browser.exchange_code_for_tokens") as exchange, \
         patch("src.routers.browser.get_userinfo") as userinfo, \
         patch("src.routers.browser.get_or_create_user") as create_user, \
         patch("src.routers.browser.create_session") as create_session, \
         patch("src.routers.browser.create_ticket") as create_ticket:
        get_state.return_value = MagicMock(auth_redirect=auth_redirect, code_verifier="v")
        exchange.return_value = {"access_token": "a"}
        userinfo.return_value = {"sub": "authentik-sub-123", "email": "alice@example.com"}
        create_user.return_value = MagicMock(id="user_abc123")
        create_session.return_value = MagicMock(id="sess_1")
        create_ticket.return_value = "ticket-1"

        with caplog.at_level(logging.INFO, logger="src.routers.browser"):
            resp = client.get(
                "/auth/clerk/callback", params={"code": "c", "state": "s"}, follow_redirects=False
            )

    assert resp.status_code in (200, 303), resp.text
    messages = [r.getMessage() for r in caplog.records if r.name == "src.routers.browser"]
    assert any("user_abc123" in m for m in messages), messages
    assert not any("alice@example.com" in m for m in messages), messages
