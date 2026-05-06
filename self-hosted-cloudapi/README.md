# Self-Hosted Roo Code Cloud API

A self-hosted replacement for the Roo Code Cloud API, compatible with the existing Roo Code VS Code extension.

## Quick Start

### Prerequisites

- Python 3.12+
- [uv](https://docs.astral.sh/uv/getting-started/installation/) (Python package manager)
- PostgreSQL 16+
- Authentik (for OAuth authentication)
- Docker & Docker Compose (optional, for containerized deployment)

### Environment Setup

1. Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

2. Key environment variables:
    - `DATABASE_URL`: PostgreSQL connection string
    - `AUTHENTIK_BASE_URL`: Your Authentik instance URL
    - `AUTHENTIK_CLIENT_ID`: OAuth2 client ID from Authentik
    - `API_BASE_URL`: Public URL of this API server

### Running with Docker Compose

```bash
docker-compose up -d
```

### Running Locally

```bash
# Install dependencies
uv sync

# Run database migrations
uv run alembic upgrade head

# Start the server
uv run uvicorn src.main:app --reload --host 0.0.0.0 --port 8000
```

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
