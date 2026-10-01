# Zoo PR #40 — Align DeepSeek router model expectations

**Upstream:** Zoo-Code PR #40 (`fix/deepseek-router-model-tests`), merged 2026-05-08
**Branch:** `feature/zoo-40-deepseek-router-model-tests` (off `main`)
**Type:** Test-only coverage. No production code changes.

## What the upstream PR does

DeepSeek was added as a dynamic router-model provider in `webviewMessageHandler`
(`requestRouterModels`). This PR backfills the test expectations that assert that
behavior across three spec files:

1. `ClineProvider.spec.ts` — adds `deepseek: {}` to three expected aggregate router maps.
2. `webviewMessageHandler.spec.ts` — adds `deepseek: {}` to three expected aggregate router maps.
3. `webviewMessageHandler.routerModels.spec.ts` — adds DeepSeek-specific provider-filter
   coverage:
    - aggregate fetch includes a `deepseek` key that stays `{}` and `getModels` is NOT
      called with `provider: "deepseek"` when no DeepSeek credentials are stored;
    - fetches DeepSeek models when stored `deepSeekApiKey`/`deepSeekBaseUrl` exist
      (`getModels({ provider: "deepseek", apiKey, baseUrl })`) and populates
      `routerModels.deepseek`;
    - posts `singleRouterModelFetchResponse` (`success: false`) and keeps an empty
      `routerModels.deepseek` when the DeepSeek fetch throws.

## State of our fork

- **Source already supports DeepSeek router models** — `webviewMessageHandler.ts`
  initializes `deepseek: {}` in the aggregate map (line 999), gates the candidate on
  `deepSeekApiKey` (lines 1068–1081) calling
  `getModels({ provider: "deepseek", apiKey: deepSeekApiKey, baseUrl: deepSeekBaseUrl })`,
  and on rejection posts `singleRouterModelFetchResponse` with
  `values: { provider: "deepseek" }` and sets `routerModels.deepseek = {}`.
  → The PR's assertions all match our shipped behavior.
- **`ClineProvider.spec.ts`** already contains all three `deepseek: {}` entries. No change.
- **`webviewMessageHandler.spec.ts`** already contains all three `deepseek: {}` entries. No change.
- **`webviewMessageHandler.routerModels.spec.ts`** has NO DeepSeek references and has
  **diverged** from upstream (our "defaults to aggregate fetching" test asserts only
  `openrouter`/`requesty`; the upstream `roo`-based filter test does not exist here).
  → Cannot apply the patch verbatim; adapt the PR's intent to our file.

## Plan (TDD — these tests pin already-working source)

Edit only `src/core/webview/__tests__/webviewMessageHandler.routerModels.spec.ts`:

1. Extend the existing "defaults to aggregate fetching when no provider filter is sent"
   test to also assert `routerModels` has a `deepseek` property equal to `{}` and that
   `getModelsMock` was never called with `provider: "deepseek"` (no stored creds).
2. Add test: **fetches DeepSeek models when stored DeepSeek credentials exist** — stub
   `getState` with `deepSeekApiKey`/`deepSeekBaseUrl`, have `getModelsMock` return a
   DeepSeek model for `provider: "deepseek"`, assert the exact `getModels` call args and
   the populated `routerModels.deepseek`.
3. Add test: **posts a DeepSeek provider error and keeps an empty aggregate entry when
   DeepSeek fetch fails** — stub `deepSeekApiKey`, make `getModelsMock` throw for
   `provider: "deepseek"`, assert the `singleRouterModelFetchResponse` error payload and
   that `routerModels.deepseek` stays `{}`.

Tumble naming: no user-facing strings involved; internal provider id `deepseek` and
config keys `deepSeekApiKey`/`deepSeekBaseUrl` are unchanged (internal IDs stay).

## Verification

- `pnpm --filter <core pkg> vitest run` on the touched spec (or targeted vitest) — green.
- Build gate: `pnpm install:vsix -y --editor=code` — must be green before push.

## Credit

Co-authored-by: Toray Altas <toray.altas@gmail.com>
