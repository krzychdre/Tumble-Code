# Cloud: remove endpoints and client code nothing calls (B6)

Status: done on `chore/cloud-remove-dead-endpoints`, PR open. Stacked on `fix/cloudapi-compose-single-defaults` (A8,
PR #676) because both edit `docker-compose.yml`, `.env.example`, `config/settings.py` and docs/09.

## Touched files

Server (`self-hosted-cloudapi/`):

- deleted: `src/routers/marketplace.py`, `src/services/marketplace_service.py`, `src/schemas/marketplace.py`,
  `config/marketplace/{modes,mcps}.yaml`, `tests/test_marketplace_cache.py`
- `src/main.py` (router no longer included), `src/routers/extension.py` (`/credit-balance` gone),
  `src/routers/browser.py` (`/extension/provider-sign-up`, `/l/{slug}` and the `screen_hint` parameter gone)
- `config/settings.py`, `docker-compose.yml`, `.env.example`: `MARKETPLACE_SOURCE`, `MARKETPLACE_YAML_DIR` gone
- `pyproject.toml`, `uv.lock`: `pyyaml` moved from runtime to the `dev` extra (`uv lock --offline`, three lines change)
- tests: `test_route_table.py`, `test_route_boilerplate.py`, `test_config_bootstrap.py`, `test_browser_auth.py`,
  `test_auth_redirect_validation.py`
- `README.md` endpoint list

Client:

- `packages/cloud/src/CloudAPI.ts` (`creditBalance` gone), `CloudService.ts`, `WebAuthService.ts`,
  `StaticTokenAuthService.ts` (`login()` without parameters, `handleCallback` without `providerModel`)
- `packages/types/src/cloud.ts` (`AuthService` interface), `vscode-extension-host.ts` (`WebviewMessage.useProviderSignup`),
  `vscode-extension-host/state.ts` (`ExtensionState.cloudAuthSkipModel`)
- `src/activate/handleUri.ts` (`provider_model` query), `src/core/webview/messageHandlers/cloudAuth.ts`,
  `ClineProvider.ts`, `ProviderStateBuilder.ts` (`getCloudAuthSkipModel`)
- specs and snapshots of the above; `packages/cloud/src/__tests__/CloudAPI.creditBalance.spec.ts` deleted
- docs/08-cloud.md, docs/09-environment-variables.md

## Problem (evidence)

- `GET /api/marketplace/{modes,mcps}`: the extension reads the marketplace from GitHub since #642
  (`src/services/marketplace/RemoteConfigLoader.ts`); `git grep api/marketplace` over src, webview-ui, packages, apps
  finds nothing.
- `GET /api/extension/credit-balance`: always `{"balance": 0}`; its only caller `CloudAPI.creditBalance()` was called
  only by its own spec.
- `/extension/provider-sign-up` and `/l/{slug}`: built only by `WebAuthService.login(landingPageSlug,
useProviderSignup)`. The only caller is `rooCloudSignIn` in `cloudAuth.ts`, which passed `undefined` for the slug
  and `message.useProviderSignup`, and no sender sets that field (`useCloudUpsell.ts:60` and `CloudView.tsx:83` post
  `{ type: "rooCloudSignIn" }`).
- `providerModel` branch of `WebAuthService.handleCallback`: wrote `roo-provider-model` (no reader anywhere) and
  `roo-auth-skip-model`. The latter WAS read: `ClineProvider.ts:304` -> `ProviderStateBuilder` ->
  `ExtensionState.cloudAuthSkipModel`, but nothing in webview-ui or apps/cli reads that field
  (`git grep cloudAuthSkipModel`), so the whole chain is removed. The server never sends `provider_model` in the
  callback URL (`git grep provider_model self-hosted-cloudapi` is empty), so `handleUri.ts` stops reading it.

## Fix

Delete the routes, the service, the YAML catalog, the settings and their tests; delete the client methods and
parameters; remove the two optional type fields. `test_route_table.py` pins the reduced route set.

Tests that used `/api/extension/credit-balance` only as a probe for the extension's Bearer token check
(`test_route_boilerplate.py`: bad, expired, foreign-issuer, session and static tokens; "opens no database session")
now probe `GET /api/extension/bridge/config`, which also depends on nothing but the token, and assert the `userId`
the token resolved to. The sign-in route tests keep `/extension/sign-in`.

## Type-surface changes

- `WebviewMessage.useProviderSignup` (optional) removed: no sender sets it. `vscode-extension-host-surface.spec.ts`
  pins the field list and is updated.
- `ExtensionState.cloudAuthSkipModel` (optional) removed: no reader.
- `AuthService.login()` and `handleCallback(code, state, organizationId?)` lose their unused parameters.

## Tests

- cloudapi: whole suite 913 passed, 1 xfailed (was 952 with the deleted marketplace and credit tests).
- packages/cloud: CloudService.test, WebAuthService.spec, StaticTokenAuthService.spec (124 passed).
- packages/types: vscode-extension-host-surface, vscode-extension-host-message-types.
- src: handleUri, webviewMessageHandler.routing (snapshot: `CloudService.login` now has no arguments),
  ClineProvider.stateBuilder (snapshot: `cloudAuthSkipModel` gone).
- tsc: packages/types, packages/cloud, src, webview-ui. eslint and prettier on touched files. `pnpm knip` exit 0.

## Notes

- `pyyaml` stays installed in the image through `uvicorn[standard]`; the direct runtime pin was only for the
  marketplace loader. The dev extra keeps it for `tests/test_compose_settings_defaults.py`.
- `hide_marketplace_mcps` (org settings column) is unrelated (extension settings) and stays.
- An operator's `.env` may still carry `MARKETPLACE_*`; `extra="ignore"` keeps it loading.
