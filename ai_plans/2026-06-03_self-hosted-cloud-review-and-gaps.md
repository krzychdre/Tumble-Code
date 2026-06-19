# Self-Hosted Cloud Feature — Document Review & Gap Analysis

**Date:** 2026-06-03  
**Reviewed documents:**

1. `progress.txt`
2. `ai_plans/self-hosted-cloud-api-architecture.md`
3. `ai_plans/2026-05-16_fix-self-hosted-auth-404.md`
4. `ai_plans/2026-06-03_merge-main-into-self-hosted-cloud-backend.md`
5. `self-hosted-cloudapi/README.md`
6. `self-hosted-cloudapi/src/main.py`
7. `self-hosted-cloudapi/config/settings.py`

---

## 1. `progress.txt` — Reapplication Progress (rc6 branch)

### Summary

Tracks the cherry-pick progress of merging upstream Roo Code PRs into a custom branch (`rc6`). Covers 5 batches of PRs, post-cherry-pick fixes, and validation results. This document is about the **extension-side** rebase, not the Python backend directly.

### TODOs / Open Issues

- **Pre-push hook failure**: `generate-built-in-skills.ts` was removed by PR #11414 but `package.json` still references it in `prebundle`. Noted as "expected" and deferred.
- **5 deferred PRs** (AI-SDK entangled): #11379, #11418, #11422, #11315, #11374 — cannot be cherry-picked because they depend on AI-SDK which the custom branch doesn't have.

### Planned but Not Done

- No explicit plan for resolving the AI-SDK-dependent PRs.

---

## 2. `ai_plans/self-hosted-cloud-api-architecture.md` — Architecture Plan

### Summary

Comprehensive 1149-line architecture document covering the entire self-hosted backend: Clerk-compatible auth facade, Authentik OAuth, database schema (12 tables), FastAPI routers, LLM proxy, marketplace, Docker deployment, and a 5-phase implementation roadmap.

### TODOs / Open Issues / Gaps vs. Implementation

| Architecture Plan Item                                                                                                                                                                                                                  | Current Status                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`services/` directory** — Plan specifies 8 service files (`auth_service.py`, `user_service.py`, `settings_service.py`, `share_service.py`, `telemetry_service.py`, `marketplace_service.py`, `proxy_service.py`, `bridge_service.py`) | ✅ All 8 exist on disk                                                                                                                                                                                                              |
| **`models/marketplace.py`** — Plan specifies a marketplace DB model                                                                                                                                                                     | ❌ **Not implemented** — no `marketplace.py` in `src/models/`. Marketplace only loads from YAML, not database.                                                                                                                      |
| **`schemas/user.py`** — Plan specifies user schemas                                                                                                                                                                                     | ✅ Exists                                                                                                                                                                                                                           |
| **Database mode for marketplace** (§10.2) — "For multi-tenant deployments, marketplace items stored in `marketplace_entries` table and managed via admin API"                                                                           | ❌ **Not implemented** — only YAML mode works. No `marketplace_entries` table, no admin API.                                                                                                                                        |
| **Org-level marketplace filtering** (§10.3) — `hiddenMcps`, `hideMarketplaceMcps`, org-specific MCPs prepended                                                                                                                          | ❌ **Not implemented** — `marketplace_service.py` only loads from YAML with no org filtering.                                                                                                                                       |
| **Google/xAI provider implementations** (§6.3) — Plan lists `google/` and `xai/` routing                                                                                                                                                | ❌ **Not implemented** — `proxy/router.py` routes `google/` and `xai/` prefixes but there are no provider classes for them; they fall through to default (OpenAI). No `providers/google.py` or `providers/xai.py` files exist.      |
| **Anthropic streaming SSE conversion** (§6.4) — "Convert to/from OpenAI format" for Anthropic                                                                                                                                           | ⚠️ **Partially implemented** — `anthropic.py` streams raw Anthropic bytes rather than converting SSE chunks to OpenAI format on-the-fly. The non-streaming path does convert responses.                                             |
| **Usage tracking and rate limiting per org** (Phase 4)                                                                                                                                                                                  | ❌ **Not implemented** — no per-org usage tracking.                                                                                                                                                                                 |
| **Admin API for user/org/model management** (Phase 5)                                                                                                                                                                                   | ❌ **Not implemented**                                                                                                                                                                                                              |
| **Comprehensive test coverage** (Phase 5)                                                                                                                                                                                               | ⚠️ **Partial** — only 4 test files exist: `test_auth.py`, `test_browser_auth.py`, `test_jwt_issuer.py`, `test_sign_in_flow.py`. The plan specifies tests for settings, share, events, marketplace, and proxy — none of these exist. |
| **`.env.example`**                                                                                                                                                                                                                      | ✅ Exists                                                                                                                                                                                                                           |
| **Alembic migrations** (§5 — "Database migrations for all schema changes")                                                                                                                                                              | ⚠️ Only a baseline migration exists (`a1b2c3d4e5f6_baseline.py`) plus a datetime timezone one. Schema changes may not be fully tracked.                                                                                             |
| **Dockerfile uses `poetry`** (§8.1)                                                                                                                                                                                                     | ⚠️ **Stale** — The plan's Dockerfile references `poetry` but the project actually uses `uv` (per README and `pyproject.toml`). The actual `Dockerfile` likely differs.                                                              |

