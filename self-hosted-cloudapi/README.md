# Self-Hosted Roo Code Cloud API

A self-hosted replacement for the Roo Code Cloud API, compatible with the existing Roo Code VS Code extension.

## Quick Start

### Running the full stack with Docker Compose (recommended)

`docker compose up` brings up **everything**: this API and its Postgres, plus a
bundled **Authentik** (server, worker, Postgres, Redis). The Authentik OAuth2
provider and application are **auto-provisioned from a blueprint**
([`authentik/blueprints/tumble-code.yaml`](authentik/blueprints/tumble-code.yaml)),
so there is no manual Authentik OAuth setup.

```bash
cp .env.example .env

# Fill in the REQUIRED secrets in .env:
#   SECRET_KEY, JWT_SECRET            — openssl rand -hex 32
#   AUTHENTIK_CLIENT_SECRET           — openssl rand -hex 32 (shared with the blueprint)
#   AUTH_PG_PASS                      — openssl rand -hex 32 (Authentik's DB)
#   AUTHENTIK_SECRET_KEY              — openssl rand -base64 60
#   AUTHENTIK_BOOTSTRAP_PASSWORD      — the akadmin password you'll log in with

docker compose up -d --build
```

Services and ports:

| Service       | URL / port            | Purpose                              |
| ------------- | --------------------- | ------------------------------------ |
| `api`         | http://localhost:8085 | The cloud API the extension talks to |
| `auth_server` | http://localhost:9000 | Authentik (login UI + OAuth)         |
| `postgres`    | in-network only       | API database                         |
| `auth_db`     | localhost:5544        | Authentik database                   |

Log in to Authentik at http://localhost:9000 with `akadmin` /
`AUTHENTIK_BOOTSTRAP_PASSWORD`. The same account is what you sign in with during
the extension's OAuth flow.

> **Front-channel vs back-channel URLs.** `AUTHENTIK_BASE_URL`
> (`http://localhost:9000`) is what the _browser_ is redirected to;
> `AUTHENTIK_INTERNAL_URL` (`http://auth_server:9000`) is what the _api container_
> uses for server-to-server calls (token/userinfo/jwks). Both are preset in
> `docker-compose.yml` — only change them if you front Authentik with a real
> domain/reverse proxy (then point `AUTHENTIK_BASE_URL` at the public domain and
> leave `AUTHENTIK_INTERNAL_URL` as the in-network service URL).
>
> **Why the api overrides the `Host` header on back-channel calls.** Authentik
> resolves a request's _brand_ — and therefore serves its `/application/o/*`
> routes — from the HTTP `Host` header, and rejects hosts containing an
> underscore (`auth_server` is not a valid RFC-1123 hostname) with a **404**.
> So the api connects to `AUTHENTIK_INTERNAL_URL` for networking but sends the
> _front-channel_ host (the host of `AUTHENTIK_BASE_URL`, e.g. `localhost:9000`
> or `auth.tumblecode.dev`) as `Host`. This is automatic — you don't configure
> it — and it is why the underscore in the default `auth_server` service name is
> harmless. If back-channel token exchange ever 404s, this is the mechanism to
> look at (see [`config/auth.py`](config/auth.py) → `get_back_channel_host_header`).

#### Production example (public address)

For a public deployment where the API is served at `https://app.tumblecode.dev`
and Authentik at `https://auth.tumblecode.dev`, set in `.env`:

```bash
API_BASE_URL=https://app.tumblecode.dev
AUTHENTIK_BASE_URL=https://auth.tumblecode.dev        # front-channel; also sent as Host on back-channel
AUTHENTIK_INTERNAL_URL=http://auth_server:9000        # back-channel (in-cluster service name)
AUTHENTIK_REDIRECT_URI=https://app.tumblecode.dev/auth/clerk/callback
CORS_ORIGINS=https://app.tumblecode.dev
AUTHENTIK_CLIENT_SECRET=<openssl rand -hex 32>        # REQUIRED: the provider is confidential
```

The api sends `Host: auth.tumblecode.dev` (taken from `AUTHENTIK_BASE_URL`) on
every back-channel call, so Authentik resolves the brand correctly even though
the connection targets the internal service name. The provider's `client_type`
is `confidential`, so a matching `AUTHENTIK_CLIENT_SECRET` is mandatory.

> **Blueprint troubleshooting.** The provider/app are created by the worker on
> first boot. Check it applied with `docker compose logs auth_worker | grep -i
blueprint`, or in the Authentik UI under **System → Blueprints**. The blueprint
> schema is Authentik-version-sensitive; if it errors, adjust
> `authentik/blueprints/tumble-code.yaml` for your `AUTHENTIK_TAG`.

### Running the API locally (without Docker)

