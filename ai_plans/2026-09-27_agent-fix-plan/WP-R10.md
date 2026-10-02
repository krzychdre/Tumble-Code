# WP-R10: Cloud auth cleanup - single-use OAuth state, purge dead rows, real web sign-out, session expiry

Status: ready
Effort: M      Risk: medium      Depends on: none (shares `tests/test_route_table.py` with WP-R9 and `docs/08-cloud.md` "Background work" with WP-R7; different lines)
Branch name: fix/r10-auth-cleanup      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

Make the OAuth state row single use (deleted when the callback reads it). Delete expired and used tickets, expired
OAuth states and expired client tokens in the existing background loop. Replace the GET-only `/app/logout`, which
only cleared the cookie, with a POST that deactivates the `Session` row; GET `/app/logout` becomes a page with the
sign-out button (it changes nothing). Refuse a web session whose `Session.expires_at` is in the past.

## 2. Why it matters (user-visible effect, 2-4 sentences)

"Sign out" in the web panel leaves the session valid: anyone holding a copy of the cookie (another browser
profile, a copied header, a stolen cookie) stays signed in for up to 30 days. OAuth states, tickets and client
tokens accumulate forever, and a used OAuth state could be replayed until it expires. A `Session.expires_at`, if
ever set, is ignored by the web panel.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `AGENTS.md`; `docs/architecture.md` "Do not touch", bullet "Cloud API".
- `self-hosted-cloudapi/src/services/auth_service.py`: `get_oauth_state`, `store_oauth_state`, `validate_ticket`,
  `validate_client_token`, `deactivate_session`.
- `self-hosted-cloudapi/src/models/user.py`: `Session`, `ClientToken`, `Ticket`;
  `self-hosted-cloudapi/src/models/oauth.py`: `AuthentikStateStore`.
- `self-hosted-cloudapi/src/routers/browser.py`: `web_logout`, `auth_callback`, `_templates`.
- `self-hosted-cloudapi/src/auth/web_session.py`: `_decode_cookie`, `resolve_web_user`, `get_web_user_optional`,
  `clear_session_cookie`, `COOKIE_NAME`.
- `self-hosted-cloudapi/src/services/retention_scheduler.py`: `run_retention_loop`.
- `self-hosted-cloudapi/src/middleware/csrf.py`: `cross_site_refusal` (protects every cookie-carrying POST,
  including the new POST `/app/logout`, by Origin/Referer).