### Phase Completion Assessment

| Phase   | Description                   | Status                                                                                                                                          |
| ------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1 | Core Auth + API Skeleton      | ✅ Mostly complete (auth, JWT, sessions, tickets, Clerk facade)                                                                                 |
| Phase 2 | Settings + Extension API      | ✅ Complete (settings, share, bridge, credit-balance stubs)                                                                                     |
| Phase 3 | Telemetry + Marketplace       | ⚠️ Partial (telemetry endpoints exist; marketplace is YAML-only, no org filtering, no DB mode)                                                  |
| Phase 4 | LLM Proxy                     | ⚠️ Partial (OpenAI + Anthropic + Custom providers work; Google/xAI missing; Anthropic streaming not fully converted; no per-org usage tracking) |
| Phase 5 | Polish + Production Readiness | ❌ Not started (no admin API, limited tests, no security audit, no deployment guide)                                                            |

---

## 3. `ai_plans/2026-05-16_fix-self-hosted-auth-404.md` — Auth Fix

### Summary

Documents a critical bug where the sign-in flow returned HTTP 404 on `POST /v1/client/sessions/{id}/tokens`. The root cause: the sign-in handler created a **new** session+token pair instead of binding the token to the **existing** ticket's session, so the client token didn't match the session ID the client used.

### Fix Applied

- Split `create_client_token()` from `create_session_and_token()` in auth_service
- Sign-in now binds the token to the ticket's session (not a new one)
- OAuth callback no longer creates an orphan client token

### TODOs / Open Issues (Explicitly Out of Scope)

The document lists these as **"Out of scope — tracked separately"**:

1. **Anthropic streaming SSE conversion** (`anthropic.py:114-125`)
2. **Authentik groups → `org_id` mapping** (`browser.py:278`) — still has `org_id = None  # TODO: Map Authentik groups to organizations`
3. **Marketplace org filtering**
4. **Google/xAI providers**
5. **Alembic as source-of-truth**

### Test Plan

The document specifies 4 test cases for `test_sign_in_flow.py`. Checking the actual file, all 4 cases are implemented ✅.

---

## 4. `ai_plans/2026-06-03_merge-main-into-self-hosted-cloud-backend.md` — Merge Plan

### Summary

Documents merging `main` (71 commits ahead, including the Tumble rebrand + Zoo PR port wave) into `feature/self-hosted-cloud-backend`. The key conflict: `main` removed the "roo" cloud router provider, while the feature branch had extended it.

### Resolution

- Adopted `main` fully (including router-provider removal)
- Kept only the self-hosted `CloudService` auth/config layer in `packages/cloud`
- Rebranded strings to Tumble (`tumblecode.dev`)
- Fixed non-conflicting breakage in `src/package.json` (cloud settings prefix) and `extension.spec.ts` (mock updates)

### TODOs / Not Yet Done

1. **Merge not committed** — awaiting user confirmation
2. **Full `pnpm test` / `pnpm lint` not run** — only affected specs were verified
3. **Dangling references check** — only checked for `getRooModels`/`RooHandler`/`rooDefaultModelId`/`provider: "roo"` in non-test source. Broader cleanup may be needed.

---

## 5. `self-hosted-cloudapi/README.md` — Backend README

### Summary

Documents the quick-start, environment setup, extension configuration, authentication flow, Authentik setup, and API endpoint listing. References the architecture plan for full details.

### TODOs / Gaps

- Architecture link is wrong: references `../plans/self-hosted-cloud-api-architecture.md` but the actual path is `../ai_plans/self-hosted-cloud-api-architecture.md`
- No mention of the Google/xAI provider gap
- No mention of missing admin API
- No documentation of the credit system stub (`TODO: Implement actual credit tracking`)
- No documentation of the Authentik groups → org mapping gap

---

## 6. `self-hosted-cloudapi/src/main.py` — Application Entry Point

### Summary

FastAPI app with lifespan handler that creates all DB tables on startup, registers 7 routers (auth, browser, extension, settings, events, marketplace, proxy), configures CORS, request logging, and optional rate limiting.

### Observations

- All planned routers are wired up ✅
- `AuthentikStateStore` model imported (used for OAuth state/PKCE storage) ✅
- Version is `0.1.0` — indicates early development stage
- No health-check beyond basic `{"status": "ok"}` — no DB connectivity check, no dependency checks

---

## 7. `self-hosted-cloudapi/config/settings.py` — Configuration

### Summary

Pydantic `BaseSettings` class with 20+ config fields covering core, JWT, Authentik OAuth, CORS, LLM proxy, marketplace, and optional features.

