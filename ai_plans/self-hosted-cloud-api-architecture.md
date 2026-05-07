# Self-Hosted Roo Code Cloud API — Architecture Plan

## 1. Overview

This document describes the architecture for a self-hosted replacement of the Roo Code Cloud API, placed in the `self-hosted-cloudapi/` directory at the root of the Roo-Code repository. The server is a Python/FastAPI application that provides a **Clerk-compatible authentication facade** backed by Authentik OAuth, the **main Roo Code API** endpoints, and an **LLM proxy** — all compatible with the existing Roo Code VS Code extension client without modification.

The client connects to three API surfaces, controlled by three environment variables:

| Env Variable            | Default Production URL          | Self-Hosted Target               |
| ----------------------- | ------------------------------- | -------------------------------- |
| `CLERK_BASE_URL`        | `https://clerk.roocode.com`     | Our Clerk-compatible auth facade |
| `ROO_CODE_API_URL`      | `https://app.roocode.com`       | Our main API                     |
| `ROO_CODE_PROVIDER_URL` | `https://api.roocode.com/proxy` | Our LLM proxy                    |

---

## 2. Project Structure

```
self-hosted-cloudapi/
├── README.md
├── pyproject.toml
├── alembic.ini
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── alembic/
│   ├── env.py
│   ├── script.py.mako
│   └── versions/
│       └── 001_initial_schema.py
├── config/
│   ├── __init__.py
│   ├── settings.py
│   ├── auth.py
│   └── marketplace/
│       ├── modes.yaml
│       └── mcps.yaml
├── src/
│   ├── __init__.py
│   ├── main.py
│   ├── dependencies.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── base.py
│   │   ├── user.py
│   │   ├── organization.py
│   │   ├── settings.py
│   │   ├── task.py
│   │   ├── event.py
│   │   └── marketplace.py
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   ├── settings.py
│   │   ├── share.py
│   │   ├── marketplace.py
│   │   ├── telemetry.py
│   │   ├── models.py
│   │   └── user.py
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── auth.py
│   │   ├── extension.py
│   │   ├── settings.py
│   │   ├── events.py
│   │   ├── marketplace.py
│   │   ├── proxy.py
│   │   └── browser.py
│   ├── services/
│   │   ├── __init__.py
│   │   ├── auth_service.py
│   │   ├── user_service.py
│   │   ├── settings_service.py
│   │   ├── share_service.py
│   │   ├── telemetry_service.py
│   │   ├── marketplace_service.py
│   │   ├── proxy_service.py
│   │   └── bridge_service.py
│   ├── auth/
│   │   ├── __init__.py
│   │   ├── authentik.py
│   │   ├── jwt_issuer.py
│   │   ├── clerk_facade.py
│   │   └── static_token.py
│   ├── proxy/
│   │   ├── __init__.py
│   │   ├── router.py
│   │   ├── openai_compat.py
│   │   └── providers/
│   │       ├── __init__.py
│   │       ├── base.py
│   │       ├── openai.py
│   │       ├── anthropic.py
│   │       └── custom.py
│   ├── database.py
│   └── middleware/
│       ├── __init__.py
│       ├── rate_limit.py
│       ├── cors.py
│       └── request_logging.py
└── tests/
    ├── __init__.py
    ├── conftest.py
    ├── test_auth.py
    ├── test_settings.py
    ├── test_share.py
    ├── test_events.py
    ├── test_marketplace.py
    ├── test_proxy.py
    └── test_jwt_issuer.py
```

---

## 3. Authentication System — Clerk-Compatible Facade

The most critical and complex part of this architecture is implementing a **Clerk-compatible authentication facade** so the existing Roo Code client works without modification. The clients `WebAuthService` (packages/cloud/src/WebAuthService.ts) calls specific Clerk API endpoints with exact request/response formats.

### 3.1 Auth Flow Sequence

