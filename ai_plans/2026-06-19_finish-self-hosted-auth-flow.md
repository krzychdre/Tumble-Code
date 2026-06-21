# Finish the self-hosted Authentik auth flow (operational + persistence)

**Date:** 2026-06-19
**Branch:** `feature/self-hosted-cloud-backend`
**Goal (user's words):** "We're using Authentik. Run Authentik, set up the app and
user account, integrate with the server, and ensure a user can authenticate and
**stay authenticated until logoff** even after returning next day/week."

---

## What was already true (verified in code, not assumed)

The auth _code_ is complete; the gap is operational. Evidence:

- **Browser OAuth flow** — [browser.py](../self-hosted-cloudapi/src/routers/browser.py):
  PKCE → Authentik authorize → `/auth/clerk/callback` → user/session/ticket →
  HTML bounce to `vscode://`. Authentik's own access/refresh tokens are used once
  for `get_userinfo` and **never stored** → extension longevity does NOT depend on
  the Authentik session lasting.
- **Durable credential** — the extension trades the single-use ticket for a
  **client token** (opaque, SHA-256-hashed). `ClientToken.expires_at` is nullable
  and **never set** → never expires server-side
  ([user.py](../self-hosted-cloudapi/src/models/user.py)).
  `Session.expires_at` likewise never set; `is_active` flips to `False` only on
  explicit `/v1/client/sessions/{id}/remove` (logoff).
- **Short-lived JWT** — [jwt_issuer.py](../self-hosted-cloudapi/src/auth/jwt_issuer.py)
  `issue_session_token(expires_in=60)`. Re-minted on demand from the client token
  via `POST /v1/client/sessions/{id}/tokens`.
- **Client-side persistence** — [WebAuthService.ts:214](../packages/cloud/src/WebAuthService.ts#L214)
  stores `{clientToken, sessionId}` in VS Code `SecretStorage`, reloads on
  `initialize()`, and `refreshSession()` re-mints a JWT on a `RefreshTimer`.

**Conclusion:** "return next day/week, stay logged in until logoff" is already the
design. The only missing pieces are: Authentik is down, and the API isn't running.

## Environment findings

- Existing Authentik lives in compose project `llm` at
  `/opt/docker/llm/docker-compose.yaml`: `auth_db` (postgres:16-alpine),
  `auth_server`, `auth_worker` (goauthentik 2026.2.2). All **exited ~4 weeks ago**.
- Data survived on bind mounts: `/opt/docker/llm/vol/auth/{data,postgres,certs}`.
- `/opt/docker/llm/.env` still holds `AUTHENTIK_SECRET_KEY` (so existing encrypted
  DB rows stay decryptable — must NOT change it) and `AUTH_PG_PASS`.
- **Two problems with reviving as-is:**
    1. **No Redis** in the stack. Authentik requires Redis (Celery broker for the
       worker, cache, Channels layer). `auth_worker` exited **1** — consistent with a
       missing broker. Must add a `redis:alpine` service.
    2. **Port 5432 conflict.** `auth_db` maps host `5432:5432`, but the unrelated,
       currently-running `voicebot-database` holds host 5432.
- Cloud API config: [self-hosted-cloudapi/.env](../self-hosted-cloudapi/.env) →
  `DATABASE_URL=postgresql://authentik:…@localhost:5432/stork_code`,
  `AUTHENTIK_BASE_URL=http://localhost:9000`, `AUTHENTIK_APP_SLUG=stork-code`,
  `AUTHENTIK_CLIENT_ID=nLV79xyh…`, `AUTHENTIK_REDIRECT_URI=http://localhost:8085/auth/clerk/callback`,
  `API_BASE_URL=http://localhost:8085`. So the cloud API uses a **second database
  `stork_code`** on the same Authentik Postgres, connecting as user `authentik`.
- Free host ports: 5544, 9000, 9443, 6379, 8085.

## Decisions (from the user)

1. **Revive the existing `/opt/docker/llm` stack** (keep `stork-code` app + users) and
   **add the missing Redis**.
2. **Remap `auth_db` host port 5432 → 5544** (zero disruption to voicebot);
   point the cloud API `.env` at 5544. Authentik's internal `auth_db:5432`
   connection is over the compose network and unaffected.

## Plan

### 1. Edit `/opt/docker/llm/docker-compose.yaml`

- Add `auth_redis` (`redis:alpine`, healthcheck `redis-cli ping`, volume
  `./vol/auth/redis:/data`, restart unless-stopped, **no host port** — internal only).
- Add `AUTHENTIK_REDIS__HOST: auth_redis` to `auth_server` and `auth_worker` env.
- Add `auth_redis` (condition: service_healthy) to `depends_on` of server + worker.
- Change `auth_db` host port `"5432:5432"` → `"5544:5432"`.

### 2. Bring up the auth stack

`docker compose -f /opt/docker/llm/docker-compose.yaml up -d auth_db auth_redis auth_server auth_worker`

- Verify `auth_db` healthy, `auth_worker` stays up (no exit 1), `auth_server` logs
  show "Starting authentik server", `GET http://localhost:9000/-/health/ready/` → 200.

### 3. Verify/restore Authentik config

- Confirm an OAuth2 **Provider** exists whose client ID == `AUTHENTIK_CLIENT_ID`,
  with redirect URI `http://localhost:8085/auth/clerk/callback`, bound to an
  **Application** slug `stork-code`. Confirm scopes include `openid email profile`.
- Confirm at least one **user** exists (or create one + set a password).
- If the provider/app didn't survive, recreate it and sync `client_id`/`secret`
  into `self-hosted-cloudapi/.env`.

### 4. Wire + migrate the cloud API DB

- Update `self-hosted-cloudapi/.env` `DATABASE_URL` port `5432` → `5544`.
- Ensure database `stork_code` exists on the Authentik Postgres (create if missing:
  `CREATE DATABASE stork_code OWNER authentik;`).
- Run `uv run alembic upgrade head`.

### 5. Start the cloud API

- `uv run uvicorn src.main:app --host 0.0.0.0 --port 8085` (background).
- Smoke: `GET /` → `{"status":"ok"}`; auth routes mounted.

### 6. End-to-end + persistence verification

- Drive the OAuth flow (curl through authorize → callback, or the extension) to a
  ticket; `POST /v1/client/sign_ins` → capture client token + `created_session_id`;
  `POST /v1/client/sessions/{id}/tokens` → **200 + jwt** (the line that used to 404);
  `GET /v1/me` → 200.
- **Persistence proof:** with the same stored client token, re-call the tokens
  endpoint (simulating "next day" after the 60 s JWT expired) → fresh jwt, no
  re-login. Confirms client token + session never expire and the extension's
  `RefreshTimer` path works.

## Out of scope (tracked separately)

- Authentik groups → `org_id` mapping ([browser.py:281](../self-hosted-cloudapi/src/routers/browser.py#L281)).
  User did not ask for orgs; JWT simply omits `r.o`. Revisit only if org-scoped
  features are needed.
- Anthropic streaming SSE conversion, Google/xAI providers, marketplace org
  filtering, admin API — unrelated to the auth flow.

## Risk / rollback

- Compose edits are additive (Redis) + a host-port remap; revert the three hunks to
  restore the original file. The `voicebot` project is never touched.
- `AUTHENTIK_SECRET_KEY` is left unchanged → existing encrypted data stays readable.
- Cloud API `.env` change is a single port digit; revert to 5432 if 5544 is undesired.
