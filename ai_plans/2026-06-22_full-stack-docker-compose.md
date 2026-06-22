# Full self-hosted stack in one docker-compose (API + Authentik)

**Date:** 2026-06-22
**Scope:** `self-hosted-cloudapi/`

## Goal

Make the whole self-hosted cloud backend runnable with a single
`docker compose up` — including Authentik and its database — instead of running
Authentik separately (it lived in `/opt/docker/llm/docker-compose.yaml`).

## What was done

### 1. Merged the Authentik stack into the cloudapi compose

`docker-compose.yml` now defines `api`, `postgres` (API DB), and the bundled
Authentik: `auth_db`, `auth_redis`, `auth_server`, `auth_worker` — adapted from
the proven `/opt/docker/llm/docker-compose.yaml`. Changes vs. the source:

- Bind mounts under a local `./.vol/` folder (`postgres`, `auth/postgres`,
  `auth/redis`, `auth/data`, `auth/templates`, `auth/certs`) — mirroring the
  proven `/opt/docker/llm` layout. `.vol/` is git- and docker-ignored.
  Authentik mount paths kept as the known-good `/data`, `/templates`, `/certs`.
- Blueprint bind-mount `./authentik/blueprints:/blueprints/custom:ro` on server
    - worker; the worker auto-applies it.
- `api.depends_on` waits for `postgres` healthy **and** `auth_server` healthy
  (added Authentik's `ak healthcheck`).
- Dropped the host publish of the API `postgres` (was `5432:5432`) — nothing on
  the host needs it and `5432` collides with the local voicebot-database. It
  stays reachable in-network as `postgres:5432`. `auth_db` keeps `5544:5432`.
- Shared Authentik env via a YAML anchor (`&authentik_env` / `*authentik_env`).

### 2. Fixed the OAuth split-horizon (root cause)

`authentik_base_url` was used for both browser redirects and server-side httpx
calls. In one compose those need different hostnames:

- browser → `http://localhost:9000`
- api container → `http://auth_server:9000` (its own localhost is not Authentik)

**Proof it's safe:** the API mints its own `iss="rcc"` JWTs
([src/auth/static_token.py:21](../self-hosted-cloudapi/src/auth/static_token.py#L21))
and never validates Authentik's issuer against a fixed host, so a split hostname
does not break token validation.

**Fix (backward compatible):**

- `config/settings.py`: new optional `authentik_internal_url`.
- `config/auth.py`: `_front_channel_base()` (authorize, end-session, issuer) uses
  `authentik_base_url`; `_back_channel_base()` (token, userinfo, jwks, discovery)
  uses `authentik_internal_url or authentik_base_url`.

When `authentik_internal_url` is unset (every pre-existing deployment), behaviour
is identical to before.

### 3. Auto-provision the OAuth2 provider/app via blueprint

`authentik/blueprints/stork-code.yaml` creates the `stork-code` OAuth2 provider
(confidential, `client_id`/`client_secret`/redirect URI read from env via `!Env`,
scopes openid/email/profile via `!Find`, default authorization/invalidation flows
and self-signed signing key via `!Find`) and the bound application with
`slug: stork-code`. The api and the blueprint read the **same**
`AUTHENTIK_CLIENT_ID/SECRET`, so they stay in sync from one source of truth. No
manual Authentik clicking.

Schema authored against the pinned `AUTHENTIK_TAG=2026.2.2`; it is the
version-sensitive piece (redirect_uris + property_mappings format) and is flagged
as such in the README and the blueprint header.

### 4. `.env.example` + `README.md`

Added the Authentik-stack knobs (`AUTH_PG_PASS`, `AUTHENTIK_SECRET_KEY`,
`PG_DB/PG_USER`, `AUTHENTIK_TAG`, `COMPOSE_PORT_HTTP/HTTPS`, bootstrap admin) and
`AUTHENTIK_INTERNAL_URL`, with generation hints. README rewritten to the
one-command flow + a service/port table + front/back-channel and blueprint
troubleshooting notes.

## Verification

- Config getters: with `AUTHENTIK_INTERNAL_URL` set, `get_authentik_token_url()`
  uses `auth_server` while `get_authentik_authorize_url()` uses `localhost`; unset
  → both fall back to base. (see Verification run below)
- `uv run pytest` — existing suite stays green.
- `docker compose config` parses; `docker compose up -d` → all services healthy,
  `docker compose logs auth_worker` shows the blueprint applied; api back-channel
  reaches `http://auth_server:9000/.../.well-known/openid-configuration`;
  end-to-end sign-in works (browser → localhost:9000 → callback → session).

## Risks / follow-ups

- Blueprint schema may need a tweak for a different `AUTHENTIK_TAG`; the worker
  log / _System → Blueprints_ surfaces it immediately.
- TLS / production domains handled by the existing `API_BASE_URL` /
  `AUTHENTIK_BASE_URL` knobs; the split-URL change makes the domain case work too.
