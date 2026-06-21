# Merge `main` into `feature/self-hosted-cloud-backend`

**Date:** 2026-06-03
**Branch:** `feature/self-hosted-cloud-backend`
**Merging in:** `main` @ `27d0c8e75` (71 commits ahead of merge base `adea58c12`)

## Situation

`main` had advanced 71 commits — the **Tumble rebrand** + the **Zoo PR port wave**.
The feature branch (8 commits) is mostly the **self-hosted cloud backend** (a standalone
`self-hosted-cloudapi/` Python app + extension-side cloud auth/config wiring).

The collision: as part of the rebrand, `main` **deliberately removed the entire "roo"
cloud router provider** (documented in `ai_plans/2026-05-26_22-35_remove-roo-router-provider.md`)
— handler, fetcher, schema, types enum, settings UI, welcome screen, CLI onboarding,
image-gen, and i18n. The feature branch had extended that same provider for the
self-hosted backend.

16 files had textual conflicts; `main` also cleanly deleted roo references in ~20
non-conflicting files (auto-staged), so a naive "keep ours" would have left the tree
non-compiling.

## Decision (user)

- **Adopt `main` fully, including the router-provider removal.**
- **Keep only the self-hosted `CloudService` auth/config** (self-hosted URL overrides +
  Clerk auto-detect in `packages/cloud`). Drop the built-in roo proxy _provider_.
- **Brand kept strings as Tumble** (`tumblecode.dev`).

This is close to `main`'s own direction, so the resolution is "take theirs almost
everywhere; preserve the self-hosted auth layer in `packages/cloud` + its extension wiring."

## Resolutions

| File                                                                                                            | Resolution                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cloud/src/config.ts`                                                                                  | Keep our self-hosted auth layer (runtime overrides, Clerk auto-detect, provider-URL knob); rebrand the 3 `PRODUCTION_*` URLs to `*.tumblecode.dev`.                                                                                 |
| `packages/cloud/src/__tests__/config.spec.ts`                                                                   | Rebrand expected URLs to Tumble.                                                                                                                                                                                                    |
| `src/api/providers/roo.ts`, `__tests__/roo.spec.ts`, `webviewMessageHandler.rooBalance.spec.ts`                 | `git rm` (router provider gone).                                                                                                                                                                                                    |
| `src/api/providers/fetchers/modelCache.ts`, `src/core/webview/webviewMessageHandler.ts`, `src/extension/api.ts` | Take `main` (router cases removed; verified no self-hosted-only content of ours).                                                                                                                                                   |
| `src/extension.ts`                                                                                              | Drop the roo-models-cache block in `authStateChangedHandler` (match `main`); drop now-unused `getRooCodeProviderUrl` import. **Preserve** the `syncCloudUrls()` / `registerCloudUrlsSubscription()` wiring (non-conflicting, kept). |
| 7 `*.spec.ts` cloud mocks                                                                                       | Keep both getters (`getRooCodeApiUrl` + retained `getRooCodeProviderUrl`), `localhost:8080` values.                                                                                                                                 |
| `.gitignore`                                                                                                    | Trivial blank-line conflict — drop.                                                                                                                                                                                                 |

## Non-conflicting breakage fixed (the subtle part)

- **`src/package.json`**: our 3 cloud settings auto-merged under the legacy
  `roo-cline.*` prefix while `main` moved all schema keys to `tumble-code.*`
  (`Package.name`). Renamed `cloudApiUrl`/`cloudProviderUrl`/`clerkBaseUrl` to
  `tumble-code.*` so they are actually read.
- **`src/__tests__/extension.spec.ts`**: merged `extension.ts` now runs
  `syncCloudUrls()` at activation, which `main`'s `vscode` mock didn't anticipate:
    - `getConfiguration().get` returned `[]` for all keys → `.trim()` threw. Made it
      key-aware (returns `undefined` for the string cloud-URL settings).
    - Added `setRooCodeApiUrl`/`setRooCodeProviderUrl`/`setClerkBaseUrl` to the
      `@roo-code/cloud` mock (called by `syncCloudUrls`).
    - Added `workspace.onDidChangeConfiguration` mock (used by
      `registerCloudUrlsSubscription`).
- NLS (`src/package.nls.json`): rebranded the 3 cloud-setting description examples.

## Verification

- `pnpm --filter @roo-code/cloud check-types` — clean.
- `pnpm --filter tumble-code check-types` — clean.
- `packages/cloud` config spec — 20/20.
- `extension.spec.ts` — 2/2 (the activation tests that exercise `syncCloudUrls`).
- The 6 previously-conflicted `ClineProvider.*` specs — 60/60.
- `git grep` for dangling `getRooModels`/`RooHandler`/`rooDefaultModelId`/`provider: "roo"`
  in non-test source — none.

## Not yet done

- Merge **not committed** (awaiting user).
- Full `pnpm test` / `pnpm lint` across all packages not run (only affected specs).