```mermaid
sequenceDiagram
    participant Client as Roo Code Client
    participant Browser as User Browser
    participant API as Self-Hosted API
    participant Authentik as Authentik

    Note over Client: 1. User triggers sign-in
    Client->>Client: Generate CSRF state and store in globalState
    Client->>Browser: Open API_URL/extension/sign-in with state and auth_redirect params

    Browser->>API: GET /extension/sign-in?state=csrf and auth_redirect=vscode://...
    API->>API: Store state + redirect in session
    API->>Browser: 302 Redirect to Authentik /authorize

    Browser->>Authentik: OAuth Authorize Request
    Authentik->>Browser: Login UI if needed
    Browser->>Authentik: User authenticates
    Authentik->>Browser: 302 Redirect to /auth/clerk/callback with authz code

    Browser->>API: GET /auth/clerk/callback?code=authz_code
    API->>Authentik: POST /oauth/token with code + PKCE verifier
    Authentik->>API: Access token + ID token + refresh token
    API->>API: Create/update User in DB
    API->>API: Create Session + ClientToken in DB
    API->>API: Generate ticket code and store mapping to session
    API->>Browser: 302 Redirect to auth_redirect URI with code=ticket and state=csrf and organizationId=orgId

    Browser->>Client: VS Code opens URI: vscode://.../auth/clerk/callback?code=ticket and state=csrf

    Note over Client: 2. Client exchanges ticket for session
    Client->>API: POST /v1/client/sign_ins with strategy=ticket and ticket=ticket
    API->>API: Validate ticket and lookup session
    API->>Client: 200 JSON with created_session_id + Authorization header with clientToken

    Note over Client: 3. Client refreshes JWT every ~50s
    Client->>API: POST /v1/client/sessions/sessionId/tokens with _is_native=1 and organization_id
    API->>API: Generate Clerk-compatible JWT
    API->>Client: 200 JSON with jwt field

    Note over Client: 4. Client fetches user info
    Client->>API: GET /v1/me with Authorization header
    API->>Client: 200 JSON with user profile

    Client->>API: GET /v1/me/organization_memberships with Authorization header
    API->>Client: 200 JSON with memberships array
```

### 3.2 Clerk-Compatible JWT Payload

The JWT must match the exact structure the client validates via `JWTPayload` (packages/types/src/cloud.ts:17). The `StaticTokenAuthService` (packages/cloud/src/StaticTokenAuthService.ts) decodes the JWT and extracts `r.u`, `r.o`, and `r.t`:

```json
{
	"iss": "rcc",
	"sub": "user_2xmBhejNeDTwanM8",
	"exp": 1746200000,
	"iat": 1746199500,
	"nbf": 1746199500,
	"v": 1,
	"r": {
		"u": "user_2xmBhejNeDTwanM8",
		"o": "org_2wbhchVXZMQl8OS1",
		"t": "auth"
	}
}
```

**Key implementation details:**

- The `iss` field must be `"rcc"` — the client may validate this
- The `r.t` field must be `"auth"` for regular session tokens
- The `r.o` field should be **absent** (not `null`) when the user has no organization context
- The `sub` field equals the user ID for auth tokens
- JWTs are signed with RS256 (asymmetric) by default; HS256 (shared secret) supported for simpler deployments

### 3.3 Clerk API Endpoint Implementations

#### POST /v1/client/sign_ins — Sign In with Ticket

The client sends `strategy=ticket&ticket={code}` as form-urlencoded data. The server:

1. Looks up the ticket code in the DB (mapped to a session created during OAuth callback)
2. Validates the ticket hasnt expired (tickets are single-use, short-lived)
3. Returns the session ID in the response body
4. Returns a **client token** in the `Authorization` response header

**Response format** (must match `clerkSignInResponseSchema` from WebAuthService.ts:39):

```json
{
	"response": {
		"created_session_id": "sess_abc123"
	}
}
```

**Response header**: `Authorization: Bearer {clientToken}` — the client extracts this via `response.headers.get("authorization")` (WebAuthService.ts:550).

#### POST /v1/client/sessions/{sessionId}/tokens — Create Session JWT

The client sends `_is_native=1` and optionally `organization_id` as form-urlencoded. The server:

1. Validates the `clientToken` from the Authorization header
2. Validates the session exists and belongs to this client
3. Generates a Clerk-compatible JWT with 60-second expiry
4. Returns the JWT

**Response format** (must match `clerkCreateSessionTokenResponseSchema` from WebAuthService.ts:45):

```json
{
	"jwt": "eyJhbGciOiJIUzI1NiIs..."
}
```

#### GET /v1/me — Get User Profile

The client sends the `clientToken` in the Authorization header. The server validates the token and returns user profile data.

**Response format** (must match `clerkMeResponseSchema` from WebAuthService.ts:49):

```json
{
	"response": {
		"id": "user_abc123",
		"first_name": "John",
		"last_name": "Doe",
		"image_url": "https://...",
		"primary_email_address_id": "email_abc",
		"email_addresses": [{ "id": "email_abc", "email_address": "john@example.com" }],
		"public_metadata": {}
	}
}
```

#### GET /v1/me/organization_memberships — Get Org Memberships

**Response format** (must match `clerkOrganizationMembershipsSchema` from WebAuthService.ts:68):

```json
{
	"response": [
		{
			"id": "mem_abc123",
			"role": "org:admin",
			"permissions": ["org:manage:settings"],
			"organization": {
				"id": "org_abc123",
				"name": "My Org",
				"slug": "my-org",
				"image_url": "https://...",
				"has_image": true,
				"created_at": 1700000000,
				"updated_at": 1700000000
			}
		}
	]
}
```

