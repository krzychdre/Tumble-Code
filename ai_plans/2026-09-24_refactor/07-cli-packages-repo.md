# CLI, packages, workspace boundaries, repository hygiene

Phase 3 takes PKG-1 to PKG-5 and PKG-10; Phase 8 takes CLI-5, PKG-6, PKG-7 and CLI-9. Defects: `02-defects.md` C26
to C30. Dead-weight removal (evals, ipc, unused dependencies) is in `03-dependencies.md` DEP-1 and DEP-2.

## The workspace graph as it really is

Declared (`workspace:` dependencies), no package-level cycles:

```text
types (leaf, runtime dep: zod)     vscode-shim (leaf)     build (leaf)     agent-interchange (leaf by package.json)
core -> types        cloud -> types        telemetry -> types        ipc -> types (node-ipc)
evals -> ipc, types                        web-evals -> evals, types
src (tumble-code) -> agent-interchange, cloud, core, ipc, telemetry, types   (dev: build)
webview-ui -> types          vscode-e2e -> types (dev)          vscode-nightly -> build (dev)
apps/cli -> core, types, vscode-shim
```

Violations the declared graph hides:

1. **Packages import app source.** `packages/core/src/index.ts:6` imports `../../../src/utils/safeWriteJson.js`
   (added in #166) and `packages/agent-interchange/src/install/config.ts:5` imports
   `../../../../src/utils/safeWriteJson.js` (#139). Since `src` depends on `core`, this is a file-level cycle, and it
   is why `apps/cli` must declare `proper-lockfile` and `json-stream-stringify` itself.
2. **`src/shared` is a hidden package.** No `package.json`; the webview reaches it through the `@roo/*` alias
   (`webview-ui/tsconfig.json:25`, `vitest.config.ts:22`); it mixes browser-safe code with host-only code
   (`modes.ts:1, 12` import `vscode` and core; `cloud-urls.ts` imports `vscode` and `@roo-code/cloud`).
3. **The webview uses `@roo-code/core` without declaring it** (resolved through `src/node_modules` via
   `src/shared`); `webview-ui/vitest.config.ts:3` imports `../src/utils/vitest-verbosity`.
4. **Turbo cache blind spot [I]:** turbo hashes a workspace's own files and declared dependencies, so the
   webview's cached lint, type-check and test results ignore changes in `src/shared` and `packages/core`; a local
   `pnpm test` can replay a stale success.
5. **The CLI cannot reach `src/shared`** (only the `@/*` alias; tsup bundles core, types and vscode-shim). This
   asymmetry is the root cause of the duplication in CLI-5.
6. **Untyped runtime contract between CLI and extension:** the CLI loads `src/dist/extension.js` with a patched
   `Module._resolveFilename` and sets `global.vscode` and `global.__extensionHost`
   (`apps/cli/src/agent/extension-host.ts:386-446`); the extension reacts to `ROO_CLI_RUNTIME`
   (`ClineProvider.ts:1333`, `ExecuteCommandTool.ts:60`) and `ROO_CLI_CODEX_AUTH_ONLY` (`extension.ts:135`).
   Nothing documents or types this.
7. **Nothing enforces boundaries:** no `no-restricted-imports`, dependency-cruiser or similar rule.

## Where the prior plan (`refactor-packages.md`) stands

| Item                                                        | Status                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 Split `vscode-extension-host.ts`                        | OPEN and growing (920 to 966 lines; `payload?: any` at 111)                                                                                |
| 1.2 Provider descriptors                                    | PARTIAL (#126 added `provider-registry.ts`); a second copy of the 21 per-provider schemas appeared in `provider-config/configs.ts` (PKG-7) |
| 1.3 Telemetry split                                         | OPEN, no drift yet (47 enum members, all in the schema)                                                                                    |
| 1.4 Tool descriptors                                        | OPEN (see CORE-R4)                                                                                                                         |
| 2.1 Generic `Registry<K,V>`                                 | OPEN, low value; drop                                                                                                                      |
| 2.2 `safeJsonParse` everywhere                              | OPEN (`consolidateApiRequests.ts:71, 79`, `consolidateTokenUsage.ts:43, 83`, `task-history/index.ts:51`)                                   |
| 4.1 Slim CloudService, 4.2 decouple RetryQueue from VS Code | OPEN (`CloudService` 503 lines, env if/else at 122-139; `RetryQueue` imports `vscode` types, uses `workspaceState` at 50, 67)              |
| 5.1 Remove telemetry wrappers, 5.2 `resetInstance`          | OPEN and growing (30 wrappers, 292 to 380 lines)                                                                                           |
| 7.1 Busy-wait in the esbuild helper                         | OPEN (`packages/build/src/esbuild.ts:75`)                                                                                                  |
| 9.1 Shared eslint config                                    | holds (all 14 configs import `@roo-code/config-eslint`)                                                                                    |
| 10.1 "Graph is clean, types is a leaf"                      | **REGRESSED** (violation 1)                                                                                                                |
| 10.3 Shared vitest preset                                   | drop (configs are 8 to 17 lines)                                                                                                           |

## Phase 3 items

### PKG-1 Move `safeWriteJson` into `packages/core`

`src/utils/safeWriteJson.ts` (261 lines) depends only on `fs`, `path`, `proper-lockfile`, `json-stream-stringify`.
Move it and its test to `packages/core/src/fs/`; `src`, the CLI and agent-interchange import it from
`@roo-code/core`; the CLI drops its duplicate dependency declarations. **Existing:**
`src/utils/__tests__/safeWriteJson.test.ts`, `importExport.spec.ts` (mocks it), `agent-interchange install.spec.ts`,
`apps/cli settings.test.ts`. **Size** S.

**Status (2026-09-24):** DONE in #264. Code in `packages/core/src/fs/safeWriteJson.ts` (exports `@roo-code/core` and
`@roo-code/core/fs`); `src/utils/safeWriteJson.ts` is a one-line re-export so the ~25 `vi.mock` specs keep working;
agent-interchange imports `@roo-code/core/fs`; the CLI bundles proper-lockfile and json-stream-stringify (tsup banner
adds `createRequire`); `src` keeps `proper-lockfile` as a devDependency so `vi.mock("proper-lockfile")` reaches core.

### PKG-2 Boundary rules

1. `no-restricted-imports` in `packages/config-eslint/base.js` forbidding relative imports that leave a workspace
   (`../../../src/*` and similar), warning level first, error after PKG-1.
2. A rule forbidding `vscode` in the files the webview consumes (the TEST-8 bundle guard is the runtime backstop).
3. Close the turbo blind spot: declare `@roo-code/core` in `webview-ui/package.json` and add `../src/shared/**` to
   the webview task inputs in `turbo.json` until PKG-6 makes it a real package.

**Test first:** a lint fixture showing an escaping import is rejected. **Size** S.

**Status (2026-09-24):** DONE in #266. Local rule `boundaries/no-relative-import-outside-package`
(`packages/config-eslint/boundaries.js`, error level, nearest-`package.json` check, covers import/export/require/
`vi.mock`), spec `boundaries.test.mjs`; `vscode` forbidden in `src/shared/**` except `modes.ts` (CORE-R10),
`cloud-urls.ts` and `vsCodeSelectorUtils.ts` (SVC-16/PKG-6); webview declares `@roo-code/core` (knip-ignored until
PKG-6); webview turbo inputs include `src/shared/**`. Open: `packages/build` test inputs miss the two esbuild.mjs
files its spec reads; the vscode rule sees only direct imports.

### PKG-3 One esbuild configuration for release and nightly

`apps/vscode-nightly/esbuild.mjs` (178 lines) is a hand copy of `src/esbuild.mjs` (156) and drifted (DEF-C30).
Export `createExtensionBuildOptions({nightly})` from `packages/build` and use it in both. **Test first:** nightly
options include the release externals and alias. **Existing:** `packages/build` esbuild spec. **Size** S to M.

**Status (2026-09-24):** already DONE in #245 together with DEF-C30 (`createExtensionBuildOptions` in `packages/build`,
used by `src/esbuild.mjs` and `apps/vscode-nightly/esbuild.mjs`, spec `extension-build-options.spec.mjs`). Open
follow-up for the owner: `bundle:nightly` runs without `--production` (never minified), and under `--production`
the nightly turns sourcemaps off while the release keeps them.

### PKG-4 Pin every render-critical CLI dependency in the release

`apps/cli/package.json` pins only `ink 6.6.0`; `createReleaseManifest` copies semver ranges and `install.sh:229` runs
`npm install --production` without a lockfile, so the installed CLI has React 19.3.0 while development uses 19.2.3,
and ink's own dependencies (`yoga-layout`, `string-width`, `wrap-ansi`, `cli-truncate`, `react-reconciler`) float.
This is the documented source of past dev versus installed rendering skew. **Change:** bundle `ink`, `react`,
`zustand` and ink's dependencies with tsup `noExternal`, leaving only native or optional modules external (or write
exact lockfile versions into the manifest and ship `npm-shrinkwrap.json`). **Test first:** the manifest or the
bundle metafile resolves react, react-reconciler, yoga-layout and ink to the lockfile versions. **Size** S.

