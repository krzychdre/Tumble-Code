# D15: shared vitest preset, one environment variable table

Roadmap item: `ai_plans/2026-09-27_simplification-roadmap.md`, section 3, D15 ("eight near-identical
`vitest.config.ts`; cloud URLs spread over five or more environment variables, two of them dead. Fix:
`@roo-code/config-vitest` preset; one table of environment variables in `docs/`.").
Branch: `refactor/d15-vitest-preset` (off `main` @ `3108e5ad4`).

## What was on main

- Ten `vitest.config.ts` files (the roadmap said eight): `src`, `webview-ui`, `apps/cli` and seven packages
  (`agent-interchange`, `build`, `cloud`, `core`, `telemetry`, `types`, `vscode-shim`). Eight of them repeated the same
  block: `globals: true`, `environment: "node"`, `watch: false`, `exclude: [...configDefaults.exclude, "**/dist/**"]`
  with the same three-line comment. `src` and `webview-ui` shared `src/utils/vitest-verbosity.ts`, which
  `webview-ui` imported across the workspace boundary (`../src/utils/...`, the boundaries warning recorded in
  `2026-09-26_re-enable-eslint-rules.md`). No config sets coverage or a pool; the only pool-like setting is the Windows
  CI `maxWorkers: 1` in `src`.
- `packages/config-eslint` and `packages/config-typescript` already existed; the new package mirrors
  `config-eslint` (private, `type: module`, plain JS, `node --test` specs).
- `docs/09-environment-variables.md` already existed (F4). It listed `ROO_CODE_PROVIDER_URL` as dead and left its
  removal to D15; `ROO_SDK_BASE_URL` was already removed in D6.

## The preset: `packages/config-vitest`

- `index.js` exports `sharedTestConfig` (the four common settings), `defineRooVitestConfig(overrides)` (vite
  `mergeConfig` of the shared settings and the workspace's own: objects merge, arrays append) and `resolveVerbosity()`
  (moved unchanged from `src/utils/vitest-verbosity.ts`, which is deleted). `index.d.ts` types it for the TS configs.
- Plain JS because vitest bundles each `vitest.config.ts` but loads imported packages with Node directly.
- Every workspace that runs vitest has `"@roo-code/config-vitest": "workspace:^"` in `devDependencies`, so pnpm links
  it, turbo sees the edge and knip sees the import. `pnpm-lock.yaml` changes only in the importers section (+36 lines).
- `__tests__/preset.test.mjs` (10 `node:test` cases) pins the shared values, the merge rules (scalar override,
  added fields, appended exclude, no mutation of the shared object between calls) and every verbosity branch.

Config size, lines per file:

| Workspace                    | Before  | After   | What stays in the file                                             |
| ---------------------------- | ------- | ------- | ------------------------------------------------------------------ |
| `src`                        | 39      | 30      | verbosity, setup file, 20 s timeouts, Windows CI cap, vscode alias |
| `webview-ui`                 | 31      | 24      | verbosity, setup file, jsdom, include glob, four aliases           |
| `apps/cli`                   | 22      | 19      | `@` alias, 120 s timeouts, include globs                           |
| `packages/agent-interchange` | 22      | 16      | 30 s timeouts (with their reason)                                  |
| `packages/build`             | 20      | 12      | `@roo-code/build` source alias                                     |
| `packages/cloud`             | 17      | 9       | vscode mock alias                                                  |
| `packages/core`              | 12      | 3       | nothing                                                            |
| `packages/telemetry`         | 12      | 3       | nothing                                                            |
| `packages/types`             | 11      | 3       | nothing                                                            |
| `packages/vscode-shim`       | 12      | 3       | nothing                                                            |
| **Total**                    | **198** | **122** | plus 73 lines of preset and 16 of types                            |

## Equivalence evidence

Method: a throwaway script (outside the repo) called vitest's own `resolveConfig()` from `vitest/node` for each
workspace, once on `main` and once on the branch, and printed the whole resolved `test` object plus `resolve.alias` as
sorted JSON (about 4,200 lines per workspace; functions printed as source text). The random fields (`api.token`,
`seed`, the vite `webSocketToken`) differ on every run and are ignored below. Also `vitest list --filesOnly` in each
workspace, before and after.

Result, per workspace (apart from the random fields):

| Workspace                                                                          | Resolved-config differences                                                                                                                                                    | Spec files before = after |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `packages/core`, `telemetry`, `vscode-shim`, `build`, `cloud`, `agent-interchange` | none                                                                                                                                                                           | 23, 2, 23, 6, 21, 8       |
| `packages/types`                                                                   | `providedOptions.environment` false to true: `environment: "node"` is now set explicitly; the resolved `environment` was and is `"node"` (vitest's default)                    | 40                        |
| `apps/cli`                                                                         | `exclude` gains `**/dist/**`; the include globs are under `src/`, so no file changes                                                                                           | 99                        |
| `webview-ui`                                                                       | `exclude` gains `**/dist/**` (include is `src/**`, no file changes); `onConsoleLog` source text differs only by comments; the verbosity helper leaves `configFileDependencies` | 231                       |
| `src`                                                                              | `providedOptions.environment` as in types; `onConsoleLog` comments; the verbosity helper leaves `configFileDependencies`                                                       | 622                       |

The vite loader warnings (`__dirname`, ESM in a CJS-loaded file) are the same set as before, minus the two that the
deleted `src/utils/vitest-verbosity.ts` and webview's extensionless cross-workspace import produced.

Smoke run, one small spec per workspace with `--maxWorkers=2`, all passing: `apps/cli` figures (1 test),
`agent-interchange` mcp-tool-schemas characterization (2), `build` sleep-sync (3), `cloud` cloudEnvironment (5), `core`
array (7), `telemetry` TelemetryService.payloads (40), `types` message (1), `vscode-shim` create-vscode-api-mock (1),
`src` utils/path (21), `webview-ui` DeleteButton (1). `tsc --noEmit` is clean in all ten workspaces (most include
`*.config.ts`, so the configs are type-checked against `index.d.ts`).

## Cloud URL environment variables

Audit on `3108e5ad4`: every `process.env.X` in `src`, `apps`, `packages`, `webview-ui` and `scripts` (51 names) was
checked against the doc, and every name in the doc against the code.

| Variable                | Reader                                                   | State                             |
| ----------------------- | -------------------------------------------------------- | --------------------------------- |
| `ROO_CODE_API_URL`      | `packages/cloud/src/config.ts` `getRooCodeApiUrl`        | live, `cloudApiUrl` setting wins  |
| `CLERK_BASE_URL`        | `packages/cloud/src/config.ts` `getClerkBaseUrl`         | live, `clerkBaseUrl` setting wins |
| `ROO_AUTH_BASE_URL`     | `apps/cli/src/types/constants.ts` (`tumble auth login`)  | live                              |
| `POSTHOG_HOST`          | `packages/telemetry/src/PostHogTelemetryClient.ts`       | live                              |
| `ROO_CODE_PROVIDER_URL` | `getRooCodeProviderUrl`, no caller outside 15 spec mocks | **dead, removed here**            |
| `ROO_SDK_BASE_URL`      | none                                                     | already removed in D6             |

Removed with `ROO_CODE_PROVIDER_URL`: `getRooCodeProviderUrl`, `setRooCodeProviderUrl`,
`PRODUCTION_ROO_CODE_PROVIDER_URL`, the `tumble-code.cloudProviderUrl` setting (package.json, 19 `package.nls*.json`,
README machine-scoped list), its wiring in `src/activate/cloud-urls.ts`, the mock entries in 15 specs, and the dead
variable in the CLI `dev:local` script and README. A test in `packages/cloud/src/__tests__/config.spec.ts` pins that
the module exports nothing named like a provider URL (it failed on main with the three names).

Doc gaps closed in `docs/09-environment-variables.md`: `GITHUB_ACTIONS` (now read by the preset),
`ROO_CLI_FAKE_AI_MODULE` (CLI integration seam, read through a constant so the first grep missed it),
`VSCODE_TEXTMATE_DEBUG` (webview build `define`) and `npm_execpath` (bootstrap). The "dead variables" section became
"removed variables" plus a one-line summary of the remaining cloud URL family. The reverse check found no documented
variable without a reader (the pydantic settings are read by field name, lower-case, which is why a plain grep for
`RETENTION_SWEEP_ENABLED` finds nothing).

## Residuals

- `ClineProvider.stateBuilder.spec.ts` fails 6 golden snapshots on main already: `uiDensity` (added by #570) is missing
  from the snapshot. Not touched here.
- A user who had set `tumble-code.cloudProviderUrl` sees it as an unknown setting; nothing changed at runtime.
- The preset is not listed in any config file's `configFileDependencies` (vite does not track files under
  `node_modules`); with `watch: false` everywhere this has no effect.