#### POST /v1/client/sessions/{sessionId}/remove — Logout

The client sends `_is_native=1` as form-urlencoded with the clientToken. The server invalidates the session.

### 3.4 Browser Sign-In/Sign-Up Routes

These routes serve the browser-based authentication flow. The client opens these URLs in the users browser:

| Route                                                                       | Purpose                   |
| --------------------------------------------------------------------------- | ------------------------- |
| `GET /extension/sign-in?state={csrf}&auth_redirect={vscode://...}`          | Standard sign-in flow     |
| `GET /extension/provider-sign-up?state={csrf}&auth_redirect={vscode://...}` | Provider sign-up flow     |
| `GET /l/{slug}?state={csrf}&auth_redirect={vscode://...}`                   | Landing page sign-in flow |

All three routes follow the same pattern:

1. Store `state` and `auth_redirect` in a server-side session (cookie or Redis)
2. Redirect to Authentiks `/authorize` endpoint with PKCE code challenge
3. On Authentik callback, exchange authorization code for tokens
4. Create user/session/client_token records in DB
5. Generate a single-use ticket code
6. Redirect to `auth_redirect` URI with `code={ticket}&state={csrf}&organizationId={orgId}`

The callback URL that Authentik redirects to must be: `{API_URL}/auth/clerk/callback`

This matches the clients URI handler at `/auth/clerk/callback` (src/activate/handleUri.ts:32) which extracts `code`, `state`, `organizationId`, and `provider_model` from the query parameters.

### 3.5 Static Token Support

For agent/CI use cases, the `ROO_CODE_CLOUD_TOKEN` environment variable provides a pre-issued JWT. The `StaticTokenAuthService` (packages/cloud/src/StaticTokenAuthService.ts) decodes this JWT directly — it never calls Clerk endpoints. The self-hosted API must:

1. Accept these static tokens as `Bearer` tokens on all API endpoints
2. Validate the JWT signature and claims
3. Extract `r.u` (user ID), `r.o` (org ID), and `r.t` (token type) from the JWT
4. Support token type `"auth"` for regular tokens and `"cj"` for cloud job tokens

### 3.6 Authentik OAuth Integration

```mermaid
flowchart TD
    A[User clicks Sign In] --> B[API redirects to Authentik /authorize]
    B --> C[Authentik shows login UI]
    C --> D[Authentik redirects to /auth/clerk/callback with authz code]
    D --> E[API exchanges code for tokens using PKCE]
    E --> F[API creates/updates User in DB]
    F --> G[API creates Session + ClientToken in DB]
    G --> H[API generates ticket code]
    H --> I[API redirects to vscode:// URI with ticket code]
```

**Authentik configuration requirements:**

- Create an OAuth2 provider with `authorization_code` + `PKCE` flow
- Configure redirect URI: `{API_URL}/auth/clerk/callback`
- Map Authentik user attributes to Clerk-compatible user profile fields
- Configure Authentik to include `email`, `name`, `groups` in ID token claims

---

## 4. Database Schema

All tables use UUID primary keys with prefix-based string IDs (e.g., `user_`, `sess_`, `org_`) to maintain Clerk API compatibility.

### 4.1 Entity Relationship Diagram

```mermaid
erDiagram
    users ||--o{ sessions : has
    users ||--o{ memberships : belongs_to
    organizations ||--o{ memberships : has
    organizations ||--o{ organization_settings : has
    users ||--o{ user_settings : has
    sessions ||--o{ client_tokens : has
    users ||--o{ tasks : owns
    tasks ||--o{ task_messages : contains
    tasks ||--o{ task_shares : has
    users ||--o{ telemetry_events : generates
    organizations ||--o{ provider_configs : has
```

### 4.2 Table Definitions

#### users