### Gaps vs. Architecture Plan

| Plan Setting                         | Implemented?                                            |
| ------------------------------------ | ------------------------------------------------------- |
| `jwt_algorithm`                      | ✅ (default HS256)                                      |
| `jwt_private_key` / `jwt_public_key` | ✅ (optional, for RS256)                                |
| `jwt_secret`                         | ✅ (optional, for HS256)                                |
| `authentik_app_slug`                 | ✅ (extra, not in plan)                                 |
| `google_api_key`                     | ✅ (setting exists, but no provider implementation)     |
| `xai_api_key`                        | ✅ (setting exists, but no provider implementation)     |
| `marketplace_source`                 | ✅ (only "yaml" mode works; "database" not implemented) |
| `credit_system_enabled`              | ✅ (flag exists, but credit tracking is a stub)         |
| `bridge_enabled`                     | ✅ (returns hardcoded `ws://localhost:8080/ws`)         |

---

## Consolidated TODO / FIXME / Gap List

### Explicit TODOs in Source Code

| Location                      | TODO                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------- |
| `src/routers/extension.py:64` | `# TODO: Implement actual credit tracking` — returns hardcoded `{"balance": 0}` |
| `src/routers/browser.py:281`  | `# TODO: Map Authentik groups to organizations` — `org_id` is always `None`     |

### Unimplemented Architecture Plan Features

1. **Google AI provider** — routed but no provider class exists; falls back to OpenAI
2. **xAI/Grok provider** — same situation as Google
3. **Anthropic streaming SSE→OpenAI conversion** — raw bytes forwarded, not converted chunk-by-chunk
4. **Marketplace database mode** — only YAML loading is implemented
5. **Marketplace org-level filtering** — `hiddenMcps`, `hideMarketplaceMcps`, org-specific MCPs not applied
6. **Admin API** — no endpoints for user/org/model management
7. **Per-org usage tracking** — no tracking of LLM proxy usage
8. **Per-org rate limiting** — rate limiter exists but is global, not per-org
9. **Bridge WebSocket** — `bridge_service.py` returns hardcoded `ws://localhost:8080/ws`
10. **Credit system** — flag exists but always returns 0
11. **Security audit** — Phase 5 item, not started
12. **Deployment guide** — Phase 5 item, not started
13. **Comprehensive tests** — only auth/JWT/browser tests exist; missing: settings, share, events, marketplace, proxy tests

### Merge-Related Open Items

1. **Merge not committed** — the `main` → `feature/self-hosted-cloud-backend` merge is awaiting user confirmation
2. **Full test suite not run** — only affected specs were verified after the merge
3. **Dockerfile stale** — plan references `poetry` but project uses `uv`

### Documentation Issues

1. **README architecture link** — points to `../plans/` instead of `../ai_plans/`
2. **No `.env.example` contents documented** — file exists but README just says "copy and fill in"

---

## Phase Completion Diagram

```
Phase 1 ✅ Complete
├── Auth Facade (Clerk-compatible endpoints)
├── JWT Issuance (HS256/RS256)
├── Authentik OAuth Flow
├── Docker + docker-compose Setup
└── Integration Tests (sign-in flow)

Phase 2 ✅ Complete
├── Organization Settings CRUD
├── User Settings CRUD (optimistic locking)
├── /api/extension/share
├── /api/extension/bridge/config
└── /api/extension/credit-balance (stub)

Phase 3 ⚠️ Partial
├── ✅ Telemetry Events (/api/events, /api/events/backfill)
├── ✅ Marketplace YAML Loading
├── ❌ Marketplace Database Mode
└── ❌ Org-Level Marketplace Filtering

Phase 4 ⚠️ Partial
├── ✅ OpenAI Proxy Provider
├── ✅ Anthropic Proxy Provider (non-streaming conversion works)
├── ✅ Custom/OpenAI-Compatible Proxy Provider
├── ✅ Image Generation Proxy (OpenAI + Custom only)
├── ❌ Google AI Provider
├── ❌ xAI/Grok Provider
├── ❌ Anthropic Streaming SSE→OpenAI Conversion
└── ❌ Per-Org Usage Tracking & Rate Limiting

Phase 5 ❌ Not Started
├── ❌ Admin API (user/org/model management)
├── ❌ Comprehensive Test Coverage
├── ❌ Security Audit
└── ❌ Deployment Guide
```

---

## Recommended Priority Actions

1. **Fix Authentik groups → org mapping** (`browser.py:281`) — without this, all users end up with no organization, breaking org-scoped features
2. **Fix Anthropic streaming SSE conversion** — raw Anthropic bytes break the VS Code extension's SSE parser which expects OpenAI format
3. **Commit the main→feature merge** — the longer it sits uncommitted, the more drift
4. **Add missing tests** — settings, share, events, marketplace, proxy endpoints have zero test coverage
5. **Fix README architecture link** — `../plans/` → `../ai_plans/`
6. **Update Dockerfile** — align with `uv` instead of `poetry`
