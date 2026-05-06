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

Set these environment variables in the Roo Code extension settings:

- `ROO_CODE_API_URL`: Point to your self-hosted API (e.g., `https://roo.example.com`)
- `CLERK_BASE_URL`: Point to your self-hosted auth facade (same URL as above)
- `ROO_CODE_PROVIDER_URL`: Point to your LLM proxy (e.g., `https://roo.example.com`)

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