```sql
CREATE TABLE users (
    id              TEXT PRIMARY KEY DEFAULT 'user_' || gen_random_uuid()::text,
    authentik_id    TEXT UNIQUE NOT NULL,
    email           TEXT NOT NULL,
    first_name      TEXT DEFAULT '',
    last_name       TEXT DEFAULT '',
    image_url       TEXT,
    public_metadata JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### organizations

```sql
CREATE TABLE organizations (
    id          TEXT PRIMARY KEY DEFAULT 'org_' || gen_random_uuid()::text,
    name        TEXT NOT NULL,
    slug        TEXT UNIQUE,
    image_url   TEXT,
    has_image   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

#### memberships

```sql
CREATE TABLE memberships (
    id              TEXT PRIMARY KEY DEFAULT 'mem_' || gen_random_uuid()::text,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL DEFAULT 'org:member',
    permissions     JSONB DEFAULT '[]',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, organization_id)
);
```

#### sessions

```sql
CREATE TABLE sessions (
    id          TEXT PRIMARY KEY DEFAULT 'sess_' || gen_random_uuid()::text,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ,
    is_active   BOOLEAN DEFAULT TRUE
);
```

#### client_tokens

```sql
CREATE TABLE client_tokens (
    id          TEXT PRIMARY KEY DEFAULT 'ct_' || gen_random_uuid()::text,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ
);
```

#### tickets (short-lived, single-use)

```sql
CREATE TABLE tickets (
    code        TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN DEFAULT FALSE
);
```

#### organization_settings

```sql
CREATE TABLE organization_settings (
    id                      TEXT PRIMARY KEY DEFAULT 'os_' || gen_random_uuid()::text,
    organization_id         TEXT UNIQUE NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    version                 INTEGER DEFAULT 0,
    record_task_messages    BOOLEAN DEFAULT TRUE,
    enable_task_sharing     BOOLEAN DEFAULT TRUE,
    allow_public_task_sharing BOOLEAN DEFAULT TRUE,
    task_share_expiration_days INTEGER DEFAULT 30,
    allow_members_view_all_tasks BOOLEAN DEFAULT TRUE,
    workspace_task_visibility TEXT DEFAULT 'all',
    llm_enhanced_features_enabled BOOLEAN DEFAULT FALSE,
    default_settings        JSONB DEFAULT '{}',
    allow_list              JSONB DEFAULT '{"allowAll": true, "providers": {}}',
    features                JSONB DEFAULT '{}',
    hidden_mcps             TEXT[] DEFAULT '{}',
    hide_marketplace_mcps   BOOLEAN DEFAULT FALSE,
    mcps                    JSONB DEFAULT '[]',
    provider_profiles       JSONB DEFAULT '{}',
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);
```

#### user_settings

```sql
CREATE TABLE user_settings (
    id              TEXT PRIMARY KEY DEFAULT 'us_' || gen_random_uuid()::text,
    user_id         TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    features        JSONB DEFAULT '{}',
    settings        JSONB DEFAULT '{}',
    version         INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### tasks

```sql
CREATE TABLE tasks (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### task_messages

```sql
CREATE TABLE task_messages (
    id              TEXT PRIMARY KEY DEFAULT 'msg_' || gen_random_uuid()::text,
    task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    message_data    JSONB NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### task_shares

```sql
CREATE TABLE task_shares (
    id              TEXT PRIMARY KEY DEFAULT 'sh_' || gen_random_uuid()::text,
    task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    visibility      TEXT NOT NULL DEFAULT 'organization',
    share_url       TEXT,
    manage_url      TEXT,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### telemetry_events

```sql
CREATE TABLE telemetry_events (
    id              TEXT PRIMARY KEY DEFAULT 'evt_' || gen_random_uuid()::text,
    user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,
    properties      JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

#### provider_configs (LLM proxy configuration)

```sql
CREATE TABLE provider_configs (
    id                  TEXT PRIMARY KEY DEFAULT 'pc_' || gen_random_uuid()::text,
    organization_id     TEXT UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
    providers           JSONB NOT NULL DEFAULT '[]',
    model_overrides     JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
```

#### authentik_state_store (OAuth state + PKCE verifiers)

```sql
CREATE TABLE authentik_state_store (
    state               TEXT PRIMARY KEY,
    auth_redirect       TEXT NOT NULL,
    code_verifier       TEXT NOT NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL
);
```

---

## 5. API Layer — FastAPI Routers

### 5.1 Router Overview

| Router         | Prefix                               | Endpoints                            |
| -------------- | ------------------------------------ | ------------------------------------ |
| auth.py        | /v1                                  | Clerk-compatible auth endpoints      |
| extension.py   | /api/extension                       | Share, bridge config, credit balance |
| settings.py    | /api                                 | Extension settings, user settings    |
| events.py      | /api                                 | Telemetry events, backfill           |
| marketplace.py | /api/marketplace                     | Mode/MCP marketplace                 |
| proxy.py       | /v1                                  | LLM proxy endpoints                  |
| browser.py     | /extension, /l, /auth/clerk/callback | Browser auth flows                   |

### 5.2 Auth Router — Clerk-Compatible Endpoints

```python
# routers/auth.py
router = APIRouter(prefix="/v1")

@router.post("/client/sign_ins")
async def sign_in(request: Request) -> Response:
    """Clerk-compatible sign-in. Accepts form-urlencoded: strategy=ticket and ticket=code.
    Returns: { response: { created_session_id: sess_... } }
    Header: Authorization: Bearer clientToken"""

@router.post("/client/sessions/{session_id}/tokens")
async def create_session_token(session_id: str, request: Request) -> Response:
    """Clerk-compatible session token creation.
    Accepts form-urlencoded: _is_native=1 and organization_id=orgId
    Header: Authorization: Bearer clientToken
    Returns: { jwt: ... }"""

@router.get("/me")
async def get_me(request: Request) -> Response:
    """Clerk-compatible user profile. Header: Authorization: Bearer clientToken
    Returns: { response: { id, first_name, last_name, image_url, ... } }"""

@router.get("/me/organization_memberships")
async def get_organization_memberships(request: Request) -> Response:
    """Clerk-compatible org memberships. Header: Authorization: Bearer clientToken
    Returns: { response: [{ id, role, organization: { id, name, slug, ... } }] }"""

@router.post("/client/sessions/{session_id}/remove")
async def remove_session(session_id: str, request: Request) -> Response:
    """Clerk-compatible logout. Accepts form-urlencoded: _is_native=1
    Header: Authorization: Bearer clientToken"""
```

### 5.3 Extension Router

```python
# routers/extension.py
router = APIRouter(prefix="/api/extension")

@router.post("/share")
async def share_task(request: Request) -> Response:
    """Share a task. Body: { taskId, visibility }
    Returns: { success, shareUrl, error, isNewShare, manageUrl }"""

@router.get("/bridge/config")
async def bridge_config(request: Request) -> Response:
    """Get bridge/websocket config. Returns: { userId, socketBridgeUrl, token }"""

@router.get("/credit-balance")
async def credit_balance(request: Request) -> Response:
    """Get credit balance. Returns: { balance: number }"""
```

### 5.4 Settings Router

```python
# routers/settings.py
router = APIRouter(prefix="/api")

@router.get("/extension-settings")
async def get_extension_settings(request: Request) -> Response:
    """Fetch org + user settings.
    Returns: { organization: OrganizationSettings, user: UserSettingsData }"""

@router.patch("/user-settings")
async def update_user_settings(request: Request) -> Response:
    """Update user settings. Body: { settings, version }
    Returns: UserSettingsData. Supports optimistic locking via version field."""
```

### 5.5 Events Router

```python
# routers/events.py
router = APIRouter(prefix="/api")

@router.post("/events")
async def record_event(request: Request) -> Response:
    """Record telemetry event. Body: { type, properties }"""

@router.post("/events/backfill")
async def backfill_events(request: Request) -> Response:
    """Backfill task messages (FormData). Body: taskId + properties JSON + file (task.json)"""
```

### 5.6 Marketplace Router

```python
# routers/marketplace.py
router = APIRouter(prefix="/api/marketplace")

@router.get("/modes")
async def get_modes() -> Response:
    """Fetch mode marketplace items. Unauthenticated."""

@router.get("/mcps")
async def get_mcps() -> Response:
    """Fetch MCP marketplace items. Unauthenticated."""
```

### 5.7 Proxy Router — LLM Proxy

```python
# routers/proxy.py
router = APIRouter(prefix="/v1")

@router.get("/models")
async def list_models(request: Request) -> Response:
    """List available models. Returns RooModelsResponse: { object: list, data: [...] }
    Optional auth: Bearer sessionToken"""

@router.post("/chat/completions")
async def chat_completions(request: Request) -> StreamingResponse:
    """OpenAI-compatible streaming chat completions. Auth: Bearer sessionToken
    Forwards to upstream LLM provider."""

@router.post("/images/generations")
async def image_generations(request: Request) -> Response:
    """Image generation endpoint. Auth: Bearer sessionToken"""
```

### 5.8 Browser Router — Auth Flow Pages

```python
# routers/browser.py
router = APIRouter()

@router.get("/extension/sign-in")
async def sign_in_page(state: str, auth_redirect: str):
    """Redirect to Authentik OAuth authorize URL."""

@router.get("/extension/provider-sign-up")
async def provider_sign_up_page(state: str, auth_redirect: str):
    """Redirect to Authentik OAuth authorize URL (signup flow)."""

@router.get("/l/{slug}")
async def landing_page(slug: str, state: str, auth_redirect: str):
    """Redirect to Authentik OAuth authorize URL (landing page flow)."""

@router.get("/auth/clerk/callback")
async def auth_callback(code: str, state: str):
    """Authentik OAuth callback. Exchange code for tokens, create user/session,
    generate ticket, redirect to auth_redirect URI."""
```

---

## 6. LLM Proxy Architecture

The LLM proxy forwards OpenAI-compatible requests to upstream providers and returns OpenAI-compatible responses. The clients `RooHandler` (src/api/providers/roo.ts) constructs an OpenAI client pointing at `{ROO_CODE_PROVIDER_URL}/v1`.

### 6.1 Proxy Flow

```mermaid
flowchart TD
    A[Roo Code Client] -->|POST /v1/chat/completions Bearer token| B[Self-Hosted API Proxy]
    B --> C[Validate JWT / extract user+org]
    C --> D[Lookup provider config for org]
    D --> E{Route to provider}
    E -->|OpenAI| F[OpenAI API]
    E -->|Anthropic| G[Anthropic API]
    E -->|Custom| H[Custom OpenAI-compatible endpoint]
    F --> I[Transform response to OpenAI format]
    G --> I
    H --> I
    I -->|SSE stream| A
```

### 6.2 Model Configuration

Models are served from the `/v1/models` endpoint and must conform to the `RooModelsResponseSchema` (packages/types/src/providers/roo.ts:54):

```json
{
	"object": "list",
	"data": [
		{
			"id": "anthropic/claude-sonnet-4-20250514",
			"object": "model",
			"created": 1700000000,
			"owned_by": "anthropic",
			"name": "Claude Sonnet 4",
			"description": "High-performance model...",
			"context_window": 200000,
			"max_tokens": 8192,
			"type": "language",
			"tags": ["vision", "reasoning"],
			"pricing": {
				"input": "0.000003",
				"output": "0.000015",
				"input_cache_read": "0.0000003",
				"input_cache_write": "0.000003"
			},
			"deprecated": false,
			"default_temperature": 0.0,
			"settings": {},
			"versionedSettings": {}
		}
	]
}
```

**Key observations from the client code:**

- Pricing values are **strings** (not numbers) — the client parses them with `parseApiPrice` (src/api/providers/fetchers/roo.ts)
- The `tags` field drives feature detection: `"vision"`, `"reasoning"`, `"reasoning-required"`, `"stealth"`, `"free"`
- The `settings` and `versionedSettings` fields allow per-model configuration overrides
- The `type` field must be `"language"`

### 6.3 Provider Routing

The proxy routes requests based on the model ID prefix:

| Model ID Prefix | Upstream Provider        | API Format                    |
| --------------- | ------------------------ | ----------------------------- |
| `openai/`       | OpenAI API               | Native OpenAI                 |
| `anthropic/`    | Anthropic API            | Convert to/from OpenAI format |
| `google/`       | Google AI API            | Convert to/from OpenAI format |
| `xai/`          | xAI/Grok API             | OpenAI-compatible             |
| `custom/`       | User-configured endpoint | OpenAI-compatible passthrough |

The routing configuration is stored per-organization in the `provider_configs` table and can be overridden via environment variables for single-user deployments.

### 6.4 Streaming

The proxy must support **Server-Sent Events (SSE)** streaming, matching the OpenAI streaming format. The client uses `stream: true` and `stream_options: { include_usage: true }`. The proxy:

1. Receives the streaming request from the client
2. Forwards it to the upstream provider (converting format if needed)
3. Streams the response back in OpenAI SSE format
4. Handles `reasoning_details` in delta chunks (used by newer models)

---

## 7. Configuration

### 7.1 Environment Variables

```bash
# === Core ===
DATABASE_URL=postgresql://roo:password@localhost:5432/roo_cloud
SECRET_KEY=your-secret-key-for-jwt-signing
JWT_ALGORITHM=RS256                          # or HS256
JWT_PRIVATE_KEY=/path/to/private.pem         # For RS256
JWT_PUBLIC_KEY=/path/to/public.pem           # For RS256
JWT_SECRET=your-hs256-secret                 # For HS256

# === Authentik OAuth ===
AUTHENTIK_BASE_URL=https://auth.example.com
AUTHENTIK_CLIENT_ID=your-client-id
AUTHENTIK_CLIENT_SECRET=your-client-secret   # If not using PKCE
AUTHENTIK_REDIRECT_URI=https://roo.example.com/auth/clerk/callback

# === API ===
API_BASE_URL=https://roo.example.com          # Public URL of this API
CORS_ORIGINS=https://your-vscode-extension-origin  # Or * for development

# === LLM Proxy ===
DEFAULT_LLM_PROVIDER=openai                  # Default upstream provider
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
XAI_API_KEY=...

# === Marketplace ===
MARKETPLACE_SOURCE=database                  # database or yaml
MARKETPLACE_YAML_DIR=/path/to/config/marketplace  # If MARKETPLACE_SOURCE=yaml

# === Optional ===
CREDIT_SYSTEM_ENABLED=false                  # Enable credit balance tracking
BRIDGE_ENABLED=false                         # Enable WebSocket bridge
TELEMETRY_ENABLED=true                       # Accept telemetry events
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS_PER_MINUTE=60
```

### 7.2 Settings Management

Use Pydantic `BaseSettings` for type-safe configuration:

```python
class Settings(BaseSettings):
    database_url: PostgresDsn
    secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_private_key: Optional[str] = None
    jwt_public_key: Optional[str] = None
    jwt_secret: Optional[str] = None

    authentik_base_url: HttpUrl
    authentik_client_id: str
    authentik_client_secret: Optional[str] = None
    authentik_redirect_uri: HttpUrl

    api_base_url: HttpUrl
    cors_origins: List[str] = ["*"]

    default_llm_provider: str = "openai"
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
```

---

## 8. Docker Deployment

### 8.1 Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml poetry.lock ./
RUN pip install --no-cache-dir poetry && \
    poetry config virtualenvs.create false && \
    poetry install --no-dev --no-interaction --no-ansi

COPY . .

CMD ["sh", "-c", "alembic upgrade head && uvicorn src.main:app --host 0.0.0.0 --port 8000"]
```

### 8.2 docker-compose.yml

```yaml
version: "3.8"

services:
    api:
        build: .
        ports:
            - "8000:8000"
        environment:
            DATABASE_URL: postgresql://roo:password@postgres:5432/roo_cloud
            SECRET_KEY: ${SECRET_KEY}
            JWT_ALGORITHM: ${JWT_ALGORITHM:-HS256}
            JWT_SECRET: ${JWT_SECRET:-}
            AUTHENTIK_BASE_URL: ${AUTHENTIK_BASE_URL}
            AUTHENTIK_CLIENT_ID: ${AUTHENTIK_CLIENT_ID}
            AUTHENTIK_CLIENT_SECRET: ${AUTHENTIK_CLIENT_SECRET}
            AUTHENTIK_REDIRECT_URI: ${AUTHENTIK_REDIRECT_URI}
            API_BASE_URL: ${API_BASE_URL}
            CORS_ORIGINS: ${CORS_ORIGINS:-*}
            OPENAI_API_KEY: ${OPENAI_API_KEY:-}
            ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
        depends_on:
            postgres:
                condition: service_healthy
        restart: unless-stopped

    postgres:
        image: postgres:16-alpine
        ports:
            - "5432:5432"
        environment:
            POSTGRES_USER: roo
            POSTGRES_PASSWORD: password
            POSTGRES_DB: roo_cloud
        volumes:
            - postgres_data:/var/lib/postgresql/data
        healthcheck:
            test: ["CMD-SHELL", "pg_isready -U roo"]
            interval: 5s
            timeout: 5s
            retries: 5

volumes:
    postgres_data:
```

### 8.3 Authentik Integration Notes

Authentik should be deployed separately (it has its own docker-compose). The self-hosted API only needs:

1. **Authentik OAuth2 Provider** configured with:
    - Client ID and secret
    - Redirect URI: `{API_BASE_URL}/auth/clerk/callback`
    - Scopes: `openid`, `profile`, `email`
2. **Authentik User Attributes** mapped to Clerk-compatible fields:
    - `email` maps to `email_addresses[0].email_address`
    - `name` maps to `first_name` + `last_name`
    - `picture` maps to `image_url`
    - `groups` maps to organization memberships

---

## 9. Security

### 9.1 CORS

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### 9.2 Rate Limiting

Use `slowapi` or a custom middleware. Rate limits per endpoint:

- Auth endpoints: 10 requests/minute
- API endpoints: 60 requests/minute
- Proxy endpoints: 100 requests/minute (per user)
- Marketplace: 30 requests/minute

### 9.3 Input Validation

All request bodies validated with Pydantic schemas matching the clients Zod schemas:

- `shareResponseSchema` (packages/types/src/cloud.ts:223) maps to `ShareResponseSchema`
- `organizationSettingsSchema` (packages/types/src/cloud.ts:153) maps to `OrganizationSettingsSchema`
- `userSettingsDataSchema` (packages/types/src/cloud.ts:182) maps to `UserSettingsDataSchema`
- `RooModelsResponseSchema` (packages/types/src/providers/roo.ts:54) maps to `ModelsResponseSchema`

### 9.4 JWT Security

- JWTs signed with RS256 (asymmetric) by default; HS256 supported for simpler deployments
- Client tokens are SHA-256 hashed before storage
- Tickets are single-use and expire within 5 minutes
- Session JWTs expire every 60 seconds (client refreshes every ~50 seconds)
- Static tokens (`ROO_CODE_CLOUD_TOKEN`) validated against the same JWT signature

### 9.5 SQL Injection Prevention

All database queries use SQLAlchemy ORM with parameterized queries. No raw SQL.

---

## 10. Marketplace

The marketplace endpoints serve mode and MCP definitions. Two strategies are supported:

### 10.1 YAML File Mode (Default for Self-Hosted)

Marketplace items are defined in YAML files under `config/marketplace/`:

```yaml
# config/marketplace/modes.yaml
- id: code-mode
  name: Code
  description: Optimized for code writing and editing
  type: mode
  content: |
      # Code Mode Configuration
      ...
```

```yaml
# config/marketplace/mcps.yaml
- id: filesystem-mcp
  name: Filesystem
  description: File system access MCP server
  type: mcp
  url: https://github.com/...
```

### 10.2 Database Mode

For multi-tenant deployments, marketplace items are stored in a `marketplace_entries` table and managed via admin API endpoints.

### 10.3 Organization Filtering

When authenticated, the API applies organization-level filtering:

- `hiddenMcps` from org settings are removed from MCP marketplace results
- `hideMarketplaceMcps` flag can suppress all MCP marketplace items
- Organization-specific MCPs from org settings are prepended to results

This matches the client behavior in `MarketplaceManager` (src/services/marketplace/MarketplaceManager.ts).

---

## 11. Implementation Phases

### Phase 1: Core Auth + API Skeleton

- Set up FastAPI project structure with SQLAlchemy + Alembic
- Implement database schema (users, sessions, client_tokens, tickets, organizations, memberships)
- Implement Authentik OAuth flow (browser sign-in, callback, ticket generation)
- Implement Clerk-compatible auth facade (all 5 endpoints)
- Implement JWT issuance with exact payload structure
- Implement static token validation
- Docker + docker-compose setup
- Integration test: client can authenticate end-to-end

### Phase 2: Settings + Extension API

- Implement organization settings CRUD
- Implement user settings CRUD with optimistic locking
- Implement `/api/extension-settings` endpoint
- Implement `/api/user-settings` PATCH endpoint
- Implement `/api/extension/share` endpoint
- Implement `/api/extension/bridge/config` endpoint
- Implement `/api/extension/credit-balance` endpoint

### Phase 3: Telemetry + Marketplace

- Implement `/api/events` POST endpoint
- Implement `/api/events/backfill` POST endpoint
- Implement marketplace YAML loading
- Implement `/api/marketplace/modes` endpoint
- Implement `/api/marketplace/mcps` endpoint
- Implement org-level marketplace filtering

### Phase 4: LLM Proxy

- Implement `/v1/models` endpoint with configurable model catalog
- Implement `/v1/chat/completions` streaming proxy
- Implement provider routing (OpenAI, Anthropic, custom)
- Implement `/v1/images/generations` proxy
- Implement request/response format conversion for non-OpenAI providers
- Implement usage tracking and rate limiting per org

### Phase 5: Polish + Production Readiness

- Comprehensive test coverage
- Admin API for user/org/model management
- Database migrations for all schema changes
- Monitoring and health checks
- Documentation and deployment guide
- Security audit

---

## 12. Key Design Decisions

### 12.1 Why Clerk-Compatible Facade Instead of Modifying the Client?

The existing `WebAuthService` (packages/cloud/src/WebAuthService.ts) in the Roo Code client makes specific HTTP calls to Clerk-formatted endpoints with exact request/response schemas. Modifying the client would require:

1. Forking and maintaining the extension
2. Breaking compatibility with the official Roo Code Cloud
3. Requiring all users to install a custom build

By implementing a Clerk-compatible facade, users can point `CLERK_BASE_URL` to the self-hosted API and use the **unmodified** official extension.

### 12.2 Why Authentik Instead of Building Custom Auth?

Authentik provides:

- Production-grade OAuth2/OIDC provider
- User management UI
- SSO, MFA, and directory sync
- Docker deployment
- No need to build login UI, password reset, email verification, etc.

The self-hosted API only needs to bridge Authentiks OAuth flow to Clerks API format.

### 12.3 Why PostgreSQL + SQLAlchemy?

- PostgreSQL provides robust relational storage with JSONB for flexible schema fields
- SQLAlchemy ORM provides type-safe queries and migration support via Alembic
- Matches the production Roo Code Cloud stack for easier compatibility testing

### 12.4 Why Separate Browser Auth Routes from Clerk API Routes?

The browser routes (`/extension/sign-in`, `/auth/clerk/callback`) handle the **OAuth redirect flow** — they are visited by the users browser. The Clerk API routes (`/v1/client/sign_ins`, etc.) are called by the **VS Code extension** programmatically. Keeping them separate ensures clean separation of concerns and makes the auth flow debuggable.