- `self-hosted-cloudapi/src/web/templates/base.html` (the header's "Sign out" link),
  `src/web/templates/forbidden.html` (a minimal page extending base.html), `src/web/templating.py` (`templates`,
  which sets the `asset_v` global that base.html needs).
- Tests that patch `get_oauth_state` by name (they must keep working, so the function keeps its name):
  `tests/test_browser_auth.py`, `tests/test_auth_redirect_validation.py`, `tests/test_deployment_hygiene.py`,
  `tests/test_remote_access.py`.
- `tests/test_route_table.py`: `EXPECTED`, `test_overlapping_routes_keep_their_order`,
  `test_web_routes_keep_their_openapi_operations`.

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/services/auth_service.py`, imports (near line 8) and `get_oauth_state` (near line 201):

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
```

```python
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
```

`src/routers/browser.py`, imports (near line 24) and `web_logout` (near line 205):

```python
from src.auth.web_session import clear_session_cookie, cookie_should_be_secure, set_session_cookie
from src.services.auth_service import (
    store_oauth_state,
    get_oauth_state,
    get_or_create_user,
    create_session,
    create_ticket,
)
```

```python
@router.get("/app/logout")
async def web_logout(request: Request):
    """Clear the browser session cookie and return to the login page."""
    response = RedirectResponse(url="/app/login", status_code=303)
    clear_session_cookie(response, secure=cookie_should_be_secure(request))
    return response
```

`src/auth/web_session.py`, `resolve_web_user` (near line 94):

```python
    if not raw_cookie:
        return None

    data = _decode_cookie(raw_cookie)
    if not data:
        return None

    session_id = data.get("sid")
    if not session_id:
        return None

    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.is_active == True)  # noqa: E712
    )
```

`src/web/templates/base.html` (line 23):

```html
      <a class="btn ghost" href="/app/logout">Sign out</a>
```

`src/services/retention_scheduler.py`: `run_retention_loop` opens a session, runs `sweep_all_enabled`, commits,
logs and swallows errors, sleeps `retention_sweep_hours` (default 6) hours. The loop only runs when
`RETENTION_SWEEP_ENABLED` is true (default true, `config/settings.py`).

Nothing in `src/` ever deletes `tickets`, `authentik_state_store` or `client_tokens` rows, and nothing sets
`Session.expires_at` today (`create_session` leaves it NULL), so the expiry check is defensive.

## 5. Root cause / analysis

VERIFIED:
- `grep -rn "delete(" src` shows no delete of the three auth tables; `get_oauth_state` only selects.
- `/app/logout` is GET only and only clears the cookie; `deactivate_session` exists (used by the Clerk-compatible
  `POST /v1/client/sessions/{id}/remove`) but the web logout does not call it.
- `resolve_web_user` filters on `is_active` only.
- Only `base.html` links to `/app/logout` (grep of `src/web/templates`).
- `DELETE ... RETURNING` works on the test SQLite (3.45) with SQLAlchemy 2.0.54 and on PostgreSQL.
- Comparing `expires_at` columns with an aware UTC `datetime` works on SQLite (values are stored as naive UTC
  strings in the same format; the existing `get_oauth_state` already relies on this) - the new tests pass.
- The CSRF middleware refuses a cookie-carrying POST from a foreign Origin with 403 (new test
  `test_a_cross_site_logout_is_refused`).
- The new test module fails to import before the change (`purge_expired_auth_rows` missing); with the change all
  13 new tests pass, and the whole suite passes except the 2 pre-existing `test_metrics_characterization.py`
  failures. The route-table test needs the three edits in step 9 (checked: it fails without them).

Decisions (justify in the PR):
- GET `/app/logout` does NOT sign out: a GET can be triggered by a link, a prefetch or an `<img>` on another page
  (the CSRF middleware only checks non-GET methods). It renders `logout.html`: a sign-out button (POST form) when
  signed in, "You are signed out" with a sign-in link when not. Old bookmarks keep working.
- POST `/app/logout` redirects (303) to GET `/app/logout`, NOT to `/app/login`: `/app/login` goes straight to
  Authentik, whose own session is still alive, and would sign the browser in again immediately, which made the old
  "Sign out" look broken.
- POST deactivates by the Session id inside the signed cookie (`session_id_from_cookie`), without requiring the
  session to still be active or the user to exist: signing out an already-dead session is a harmless no-op.
- The OAuth state is consumed with one `DELETE ... RETURNING`, so two callbacks racing on the same state cannot
  both get it. The function keeps the name `get_oauth_state` because four test modules patch it by that name. It
  returns a detached `AuthentikStateStore` built from the returned row; callers only read
  `.auth_redirect` and `.code_verifier`.
- The purge runs in the retention loop (`run_cycle`), after the sweep, in its own session and try/except, so a
  failing sweep does not skip it. Consequence: with `RETENTION_SWEEP_ENABLED=false` the purge does not run either;
  document it.
- Purged: tickets expired OR used; OAuth states expired; client tokens with a non-NULL `expires_at` in the past.
  Kept: client tokens with NULL `expires_at` (issued before expiry existed, or `CLIENT_TOKEN_IDLE_DAYS=0`), and all
  `sessions` rows.
- Session expiry is checked in `resolve_web_user` (web panel and the socket.io browser handshake). NOT added to
  `validate_client_token` (extension path) in this WP; mention as a follow-up.

HYPOTHESIS: none that blocks the work.

## 6. Step-by-step changes

Step 1. `self-hosted-cloudapi/src/services/auth_service.py`.

1a. Find:

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
```

Replace with:

```python
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, or_, select
```

1b. Replace the whole `get_oauth_state` function quoted in section 4 with (this also adds
`purge_expired_auth_rows` right after it; `deactivate_session` stays below, unchanged):

```python
async def get_oauth_state(
    db: AsyncSession,
    state: str,
) -> Optional[AuthentikStateStore]:
    """Consume an unexpired OAuth state: return it and delete its row.

    Single use, like the authorization code it guards: a replayed callback
    finds nothing. One ``DELETE ... RETURNING`` statement, so two callbacks
    racing on the same state cannot both get it. The returned object is a
    detached copy (never added to the session); callers only read it.
    """
    result = await db.execute(
        delete(AuthentikStateStore)
        .where(
            AuthentikStateStore.state == state,
            AuthentikStateStore.expires_at > datetime.now(timezone.utc),
        )
        .returning(
            AuthentikStateStore.state,
            AuthentikStateStore.auth_redirect,
            AuthentikStateStore.code_verifier,
            AuthentikStateStore.expires_at,
        )
        .execution_options(synchronize_session=False)
    )
    row = result.one_or_none()
    if row is None:
        return None
    return AuthentikStateStore(
        state=row.state,
        auth_redirect=row.auth_redirect,
        code_verifier=row.code_verifier,
        expires_at=row.expires_at,
    )


async def purge_expired_auth_rows(
    db: AsyncSession,
    now: Optional[datetime] = None,
) -> dict[str, int]:
    """Delete sign-in rows that can never be used again. Returns counts.

    * tickets past ``expires_at``, or already used (single use);
    * OAuth states past ``expires_at`` (a used one is deleted on use);
    * client tokens past ``expires_at``. A token with no expiry (issued
      before expiry existed, or ``CLIENT_TOKEN_IDLE_DAYS=0``) is kept.

    Sessions are not touched: a Session row is what a web cookie and the
    audit of who signed in point at. Run by the background loop in
    services/retention_scheduler.py.
    """
    now = now or datetime.now(timezone.utc)
    no_sync = {"synchronize_session": False}
    tickets = await db.execute(
        delete(Ticket)
        .where(or_(Ticket.expires_at < now, Ticket.used.is_(True)))
        .execution_options(**no_sync)
    )
    states = await db.execute(
        delete(AuthentikStateStore)
        .where(AuthentikStateStore.expires_at < now)
        .execution_options(**no_sync)
    )
    tokens = await db.execute(
        delete(ClientToken)
        .where(ClientToken.expires_at.is_not(None), ClientToken.expires_at < now)
        .execution_options(**no_sync)
    )
    return {
        "tickets": tickets.rowcount,
        "oauth_states": states.rowcount,
        "client_tokens": tokens.rowcount,
    }
```

Step 2. `self-hosted-cloudapi/src/services/retention_scheduler.py`.

2a. Find:

```python
from src.database import async_session_factory
from src.services.retention_service import sweep_all_enabled
```

Replace with:

```python
from src.database import async_session_factory
from src.services.auth_service import purge_expired_auth_rows
from src.services.retention_service import sweep_all_enabled
```

2b. Delete everything from the line `async def run_retention_loop() -> None:` to the end of the file, and put this
in its place (note: the original comment line "Logged and swallowed on purpose ... see the module docstring."
contains a non-ASCII dash; the replacement uses a plain hyphen, which is fine):

```python
async def run_cycle(session_factory=async_session_factory) -> None:
    """One pass: every enabled retention policy, then the dead sign-in rows.

    Each step has its own session and commit, and a failure in one is logged
    and does not skip the other. ``session_factory`` is a parameter so tests
    can run a cycle against their own database.
    """
    try:
        async with session_factory() as db:
            count = await sweep_all_enabled(db)
            await db.commit()
        if count:
            logger.info("[retention] swept %s enabled polic(ies)", count)
    except asyncio.CancelledError:
        raise
    except Exception:
        # Logged and swallowed on purpose - see the module docstring.
        logger.exception("[retention] sweep cycle failed; will retry next interval")

    try:
        async with session_factory() as db:
            purged = await purge_expired_auth_rows(db)
            await db.commit()
        if any(purged.values()):
            logger.info("[auth-cleanup] removed expired sign-in rows: %s", purged)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("[auth-cleanup] purge failed; will retry next interval")


async def run_retention_loop() -> None:
    """Run a cycle (retention sweep, then auth cleanup), then sleep, forever."""
    interval = max(1, settings.retention_sweep_hours) * 3600

    # Never on the very first tick: startup is when the schema is being
    # reconciled and the first requests are arriving, and a sweep is not urgent.
    await asyncio.sleep(interval)

    while True:
        await run_cycle()
        await asyncio.sleep(interval)
```

2c. In the module docstring of the same file, find the line
`Two properties matter here and are deliberate:` and insert ABOVE it this paragraph (then a blank line):

```
Each cycle also deletes sign-in rows that can never be used again (expired or
used tickets, expired OAuth states, expired client tokens), see
``auth_service.purge_expired_auth_rows``. It runs only when the loop runs, i.e.
with ``RETENTION_SWEEP_ENABLED`` on (the default).
```

Step 3. `self-hosted-cloudapi/src/auth/web_session.py`.

3a. Find `from typing import Optional, TypedDict` and replace with:

```python
from datetime import datetime, timezone
from typing import Optional, TypedDict
```

3b. Find `from sqlalchemy import select` and replace with `from sqlalchemy import or_, select`.

3c. Find `async def resolve_web_user(raw_cookie: Optional[str], db: AsyncSession) -> Optional[WebUser]:` and insert
directly ABOVE it (then two blank lines):

```python
def session_id_from_cookie(raw_cookie: Optional[str]) -> Optional[str]:
    """The Session id a validly signed, unexpired cookie names, or None.

    Says nothing about whether that Session is still active; see
    ``resolve_web_user`` for that.
    """
    if not raw_cookie:
        return None
    data = _decode_cookie(raw_cookie)
    if not data:
        return None
    return data.get("sid") or None
```

3d. Find (inside `resolve_web_user`; the docstring's first line, which contains a non-ASCII arrow, is NOT part of
this snippet and stays as it is):

```python
    handshake, which reads the cookie from the ASGI environ rather than from a
    FastAPI Request. Returns None for missing/invalid/expired cookies,
    deactivated sessions, or a user that no longer exists.
    """
    if not raw_cookie:
        return None

    data = _decode_cookie(raw_cookie)
    if not data:
        return None

    session_id = data.get("sid")
    if not session_id:
        return None

    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.is_active == True)  # noqa: E712
    )
```

Replace with:

```python
    handshake, which reads the cookie from the ASGI environ rather than from a
    FastAPI Request. Returns None for missing/invalid/expired cookies,
    deactivated or expired sessions (``Session.expires_at`` in the past; NULL
    means no expiry), or a user that no longer exists.
    """
    session_id = session_id_from_cookie(raw_cookie)
    if not session_id:
        return None

    result = await db.execute(
        select(Session).where(
            Session.id == session_id,
            Session.is_active == True,  # noqa: E712
            or_(Session.expires_at.is_(None), Session.expires_at > datetime.now(timezone.utc)),
        )
    )
```

Step 4. `self-hosted-cloudapi/src/routers/browser.py`.

4a. Replace the import block quoted in section 4 (from
`from src.auth.web_session import clear_session_cookie, cookie_should_be_secure, set_session_cookie` to the
closing `)` of the `auth_service` import) with:

```python
from src.auth.web_session import (
    COOKIE_NAME,
    WebUser,
    clear_session_cookie,
    cookie_should_be_secure,
    get_web_user_optional,
    session_id_from_cookie,
    set_session_cookie,
)
from src.services.auth_service import (
    store_oauth_state,
    get_oauth_state,
    get_or_create_user,
    create_session,
    create_ticket,
    deactivate_session,
)
from src.web.templating import templates as _panel_templates
```

(`Optional`, `Depends`, `Request`, `HTMLResponse`, `RedirectResponse`, `AsyncSession` and `get_db` are already
imported in this module. `_panel_templates` is needed because `logout.html` extends `base.html`, which reads the
`asset_v` global that only `src.web.templating.templates` defines; the module's own `_templates` does not.)

4b. Replace the whole `web_logout` function quoted in section 4 with:

```python
@router.get("/app/logout", response_class=HTMLResponse)
async def web_logout(
    request: Request,
    user: Optional[WebUser] = Depends(get_web_user_optional),
):
    """The sign-out page. Changes nothing: signing out is the POST below.

    A GET must not end a session (a link, a prefetch or an <img> on another
    page could), so an old bookmark of this URL lands on a page with the
    sign-out button, or on "You are signed out" once the session is gone.
    """
    return _panel_templates.TemplateResponse(
        request,
        "logout.html",
        {"user": user, "hide_sign_in": False},
    )