**Status (2026-09-24):** DONE in #268. tsup `noExternal` list `BUNDLED_DEPENDENCIES` (workspace packages, ink, react,
zustand and their deps; yoga WASM is inlined; only `react-devtools-core` stays external); `createReleaseManifest` drops
bundled packages and pins the rest to lockfile versions (`readInstalledVersion`); `cli-release.yml` and `build.sh` now
use it (the workflow had a hand-written list with the removed `@inkjs/ui` and without `execa`);
`loadReactProductionBuilds` is async `import()` so the bundled React still picks the production build. Spec
`cli-bundle.test.ts` reads the tsup metafile. JS in dist 1.41 to 3.12 MB, release node_modules 59 to 36 MB. Pre-existing,
not fixed: `--ephemeral` ENOENT "Failed to save Roo messages"; npm installs typescript as a peer of `@trpc/client`.

### PKG-5 Type and document the CLI runtime contract

A small `packages/types` module `cli-runtime.ts` naming the environment variables and the `globalThis` slots
(`vscode`, `__extensionHost`) with their types; the extension and the CLI read them through it. Documented in
PKG-10. **Size** S.

**Status (2026-09-24):** DONE in #270. `packages/types/src/cli-runtime.ts`: `CLI_RUNTIME_ENV` (6 variables:
`ROO_CLI_RUNTIME`, `ROO_MCP_SETTINGS_PATH`, `ROO_CLI_CODEX_AUTH_ONLY`, `ROO_CLI_ROOT`, `ROO_EXTENSION_PATH`,
`ROO_RIPGREP_PATH`), `readCliRuntimeEnv(env)`, `CLI_RUNTIME_GLOBAL_SLOTS` (`vscode`, `__extensionHost`),
`setCliRuntimeGlobals`/`clearCliRuntimeGlobals`. `packages/vscode-shim` still reads the slots by literal name
(do-not-touch; `CliExtensionHostSlot` mirrors its `IExtensionHost` by hand); `build.sh` and the integration scripts
still use literal names.

