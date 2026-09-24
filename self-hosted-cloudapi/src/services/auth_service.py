"""Authentication service - handles sign-in, session, and user management."""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.models.user import User, Session, ClientToken, Ticket
from src.models.organization import Organization, Membership
from src.models.oauth import AuthentikStateStore
from src.auth.jwt_issuer import issue_session_token
from src.auth.authentik import exchange_code_for_tokens, get_userinfo
from config.settings import settings

# A used token's expiry is rewritten at most once per this interval, so the
# extension's refresh (about once a minute) does not write a row every time.
_EXPIRY_REFRESH_INTERVAL = timedelta(days=1)


def _client_token_expiry(now: datetime) -> Optional[datetime]:
    """Expiry for a client token used at ``now``; None when expiry is off."""
    days = settings.client_token_idle_days
    return now + timedelta(days=days) if days > 0 else None


def _as_utc(value: datetime) -> datetime:
    # SQLite's aiosqlite driver returns naive datetimes even for
    # DateTime(timezone=True) columns; Postgres returns aware ones.
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


async def get_or_create_user(
    db: AsyncSession,
    authentik_id: str,
    email: str,
    first_name: str = "",
    last_name: str = "",
    image_url: Optional[str] = None,
) -> User:
    """Get an existing user or create a new one."""
    result = await db.execute(select(User).where(User.authentik_id == authentik_id))
    user = result.scalar_one_or_none()

    if user is None:
        user = User(
            authentik_id=authentik_id,
            email=email,
            first_name=first_name,
            last_name=last_name,
            image_url=image_url,
        )
        db.add(user)
        await db.flush()
    else:
        user.email = email
        user.first_name = first_name
        user.last_name = last_name
        if image_url:
            user.image_url = image_url

    return user


async def create_session(
    db: AsyncSession,
    user_id: str,
) -> Session:
    """Create a new session for a user (no client token yet)."""
    session = Session(user_id=user_id)
    db.add(session)
    await db.flush()
    return session


async def create_client_token(
    db: AsyncSession,
    session_id: str,
) -> tuple[ClientToken, str]:
    """Issue a fresh client token bound to an existing session.

    The raw token is only returned here; the DB stores only its SHA-256 hash,
    so callers MUST hand the raw value back to the client in the same request.
    """
    raw_token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    client_token = ClientToken(
        session_id=session_id,
        token_hash=token_hash,
        expires_at=_client_token_expiry(datetime.now(timezone.utc)),
    )
    db.add(client_token)
    await db.flush()

    return client_token, raw_token


async def create_session_and_token(
    db: AsyncSession,
    user_id: str,
) -> tuple[Session, str]:
    """Create a new session and an initial client token for a user."""
    session = await create_session(db, user_id)
    _, raw_token = await create_client_token(db, session.id)
    return session, raw_token


async def create_ticket(
    db: AsyncSession,
    session_id: str,
    ttl_minutes: int = 5,
) -> str:
    """Create a single-use ticket for the Clerk sign-in flow."""
    code = secrets.token_urlsafe(32)
    ticket = Ticket(
        code=code,
        session_id=session_id,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes),
    )
    db.add(ticket)
    await db.flush()
    return code


async def validate_ticket(
    db: AsyncSession,
    code: str,
) -> Optional[Session]:
    """Validate a ticket and return the associated session. Marks ticket as used."""
    result = await db.execute(
        select(Ticket).where(Ticket.code == code, Ticket.used == False)
    )
    ticket = result.scalar_one_or_none()

    if ticket is None:
        return None

    # SQLite's aiosqlite driver returns naive datetimes even for columns
    # declared as DateTime(timezone=True). Coerce to UTC before comparing so
    # the same code works on Postgres (aware) and SQLite (naive).
    expires_at = ticket.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        return None

    ticket.used = True
    await db.flush()

    result = await db.execute(select(Session).where(Session.id == ticket.session_id))
    return result.scalar_one_or_none()


async def validate_client_token(
    db: AsyncSession,
    raw_token: str,
) -> Optional[Session]:
    """Validate a client token and return the associated session.

    Client tokens expire after ``client_token_idle_days`` without use (DEF-S11).
    Each use moves the expiry forward. A token issued before expiry existed
    (``expires_at`` NULL) is still accepted and gets its first expiry here, so
    nobody is signed out by the upgrade.
    """
    token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

    result = await db.execute(
        select(ClientToken).where(ClientToken.token_hash == token_hash)
    )
    client_token = result.scalar_one_or_none()

    if client_token is None:
        return None

    now = datetime.now(timezone.utc)
    if client_token.expires_at is not None and _as_utc(client_token.expires_at) <= now:
        return None

    new_expiry = _client_token_expiry(now)
    if new_expiry is not None and (
        client_token.expires_at is None
        or new_expiry - _as_utc(client_token.expires_at) >= _EXPIRY_REFRESH_INTERVAL
    ):
        client_token.expires_at = new_expiry
        await db.flush()

    result = await db.execute(
        select(Session).where(Session.id == client_token.session_id, Session.is_active == True)
    )
    return result.scalar_one_or_none()


async def store_oauth_state(
    db: AsyncSession,
    state: str,
    auth_redirect: str,
    code_verifier: str,
    ttl_minutes: int = 10,
) -> None:
    """Store OAuth state and PKCE code verifier."""
    state_store = AuthentikStateStore(
        state=state,
        auth_redirect=auth_redirect,
        code_verifier=code_verifier,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes),
    )
    db.add(state_store)
    await db.flush()


async def get_oauth_state(
    db: AsyncSession,
    state: str,
) -> Optional[AuthentikStateStore]:
    """Retrieve and validate OAuth state."""
    result = await db.execute(
        select(AuthentikStateStore).where(
            AuthentikStateStore.state == state,
            AuthentikStateStore.expires_at > datetime.now(timezone.utc),
        )
    )
    return result.scalar_one_or_none()


async def deactivate_session(
    db: AsyncSession,
    session_id: str,
) -> None:
    """Deactivate a session (logout)."""
    result = await db.execute(select(Session).where(Session.id == session_id))
    session = result.scalar_one_or_none()
    if session:
        session.is_active = False
        await db.flush()