@router.post("/app/logout")
async def web_logout_post(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Sign out: deactivate the cookie's Session row, then clear the cookie.

    Deactivating is what makes it a sign-out: clearing the cookie alone left
    the session valid for anyone holding a copy of the cookie. Guarded against
    other sites by the CSRF origin check (middleware/csrf.py). Lands on the
    GET page ("You are signed out") rather than /app/login, which would go
    straight back through Authentik and sign the browser in again.
    """
    session_id = session_id_from_cookie(request.cookies.get(COOKIE_NAME))
    if session_id:
        await deactivate_session(db, session_id)
    response = RedirectResponse(url="/app/logout", status_code=303)
    clear_session_cookie(response, secure=cookie_should_be_secure(request))
    return response
```

Step 5. `self-hosted-cloudapi/src/web/templates/base.html`. Find:

```html
      <a class="btn ghost" href="/app/logout">Sign out</a>
```

Replace with:

```html
      <form method="post" action="/app/logout" class="signout-form">
        <button class="btn ghost" type="submit">Sign out</button>
      </form>
```

Step 6. New file `self-hosted-cloudapi/src/web/templates/logout.html` (`&middot;` renders the same middle dot the
other page titles use):

```html
{% extends "base.html" %}
{% block title %}Sign out &middot; Tumble Code{% endblock %}
{% block content %}
<div class="empty">
  {% if user %}
    <h1 class="page-title">Sign out of Tumble Code Cloud?</h1>
    <p class="empty-hint">Signed in as {{ user.email }}.</p>
    <form method="post" action="/app/logout" class="signout-form">
      <button class="btn" type="submit">Sign out</button>
    </form>
  {% else %}
    <h1 class="page-title">You are signed out</h1>
    <p class="empty-hint"><a href="/app/login">Sign in again</a></p>
  {% endif %}
</div>
{% endblock %}
```

Step 7. `self-hosted-cloudapi/src/web/static/app.css`. Find (unique):

```css
.btn:disabled {
	opacity: 0.4;
	cursor: not-allowed;
}
```

and add directly after it (tabs for indentation, like the rest of the file):

```css
/* The header's "Sign out" is a POST form; keep it inline in the topbar. */
.signout-form {
	display: inline-flex;
	margin: 0;
}
```

Step 8. Docs.
- `docs/08-cloud.md`, section "### Background work": after the paragraph about `retention_scheduler.py` add the
  sentence: "Each cycle also deletes expired or used tickets, expired OAuth states and expired client tokens
  (`auth_service.purge_expired_auth_rows`)."
- `self-hosted-cloudapi/README.md`, list "### Browser Auth Flow": add two lines at its end:
  ```
  - `GET /app/logout` - Sign-out page (shows the sign-out button; changes nothing)
  - `POST /app/logout` - Sign out of the web panel (deactivates the session, clears the cookie)
  ```

Step 9. `self-hosted-cloudapi/tests/test_route_table.py` (three edits).

9a. In `EXPECTED`, find `    ("/app/logout", ("GET",), "web_logout", "APIRoute"),` and add below it:

```python
    ("/app/logout", ("POST",), "web_logout_post", "APIRoute"),
```

9b. In `test_overlapping_routes_keep_their_order`, find:

```python
    assert overlaps == [
        ("task_detail", "bulk_delete_tasks"),
```

Replace with:

```python
    assert overlaps == [
        ("web_logout", "web_logout_post"),
        ("task_detail", "bulk_delete_tasks"),
```

9c. In `test_web_routes_keep_their_openapi_operations`, find:

```python
        ("/app/logout", "get"): ("web_logout_app_logout_get", ("browser-auth",), json_, ()),
```

Replace with:

```python
        ("/app/logout", "get"): ("web_logout_app_logout_get", ("browser-auth",), html, ()),
        ("/app/logout", "post"): ("web_logout_post_app_logout_post", ("browser-auth",), json_, ()),
```

## 7. Tests to add or change

New file `self-hosted-cloudapi/tests/test_auth_cleanup.py` (service + router level on SQLite; lowest layers that
show each behavior):

```python
"""Sign-in leftovers are removed and a web sign-out ends the session (R10).

* An OAuth state row is single use: the callback consumes it.
* Expired tickets, used tickets, expired OAuth states and expired client
  tokens are deleted by the background loop (retention_scheduler.run_cycle).
* POST /app/logout deactivates the Session row, not just the cookie; GET
  /app/logout only shows a page (a link or an <img> must not sign anybody out).
* A Session past its ``expires_at`` no longer signs a browser in.
"""

from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from src.auth.web_session import COOKIE_NAME, _serializer, resolve_web_user
from src.database import get_db
from src.main import app
from src.models.oauth import AuthentikStateStore
from src.models.user import ClientToken, Session, Ticket, User
from src.services import retention_scheduler
from src.services.auth_service import get_oauth_state, purge_expired_auth_rows, store_oauth_state

NOW = datetime.now(timezone.utc)


async def _user_and_session(db_session, *, expires_at=None, session_id="sess_r10") -> None:
    db_session.add(User(id="user_r10", authentik_id="ak_r10", email="r10@example.com"))
    await db_session.flush()
    db_session.add(Session(id=session_id, user_id="user_r10", is_active=True, expires_at=expires_at))
    await db_session.commit()


async def _is_active(session_factory, session_id="sess_r10") -> bool:
    async with session_factory() as s:
        return bool(
            (await s.execute(select(Session.is_active).where(Session.id == session_id))).scalar_one()
        )


def _web_client(session_factory, session_id="sess_r10") -> TestClient:
    async def override_get_db():
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_get_db
    client = TestClient(app, follow_redirects=False)
    client.cookies.set(COOKIE_NAME, _serializer.dumps({"sid": session_id, "uid": "user_r10"}))
    return client


# --- OAuth state ----------------------------------------------------------------


async def test_oauth_state_is_consumed_on_use(session_factory):
    async with session_factory() as s:
        await store_oauth_state(s, "state-once", "web:/app", "verifier")
        await s.commit()

    async with session_factory() as s:
        first = await get_oauth_state(s, "state-once")
        await s.commit()
    async with session_factory() as s:
        second = await get_oauth_state(s, "state-once")

    assert first is not None
    assert (first.auth_redirect, first.code_verifier) == ("web:/app", "verifier")
    assert second is None
    async with session_factory() as s:
        assert (await s.execute(select(AuthentikStateStore))).first() is None


async def test_an_expired_oauth_state_is_refused(session_factory):
    async with session_factory() as s:
        s.add(
            AuthentikStateStore(
                state="state-old",
                auth_redirect="web:/app",
                code_verifier="v",
                expires_at=NOW - timedelta(minutes=1),
            )
        )
        await s.commit()

    async with session_factory() as s:
        assert await get_oauth_state(s, "state-old") is None


# --- Purge ------------------------------------------------------------------------


async def _seed_auth_rows(db_session):
    await _user_and_session(db_session)
    past, future = NOW - timedelta(hours=1), NOW + timedelta(hours=1)
    db_session.add_all(
        [
            Ticket(code="t-expired", session_id="sess_r10", expires_at=past, used=False),
            Ticket(code="t-used", session_id="sess_r10", expires_at=future, used=True),
            Ticket(code="t-live", session_id="sess_r10", expires_at=future, used=False),
            AuthentikStateStore(state="s-expired", auth_redirect="web:/app", code_verifier="v", expires_at=past),
            AuthentikStateStore(state="s-live", auth_redirect="web:/app", code_verifier="v", expires_at=future),
            ClientToken(id="ct_expired", session_id="sess_r10", token_hash="h1", expires_at=past),
            ClientToken(id="ct_live", session_id="sess_r10", token_hash="h2", expires_at=future),
            # Issued before expiry existed (or CLIENT_TOKEN_IDLE_DAYS=0): never expires.
            ClientToken(id="ct_no_expiry", session_id="sess_r10", token_hash="h3", expires_at=None),
        ]
    )
    await db_session.commit()


async def _remaining(session_factory):
    async with session_factory() as s:
        return (
            set((await s.execute(select(Ticket.code))).scalars()),
            set((await s.execute(select(AuthentikStateStore.state))).scalars()),
            set((await s.execute(select(ClientToken.id))).scalars()),
        )


async def test_purge_removes_only_dead_rows(session_factory, db_session):
    await _seed_auth_rows(db_session)

    async with session_factory() as s:
        counts = await purge_expired_auth_rows(s)
        await s.commit()

    assert counts == {"tickets": 2, "oauth_states": 1, "client_tokens": 1}
    tickets, states, tokens = await _remaining(session_factory)
    assert tickets == {"t-live"}
    assert states == {"s-live"}
    assert tokens == {"ct_live", "ct_no_expiry"}


async def test_the_background_cycle_purges_auth_rows(session_factory, db_session):
    await _seed_auth_rows(db_session)

    await retention_scheduler.run_cycle(session_factory)

    tickets, states, tokens = await _remaining(session_factory)
    assert tickets == {"t-live"}
    assert states == {"s-live"}
    assert tokens == {"ct_live", "ct_no_expiry"}


async def test_a_failing_sweep_does_not_skip_the_purge(session_factory, db_session, monkeypatch):
    await _seed_auth_rows(db_session)

    async def broken_sweep(db, now=None):
        raise RuntimeError("injected")

    monkeypatch.setattr(retention_scheduler, "sweep_all_enabled", broken_sweep)

    await retention_scheduler.run_cycle(session_factory)

    tickets, _, _ = await _remaining(session_factory)
    assert tickets == {"t-live"}


# --- Session expiry -----------------------------------------------------------------


async def test_an_expired_session_does_not_sign_a_browser_in(session_factory, db_session):
    await _user_and_session(db_session, expires_at=NOW - timedelta(minutes=1))
    cookie = _serializer.dumps({"sid": "sess_r10", "uid": "user_r10"})

    async with session_factory() as s:
        assert await resolve_web_user(cookie, s) is None


async def test_a_session_before_its_expiry_still_signs_in(session_factory, db_session):
    await _user_and_session(db_session, expires_at=NOW + timedelta(days=1))
    cookie = _serializer.dumps({"sid": "sess_r10", "uid": "user_r10"})

    async with session_factory() as s:
        user = await resolve_web_user(cookie, s)

    assert user is not None and user["session_id"] == "sess_r10"


# --- Logout ------------------------------------------------------------------------


async def test_post_logout_deactivates_the_session_and_clears_the_cookie(session_factory, db_session):
    await _user_and_session(db_session)
    client = _web_client(session_factory)
    try:
        resp = client.post("/app/logout")
        after = client.get("/app")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert resp.status_code == 303
    assert resp.headers["location"] == "/app/logout"
    assert f'{COOKIE_NAME}=""' in resp.headers["set-cookie"]
    assert not await _is_active(session_factory)
    # The cookie jar dropped the cookie; the old value would not work either.
    assert after.status_code == 303 and after.headers["location"] == "/app/login"


async def test_a_replayed_cookie_is_dead_after_logout(session_factory, db_session):
    await _user_and_session(db_session)
    cookie = _serializer.dumps({"sid": "sess_r10", "uid": "user_r10"})
    client = _web_client(session_factory)
    try:
        client.post("/app/logout")
        client.cookies.set(COOKIE_NAME, cookie)
        replay = client.get("/app")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert replay.status_code == 303 and replay.headers["location"] == "/app/login"


async def test_get_logout_only_shows_the_sign_out_form(session_factory, db_session):
    await _user_and_session(db_session)
    client = _web_client(session_factory)
    try:
        resp = client.get("/app/logout")
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert resp.status_code == 200
    assert 'action="/app/logout"' in resp.text and 'method="post"' in resp.text
    assert await _is_active(session_factory)


async def test_get_logout_without_a_session_says_signed_out(client):
    resp = client.get("/app/logout", follow_redirects=False)

    assert resp.status_code == 200
    assert "You are signed out" in resp.text


async def test_a_cross_site_logout_is_refused(session_factory, db_session):
    await _user_and_session(db_session)
    client = _web_client(session_factory)
    try:
        resp = client.post("/app/logout", headers={"origin": "http://evil.example"})
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert resp.status_code == 403
    assert await _is_active(session_factory)


def test_the_header_signs_out_with_a_post_form():
    from pathlib import Path

    base = (Path(__file__).resolve().parent.parent / "src" / "web" / "templates" / "base.html").read_text()

    assert '<form method="post" action="/app/logout"' in base
    assert 'href="/app/logout"' not in base
```

Why they fail without the fix: the module does not import (`purge_expired_auth_rows`, `run_cycle` missing).
Behaviorally, before the change: the state is returned twice; nothing is purged; an expired session resolves to a
user; POST `/app/logout` is 405; GET `/app/logout` redirects (303) instead of rendering a page; base.html has the
`href` link.

Changed: `tests/test_route_table.py` (step 9).

## 8. Commands to run (exact, from which directory) and the expected result

All from `self-hosted-cloudapi/`:

1. `uv sync --frozen --extra dev`.
2. Add `tests/test_auth_cleanup.py` only: `uv run pytest -q tests/test_auth_cleanup.py` -> collection error.
3. Apply steps 1-7 and 9: `uv run pytest -q tests/test_auth_cleanup.py tests/test_route_table.py` -> all pass
   (13 + 4).
4. Wider (everything touching sign-in, cookies, CSRF, the panel):
   `uv run pytest -q tests/test_browser_auth.py tests/test_auth_redirect_validation.py tests/test_deployment_hygiene.py tests/test_remote_access.py tests/test_sign_in_flow.py tests/test_csrf.py tests/test_route_boilerplate.py tests/test_bridge.py tests/test_phone_layout.py tests/test_web_settings.py`
   -> all pass.
5. Whole suite: `uv run pytest` -> all pass except the two pre-existing `tests/test_metrics_characterization.py`
   failures (present on untouched main).
6. `make lint` -> "All checks passed!".
7. Type check / eslint / prettier: not applicable.
8. Manual check (optional, needs the stack): sign in to `/app`, click "Sign out", land on "You are signed out";
   `docker compose exec postgres psql -U roo roo_cloud -c "select id, is_active from sessions order by created_at desc limit 3;"`
   shows the session `f`.

## 9. Do not touch / pitfalls

- Keep the function name `get_oauth_state` (tests patch `src.routers.browser.get_oauth_state`).
- Do not delete the state row BEFORE the checks in `auth_callback` in a separate statement; the single
  `DELETE ... RETURNING` in `get_oauth_state` is the consume step. The callback's early returns are
  `HTMLResponse`s, not exceptions, so `get_db` commits and the state stays consumed (intended: a state is single
  use even when the sign-in fails; the user starts again).
- Do not purge `sessions`, and do not purge client tokens with NULL `expires_at`.
- The CSRF middleware must keep covering POST `/app/logout`; do not exempt it.
- `WEB_ALLOWED_NETWORKS` gating (`WebAccessMiddleware`) covers everything under `/app`, including both logout
  routes; do not move them out of `/app`.
- `hide_sign_in` is passed as False so the signed-out page shows the header's "Sign in" button.
- Do-not-touch Cloud API contracts (monotonic upsert, `response_model_exclude_none=True`, share 404, `/bridge`
  path, bootstrap classification, SQLite tests, summary columns) are not affected; do not change them.
- The retention loop's first run is `retention_sweep_hours` after startup; the purge inherits that. Do not add a
  run at startup.
- `tests/test_route_table.py` is also edited by WP-R9 (a `/health/ready` line at the end of `EXPECTED`); if both
  branches are open, rebase the second one and keep both lines.

## 10. Acceptance checklist (checkboxes)

- [ ] `get_oauth_state` consumes the row with `DELETE ... RETURNING`; second call returns None.
- [ ] `purge_expired_auth_rows` deletes expired/used tickets, expired states, expired client tokens; returns counts.
- [ ] `retention_scheduler.run_cycle(session_factory)` runs the sweep, then the purge, each isolated; the loop
      calls `run_cycle()`.
- [ ] `resolve_web_user` refuses a session with `expires_at` in the past; NULL still means no expiry.
- [ ] POST `/app/logout` deactivates the session, clears the cookie, 303 to `/app/logout`; foreign Origin -> 403.
- [ ] GET `/app/logout` renders `logout.html` and changes nothing.
- [ ] Header uses a POST form; CSS keeps it inline.
- [ ] Route table test updated; new tests pass; no new failures; `make lint` passes.
- [ ] Docs updated; `ai_plans/` note added.

## 11. Commit, changeset and PR text

- Commit title: `fix(cloudapi): single-use OAuth state, purge dead sign-in rows, real web sign-out (R10)`
- Commit body:
  ```
  The web panel's Sign out was a GET that only cleared the cookie, so the
  session stayed valid for anyone holding a copy of it. POST /app/logout
  now deactivates the Session row and clears the cookie; GET /app/logout
  only shows the sign-out page, so a link or an <img> cannot sign anybody
  out. The header's Sign out is a POST form (covered by the CSRF origin
  check).

  The OAuth state is consumed by the callback (DELETE ... RETURNING), and
  the retention loop now also deletes expired or used tickets, expired OAuth
  states and expired client tokens, which were never removed. A web session
  past Session.expires_at is refused.

  Tests: tests/test_auth_cleanup.py; route table updated for the new route.
  ```
  End with the attribution lines the session requires.
- Changeset: none (cloud API only).
- `ai_plans/<today as YYYY-MM-DD>_cloud-auth-cleanup.md`: title "Cloud: auth cleanup (R10)", Status, Touched files
  (auth_service, retention_scheduler, web_session, routers/browser, base.html, logout.html, app.css, route table
  test, new test file, docs), Problem, Change, Decisions (GET logout renders a page; POST lands on the signed-out
  page, not /app/login; purge tied to the retention loop), Tests, Follow-up (check `Session.expires_at` in
  `validate_client_token` too; nothing sets `expires_at` yet).
- PR body outline: Problem, Change, Decisions with reasons, Tests, Manual check (section 8 item 8), Pre-existing
  failures. End with the PR attribution line.

## 12. If stuck

- If `DELETE ... RETURNING` fails on SQLite, report the error and `sqlite3.sqlite_version`; do not replace it with
  select-then-delete without reporting.
- If `tests/test_route_table.py::test_overlapping_routes_keep_their_order` reports a different order, paste the
  actual list into the report; do not reorder router registration in `src/main.py`.
- If a test that patches `get_oauth_state` breaks, report which one and why; do not rename the function.