### PKG-10 Architecture map

`docs/architecture.md` (one page): the workspaces and what each owns, the allowed dependency directions (enforced
by PKG-2), the CLI runtime contract (PKG-5), where settings defaults live (CORE-R1), how a message travels from the
webview to a handler (CORE-R3) and from a provider stream to the chat row (API-7, WEB-1), and the "do not touch"
list. It is updated by every later item that moves a boundary. This answers the owner's goal directly: a person new
to the code needs one page before touching it.

**Status (2026-09-24):** DONE in #272. `docs/architecture.md` (workspaces, mermaid dependency graph, the three
boundary checks, CLI runtime contract, current settings-defaults locations, webview-to-handler and
stream-to-chat-row paths with the items that will change them, do-not-touch list); linked from README and AGENTS.md.
The externals list now lives in `packages/build/src/extension.ts` (`extensionExternals`), not `src/esbuild.mjs`.

## Phase 8 items

### CLI-5 Remove the CLI's re-implementations, one bug per slice

Each slice: a failing CLI test reproducing the bug, then the shared rule moves into `packages/types` or
`packages/core` (browser-safe) and the CLI (and, where it applies, `src/shared` or the webview) imports it.

| Slice                                                                          | CLI copy                                                                       | Canonical logic                                                               | Known drift                                                                                                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Tool payload parsing and display                                             | `apps/cli/src/ui/utils/tools.ts:9-246` (~240 lines, untested)                  | `ChatRow.tsx:457-1113` (~650 lines)                                           | DEF-C26 `batchFiles`; 9 unknown tool names (`readArtifact`, `searchTaskHistory`, `webSearch`, `webFetch`, ...); 10 dead snake_case cases |
| 2 Context window                                                               | `context-window.ts:14-62`                                                      | static model tables plus router models                                        | DEF-C27                                                                                                                                  |
| 3 Provider table and key requirements                                          | `provider-types.ts:95-226`, `provider-config.ts:97`                            | `webview-ui/src/provider-validation-registry.ts`, `getProviderDefaultModelId` | Ollama treated as keyless though `ollamaApiKey` exists; wrong default model (DEF-C27)                                                    |
| 4 Follow-up answers                                                            | four sites                                                                     | `packages/types/src/followup.ts`                                              | DEF-C28                                                                                                                                  |
| 5 JSON output cost, ask-type sets, todo regex, path equality, mention escaping | `json-event-emitter.ts:791, 846`, hand-written `Set<string>`s, `arePathsEqual` | core equivalents                                                              | DEF-C28; `resume_completed_task` classified differently; `TodoChangeDisplay.tsx` (119 lines) dead                                        |