Requires Python 3.12+, [uv](https://docs.astral.sh/uv/getting-started/installation/),
a PostgreSQL 16+ you control, and an Authentik instance.

```bash
cp .env.example .env          # set DATABASE_URL + the AUTHENTIK_* values

# Install dependencies
uv sync

# Run database migrations
uv run alembic upgrade head

# Start the server
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8085
```

For a non-compose deployment, leave `AUTHENTIK_INTERNAL_URL` unset — it falls
back to `AUTHENTIK_BASE_URL`.

A [`Makefile`](Makefile) wraps these commands (`make help`, `make dev`,
`make docker-up`, …).

## Configuring the Roo Code Extension

In VS Code, open Settings (`Ctrl+,` / `Cmd+,`) and search for `roo-cline` to configure these settings:

| VS Code Setting              | Environment Variable    | Description                                                                           |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `roo-cline.cloudApiUrl`      | `ROO_CODE_API_URL`      | URL of your self-hosted API (e.g., `http://localhost:8085`)                           |
| `roo-cline.clerkBaseUrl`     | `CLERK_BASE_URL`        | URL of the Clerk-compatible auth facade (auto-detected from `cloudApiUrl` if not set) |
| `roo-cline.cloudProviderUrl` | `ROO_CODE_PROVIDER_URL` | URL of the LLM proxy (e.g., `http://localhost:8085`)                                  |

> **Auto-detect:** When `clerkBaseUrl` is not explicitly configured, the extension
> automatically uses the same URL as `cloudApiUrl` for Clerk auth requests. This means
> that for self-hosted deployments, you only need to set `cloudApiUrl` — the extension
> will automatically send auth requests (like ticket validation) to your self-hosted API
> instead of the production Clerk.
>
> You only need to set `clerkBaseUrl` explicitly if you want the Clerk auth endpoint
> to be different from `cloudApiUrl` (which is rarely needed).
>
> **Important:** If you do set `clerkBaseUrl` manually, it must point to your self-hosted API,
> **not** to Authentik. The self-hosted API serves the Clerk-compatible endpoints
> (`/v1/client/sign_ins`, etc.) that the extension calls after the browser-based OAuth
> flow completes. If `clerkBaseUrl` is left pointing at the production Clerk
> (`https://clerk.roocode.com`), the ticket exchange will fail because the production
> Clerk has no knowledge of users created in your self-hosted instance.

### Authentication Flow

1. The extension opens the browser to `/extension/sign-in?state=...&auth_redirect=vscode://...`
2. The API redirects to Authentik for OAuth authentication
3. After Authentik authentication, the browser is redirected to `/auth/clerk/callback`
4. The API exchanges the OAuth code, creates a user/session, generates a ticket,
   and returns an HTML page that navigates back to `vscode://...`
5. The VS Code extension receives the ticket and calls `/v1/client/sign_ins` on
   `clerkBaseUrl` to complete sign-in

### Troubleshooting

**"Failed to handle Roo Code Cloud callback: Error: HTTP 400: Bad Request" after Authentik login:**

- This error occurs when the extension tries to validate the auth ticket against the production Clerk (`https://clerk.roocode.com`) instead of your self-hosted API
- Ensure `roo-cline.cloudApiUrl` is set to your self-hosted API URL (e.g., `http://localhost:8085`)
- The extension should auto-detect the Clerk base URL from `cloudApiUrl` — if it doesn't, explicitly set `roo-cline.clerkBaseUrl` to the same URL as `cloudApiUrl`
- Check the VS Code developer console (Help > Toggle Developer Tools) for network requests to verify the ticket is being sent to the correct URL

**"Waiting for browser authentication" hangs after Authentik login:**

- Check the browser's developer console for errors in the callback page
- Verify the Authentik redirect URI is set to `{API_BASE_URL}/auth/clerk/callback`
- Check the API server logs for errors during the token exchange or user creation

**`502 Bad Gateway` on `/auth/clerk/callback` right after Authentik login:**

- This is the API's own error page, returned when the **back-channel token
  exchange** to Authentik fails — not a reverse-proxy error.
- Check the API logs: `docker compose logs api | grep -i "token exchange"`.
  A `404 Not Found` for `…/application/o/token/` means Authentik rejected the
  request's `Host`. The api derives that `Host` from `AUTHENTIK_BASE_URL`, so
  ensure it is a valid hostname (no underscores) and points at the host your
  Authentik brand serves. See _Why the api overrides the `Host` header_ above.
- A `400 invalid_client` instead means `AUTHENTIK_CLIENT_SECRET` is missing or
  does not match the value the blueprint provisioned (the provider is confidential).

## Authentik Setup

1. Deploy Authentik with Docker Compose
2. Create an OAuth2 Provider with:
    - Client type: Confidential
    - Redirect URI: `{API_BASE_URL}/auth/clerk/callback`
    - Scopes: `openid`, `profile`, `email`
3. Create an Application using this provider
4. Set `AUTHENTIK_CLIENT_ID` and `AUTHENTIK_CLIENT_SECRET` in your `.env`

## API Endpoints

### Clerk-Compatible Auth (CLERK_BASE_URL)

- `POST /v1/client/sign_ins` - Sign in with ticket
- `POST /v1/client/sessions/{id}/tokens` - Create session JWT
- `GET /v1/me` - Get user profile
- `GET /v1/me/organization_memberships` - Get org memberships
- `POST /v1/client/sessions/{id}/remove` - Logout

### Browser Auth Flow

- `GET /extension/sign-in` - Redirect to Authentik OAuth
- `GET /extension/provider-sign-up` - Redirect to Authentik OAuth (signup)
- `GET /l/{slug}` - Landing page auth flow
- `GET /auth/clerk/callback` - Authentik OAuth callback

### Main API (ROO_CODE_API_URL)

- `GET /api/extension-settings` - Fetch org + user settings
- `PATCH /api/user-settings` - Update user settings
- `POST /api/extension/share` - Share a task
- `GET /api/extension/bridge/config` - Bridge config
- `GET /api/extension/credit-balance` - Credit balance
- `POST /api/events` - Record telemetry event
- `POST /api/events/backfill` - Backfill task messages
- `GET /api/marketplace/modes` - Mode marketplace
- `GET /api/marketplace/mcps` - MCP marketplace

### LLM Proxy (ROO_CODE_PROVIDER_URL)

- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - Chat completions (streaming)
- `POST /v1/images/generations` - Image generation

## Architecture

See [plans/self-hosted-cloud-api-architecture.md](../plans/self-hosted-cloud-api-architecture.md) for the full architecture document.

## License

MIT
