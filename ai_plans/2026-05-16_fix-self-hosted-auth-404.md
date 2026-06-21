# Fix self-hosted Clerk sign-in returning a session id the client cannot use

**Date:** 2026-05-16
**Branch:** `feature/self-hosted-cloud-backend`
**Scope:** `self-hosted-cloudapi/` only — no extension/TypeScript changes.

---

## Symptom

After a successful Authentik login, the VS Code extension receives the ticket,
calls `POST /v1/client/sign_ins`, then calls
`POST /v1/client/sessions/{sess_id}/tokens` to mint its first JWT — and the
self-hosted API responds:

```
INFO: 127.0.0.1:59596 - "POST /v1/client/sessions/sess_b4b99562f7cc4c34976f32420/tokens HTTP/1.1" 404 Not Found
```

Recorded in [spotted-errors/self-hosted-cloud.md](../spotted-errors/self-hosted-cloud.md).
This breaks the entire sign-in flow: the extension never gets a session JWT, so
no authenticated requests can succeed.

## Root cause

The current sign-in handler issues a Bearer token that does **not** belong to
the session id it returns in the body:

```python
# self-hosted-cloudapi/src/routers/auth.py:53-67
session = await validate_ticket(db, ticket)            # returns session_A (from ticket)
...
_, raw_token = await create_session_and_token(db, session.user_id)  # creates session_B + token_B
body, auth_header_value = format_sign_in_response(session.id, raw_token)
                                              # ^ session_A.id   ^ token_B (belongs to session_B)
```

The client stores `created_session_id = session_A.id` and the
`Authorization: Bearer token_B` from the response header, then calls
`POST /v1/client/sessions/{session_A.id}/tokens` with `Bearer token_B`.
On the server:

```python
# self-hosted-cloudapi/src/routers/auth.py:92-103
session = await validate_client_token(db, raw_token)  # token_B → session_B
if session.id != session_id:                          # session_B.id != session_A.id
    raise HTTPException(404, "Session not found")
```

→ **404**.

Secondary observation: [browser.py:272](../self-hosted-cloudapi/src/routers/browser.py#L272)
already calls `create_session_and_token(db, user.id)` during the OAuth callback,
producing a third client token that is hashed into the DB and never returned
to anyone (the raw form is gone the moment the function returns). That token is
unrecoverable dead weight.

## Architectural intent (from the plan)

[ai_plans/self-hosted-cloud-api-architecture.md §3.1](self-hosted-cloud-api-architecture.md):
the **ticket** is the single thread that ties browser-side auth to
extension-side auth. The session is created at OAuth callback, the ticket maps
to it, and at `/v1/client/sign_ins` time the server returns:

- body: `created_session_id` = **the session the ticket points to**
- header: `Authorization: Bearer <clientToken bound to that same session>`

We need exactly one session per sign-in, and the client token must belong to it.

## Fix

Split token issuance from session creation, and bind the sign-in token to the
ticket's session.

### Code changes

1. **`src/services/auth_service.py` — add `create_client_token`**, refactor
   `create_session_and_token` to compose it:

    ```python
    async def create_client_token(db, session_id) -> tuple[ClientToken, str]:
        raw_token = secrets.token_urlsafe(48)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()
        ct = ClientToken(session_id=session_id, token_hash=token_hash)
        db.add(ct); await db.flush()
        return ct, raw_token

    async def create_session_and_token(db, user_id):
        session = Session(user_id=user_id); db.add(session); await db.flush()
        _, raw_token = await create_client_token(db, session.id)
        return session, raw_token
    ```

2. **`src/routers/auth.py:53-67` — bind token to ticket's session**, drop the
   stray session:

    ```python
    session = await validate_ticket(db, ticket)
    if session is None:
        raise HTTPException(401, "Invalid or expired ticket")
    _, raw_token = await create_client_token(db, session.id)
    body, auth_header_value = format_sign_in_response(session.id, raw_token)
    ```

3. **`src/routers/browser.py:272` — stop creating an unused client token at
   callback**. The OAuth callback only needs to persist the session so the
   ticket can point to it; the client token will be created at `sign_ins` time.
   Replace `create_session_and_token(db, user.id)` with a new
   `create_session(db, user.id) -> Session` helper. (Tiny refactor; keeps the
   ticket model unchanged.)

### No DB migration needed

Schema is unchanged. Only the lifecycle of `client_tokens` rows shifts: one row
per successful sign-in instead of two (one stillborn at callback + one at
sign-in).

## Test plan

Add `tests/test_sign_in_flow.py` — the first integration test that exercises
the post-OAuth path end-to-end against the in-memory SQLite from `conftest.py`.
Needs a `get_db` dependency override so `TestClient` shares the fixture's
session.

Cases:

1. **Happy path** (the regression test for this bug):

    - Seed a `User`, a `Session`, and a `Ticket(code=…, session_id=session.id)`.
    - `POST /v1/client/sign_ins` with `strategy=ticket&ticket=<code>`.
    - Assert `response.json()["response"]["created_session_id"] == session.id`.
    - Capture `Authorization` header → `raw_token`.
    - `POST /v1/client/sessions/{session.id}/tokens` with
      `Authorization: Bearer <raw_token>` and `_is_native=1`.
    - Assert **200** (this is the line that was 404).
    - Assert `response.json()["jwt"]` is a non-empty string that decodes with
      the configured JWT verifier and has `r.u == user.id`.

2. **Token-not-bound-to-session guard**:

    - Sign in for `session_A`, capture `token_A`.
    - Manually create a second `Session` (`session_B`) for the same user.
    - `POST /v1/client/sessions/{session_B.id}/tokens` with `Bearer token_A`.
    - Assert 404 — the existing cross-session guard must still hold.

3. **Ticket single-use**:

    - Sign in once with a ticket; assert 200.
    - Sign in again with the same ticket; assert 401 (`validate_ticket` flips
      `used = True`).

4. **`/v1/me` after sign-in** (proves the chain works end-to-end):
    - After case 1, `GET /v1/me` with `Authorization: Bearer <raw_token>`.
    - Assert 200 and `response.json()["response"]["id"] == user.id`.

Keep the existing `test_auth.py` unit tests as-is; they cover the 401 paths.

## Risk and rollback

- Behavior change is strictly additive for happy path (404 → 200) and
  removes one unused DB row per sign-in.
- If browser-side flow regresses (unlikely — the callback no longer needs the
  raw token), revert the single callback hunk; the auth.py + auth_service.py
  changes are independent and safe to keep.

## Out of scope

- Anthropic streaming SSE conversion ([anthropic.py:114-125](../self-hosted-cloudapi/src/proxy/providers/anthropic.py#L114-L125)).
- Authentik groups → `org_id` mapping ([browser.py:278](../self-hosted-cloudapi/src/routers/browser.py#L278)).
- Marketplace org filtering, Google/xAI providers, alembic-as-source-of-truth.
  Tracked separately.