**Existing:** CLI tool specs (`FileReadTool`, `FileWriteTool`, `CommandTool`, `GenericTool`), `context-window.test`,
`provider-types.test`, `provider-config.test` (locks in the wrong default model at 33-41 and 74-93; update
deliberately), `useFollowupCountdown.test`, `ask-dispatcher.test`, `json-event-emitter-*.test`, `path.test`.
**Size** M per slice, medium risk. After PKG-1 and PKG-6 where `src/shared` is involved.

### PKG-6 Turn the browser-safe part of `src/shared` into a real package

`src/shared` is 2,856 lines in 26 files, imported 50 times by the webview. Move the pure modules (`tools.ts`
constants, `context-mentions`, `parse-command`, `todo`, `cost`, `array`, `language`, `experiments`, the `api` types)
into `packages/types` (data) or a browser-safe entry of `packages/core` (logic); keep the host-only parts in `src`
(`getAllModesWithPrompts`, `cloud-urls`, `vsCodeSelectorUtils`, `package.ts`); leave re-export stubs during the
migration; the webview declares the package. **Gate:** TEST-8 bundle guard, the 17 specs in `src/shared/__tests__`,
the webview suite. After SVC-16 and CORE-R10. **Size** M.

### PKG-7 One copy of the per-provider settings schemas in `packages/types`

A script comparison found `providerConfigSchemas` (`provider-config/configs.ts`, 21 providers) identical to the arms
of `providerSettingsSchemaDiscriminated` (`provider-settings.ts:294-316`) except the secret fields (deliberate) and
one real drift (the openai config has `apiModelId`, the legacy arm does not); `providerFieldOwnership` is a third
list. **Change:** build each legacy arm as `configSchema.extend(secretFieldsFor(id))`; fix `modelIdKeysByProvider`
in the same change (DEF-C15). **Test first:** for every provider, legacy fields minus secrets equal config fields
(fails today on openai). Goes with API-6. **Size** M.

### CLI-9 One state machine and smaller functions in the CLI

**Evidence:** in TUI mode every extension message is interpreted twice: `ExtensionClient` into `MessageProcessor`
into `StateStore` (`extension-host.ts:452-456`) and `useMessageHandlers` (705 lines) into the zustand store
(`useExtensionHost.ts:132-141`); `JsonEventEmitter` (810 lines) is a third interpreter. `runStdinStreamMode`
(`stdin-stream.ts:342-977`) is one 636-line function with only its command parser tested; `AppInner`
(`ui/App.tsx:93-760`) is 668 lines with about 40 hooks and no test renders `App`. The CLI has 21.6k source lines
and 14.4k test lines. **Change:** extract `useTranscriptPromotion`, `useMcpPanel`, `useAutocompleteTriggers` from
`AppInner`; make `ExtensionClient` the only interpreter and have the TUI subscribe to it; split
`runStdinStreamMode` into a command router plus handlers. **Test first:** an `App` characterization test through
the injectable `createExtensionHost` prop and ink-testing-library, replaying recorded message sequences and
snapshotting frames; a stdin-stream test with a fake host. **Size** L, high risk (fragile Ink rendering; see the
"do not touch" list in the master plan). After CLI-5 and TEST-1.

### PKG-11 Remaining `packages/*` structure (lowest priority)

Split `vscode-extension-host.ts` into per-domain message unions (additively, superset first); derive the telemetry
schema list from the enum and remove the 30 `captureXxx` wrappers in favor of a typed `capture(event, props)`
(the enum stays the runtime source of truth, 188 value usages); `TelemetryService.resetInstance` for tests; slim
`CloudService` (environment resolution into a function); decouple `RetryQueue` from `vscode` behind a storage
interface; replace the busy-wait at `packages/build/src/esbuild.ts:75`; `safeJsonParse` at the listed sites. Only
after CLI-5 and PKG-6, because by then three consumers (extension, webview, CLI) share these types. **Size** L.

## Repository hygiene (PKG-8 and PKG-9, Phase 2 or 3)

### PKG-8 Clean the root and the package metadata

| Item                             | Evidence                                                                                                                                                                                                                                                 | Action                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `releases/`                      | 76 upstream release PNGs, 112.9 MB of the 139.7 MB tracked tree (81%); referenced only by `.roo/commands/release.md` and 75 image links in `CHANGELOG.md`                                                                                                | owner decision 3 (decided): delete it and drop the links; history stays (a history rewrite is not recommended) |
| Upstream notes                   | `progress.txt` (February 2026), `spotted-errors/` (6 files, 1.6 MB), `COGNITIVE_COMPLEXITY_ANALYSIS.md` (36 KB), `MEMORY_SYSTEM_ANALYSIS.md` (194 KB), `ellipsis.yaml` (an upstream review bot), `.github/workflows/update-contributors.yml` (never run) | move analysis files to `ai_plans/archive/`, delete the rest                                                    |
| `self-host-cloud-backend-run.sh` | runs `alembic upgrade`, while the API now bootstraps through `db_bootstrap`; referenced only from `spotted-errors/` [I stale]                                                                                                                            | verify, then delete or fix                                                                                     |
| Local clutter (not tracked)      | empty `memory/`, the 25 MB `tumble-cli-linux-x64.tar.gz` and 33 MB `bin/`                                                                                                                                                                                | make the CLI `build.sh` write its tarball into `bin/`                                                          |
| `apps/web-roo-code/`             | 0 tracked files, only `node_modules` and `.turbo` left after #20                                                                                                                                                                                         | delete locally                                                                                                 |
| `packages/types/src/cloud.ts:1`  | value import of `EventEmitter` used only as a type                                                                                                                                                                                                       | `import type`                                                                                                  |
| Publishable flags                | `cloud`, `core`, `ipc`, `telemetry`, `agent-interchange` are not `"private": true`; the fork cannot publish to the `@roo-code` scope [I]                                                                                                                 | mark private                                                                                                   |

**Status (2026-09-24):** DONE in #251. `releases/` and its 75 CHANGELOG image links deleted; analyses moved to
`ai_plans/archive/`; `progress.txt`, `spotted-errors/`, `ellipsis.yaml`, `update-contributors.yml` and the stale
`self-host-cloud-backend-run.sh` deleted; CLI `build.sh` writes its tarball into `bin/`; `import type` in
`cloud.ts`; `cloud`, `core`, `telemetry`, `agent-interchange` marked private (`types` keeps its publish script).
Local clutter (`memory/`, root tarball, `apps/web-roo-code/`) left in the owner's tree for the owner to delete.
Found, not done: `self-hosted-cloudapi/README.md:147` and the Makefile `migrate` target still run
`alembic upgrade head`, which fails on an empty database; `.roo/commands/release.md` still names the changeset
package `"roo-cline"` instead of `"tumble-code"`.

### PKG-9 CI gaps

- `apps/vscode-e2e` is never run in CI (maintained, 7 commits since May): decide between a manual workflow
  (`workflow_dispatch`) and a nightly schedule.
- The CLI integration suite (`apps/cli/scripts/integration`, 15 cases) is not in CI and uses `--provider roo`,
  which no longer exists: port it to the `fake-ai` provider or delete it.
- **Owner decisions (2026-09-24, Phase 3):** vscode-e2e runs from a manual `workflow_dispatch` workflow; the CLI
  integration suite is ported to the `fake-ai` provider and added to CI; PKG-4 bundles ink, react and their
  dependencies with tsup `noExternal` (not shrinkwrap).
- `packages/ipc` has 0 tests (moot: DEP-1 removes it, owner decision 1) and `packages/telemetry` has 1 test file for 646 lines.

**Status (2026-09-24):** DONE in #273. CLI integration suite ported to `fake-ai` through `ROO_CLI_FAKE_AI_MODULE`
(`apps/cli/src/lib/utils/fake-ai-module.ts`, scripted model `scripts/integration/lib/fake-model.ts`, per-case temp HOME),
15/15 locally incl. with no network; CI job `cli-integration` in `code-qa.yml`. Manual `vscode-e2e.yml`
(`workflow_dispatch`, xvfb); `runTest.ts` now reads the VS Code version from `engines.vscode` (it defaulted to 1.101.2,
which rejected the extension after DEP-4). Without keys the OpenRouter suites skip; `providers/zai.test` times out
(attempt_completion recorded but never executed; cause unknown, own item). Found: CLI stdin echo can precede its
`requestId` (race in `promoteRequestIdForDequeuedMessages`); integration scripts are not type-checked;
`packages/telemetry` still has 1 test file.

## Do not touch

The Ink render pipeline until CLI-9's tests exist; the externals in `src/esbuild.mjs` and `--no-dependencies`
packaging (align nightly to them); the security pins in the root overrides; the runtime value of the
`TelemetryEventName` enum; the flat `providerSettingsSchema` (partial profiles are valid); the public shape of
`ExtensionMessage` and `WebviewMessage` until PKG-6 and CLI-5 are done; `packages/vscode-shim`; `apps/vscode-nightly`,
`scripts/agent-bench` and the root `locales/` READMEs (active).

**Follow-up (2026-09-25): red main after Phase 3, fixed in #275 (merge c283b0a30).** Main's Code QA was red for
four reasons, none of them flaky tests. (1) `scripts/check-unused-locals.mjs` (API-Q, #265) spawned
`src/node_modules/.bin/tsc`, which exists only by accident on a developer machine because `src` does not declare
`typescript`; it now resolves `typescript/bin/tsc` like Node does and runs it with `process.execPath`. (2) The
`@vscode/ripgrep` postinstall got HTTP 403 from GitHub (anonymous rate limit); the shared `setup-node-pnpm` action
now passes `GITHUB_TOKEN` to the install step, and `code-qa.yml` got `permissions: contents: read`. (3) Windows:
the CLI test lockfile reader split on `\n` only (CRLF checkout); tsup treats array entries as globs, so a
backslash path never matched (the probe is now passed as an object entry); and `src` and `webview-ui` each ran a
nested `turbo run bundle` in `pretest`, so two bundles copied `README.md` at once (EBUSY). Both `pretest` scripts
are gone; `test` depends on `tumble-code#bundle` in the packages' `turbo.json`. Consequence for developers:
`pnpm test` inside `src` or `webview-ui` no longer bundles first (run `pnpm bundle`, or test from the root).
(4) `ChatView.clear-approval-buttons` was flaky: jsdom delivers `postMessage` via `setTimeout(0)`, after `act()`
returned; the spec now dispatches the message event inside `act()`.
