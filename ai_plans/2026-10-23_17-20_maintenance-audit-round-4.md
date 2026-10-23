# Maintenance audit round 4 (2026-10-23): refactoring and dependency refresh

**Status:** done (round executed 2026-10-23, PRs #918 to #996). Audit of `main` @ `af10d6bcb`.
**Related plans:** `simplification_round3_audit_2026-10-02.md` (round 3, all 12 items done, its "NOT worth doing"
list still stands), `2026-10-01_simplification-round-2.md`, `2026-09-27_simplification-roadmap.md`.
**Touched:** each item below landed as its own branch, changeset and plan doc (`ai_plans/2026-10-23_*_r4-*.md`).

## Method and evidence base

- `pnpm outdated -r`: 97 outdated entries (22 patch, 43 minor, 32 major or 0.x line bumps). Last dependency commits
  on `main` were all manual security bumps (#800, #865); no bot PR exists.
- `gh pr list --search "author:app/renovate"` and `author:app/dependabot`: zero PRs ever. `renovate.json` was inherited
  from upstream (2025-05-05) and edited for the fork, but the Renovate app is not installed on this repository.
- Last `code-qa.yml` run on `main` carries the annotation: "Node.js 20 is deprecated. The following actions target
  Node.js 20 but are being forced to run on Node.js 24: actions/cache, actions/checkout, actions/setup-node,
  pnpm/action-setup".
- `uv lock --upgrade --dry-run` in `self-hosted-cloudapi`: 25 updates available, among them `fastapi` 0.141 to 0.161
  and `sqlalchemy` 2.0.54 to 2.1.6.
- `pnpm knip`: exit 1, only the two duplicated zoo-port scripts (by design, see round 3).
- `pnpm dedupe --check`: 25 duplicate versions could be collapsed (execa, globals, ignore, lru-cache, semver, debug,
  vite, vitest, yaml and others).
- `jscpd` (min 12 lines, 90 tokens, production TypeScript only): 12 exact clones, 338 lines, 0.22% of the scanned
  code. All 12 are listed under B8.
- Line census (non-test): `src` 115.7k lines, `webview-ui/src` 47.4k, `apps/cli/src` 24.4k, `packages/*` 31.5k,
  `self-hosted-cloudapi/src` 15.6k. Largest files: `ClineProvider.ts` 2690 (2216 after round 3), `TaskApiLoop.ts`
  1764 (1643), `Task.ts` 1764 (1695), `TaskHistoryStore.ts` 1686 (unchanged), `RunParallelTasksTool.ts` 824,
  `apps/cli/src/agent/extension-host.ts` 873, `apps/cli/src/commands/cli/run.ts` 805.
- Test to source ratio: `src` 1.92, `packages/cloud` 1.82, `packages/core` 1.49, `webview-ui` 1.21, `apps/cli` 0.97,
  `packages/types` 0.43 (mostly data). The `ClineProvider*.spec.ts` family alone is 20 files, 15714 lines, against
  2690 lines of code (5.8x).
- Three read-only code audits (host, CLI + webview, tests + Python + docs), every claim spot-checked by grep before
  it entered this document. Counts in the findings are the spot-checked ones.

## Executive summary: top items by value for effort

1. **Dependency automation is dead (A1, A2).** Renovate never ran; CI actions are on deprecated Node 20 majors.
   Decide Renovate app vs Dependabot, bump the GitHub Actions. One short session, removes a growing backlog.
2. **Anthropic SDK 1.x (A4a).** Our most used SDK (76 importing files) moved to a new API version on 2026-10-21.
   A planned major with the existing characterization specs as the net.
3. **ClineProvider grew by 474 lines since round 3 (B1 to B4).** Four small, low-risk cleanups and one medium
   extraction (the window-wide panel registry out of the per-panel class).
4. **Twelve exact code clones (B8).** The Gemini model table is copied into the Vertex table (114 lines); the
   remaining ten are 17 to 38 lines each, all in provider and context code.
5. **Test hygiene (E1 to E8).** Echo tests, duplicated describes, a tautological test, a 925-line "edge cases"
   block that runs one code path, 12 copies of the same inline `vscode` mock, and a routing snapshot whose stated
   purpose (prove the CORE-R3 split moved code) is fulfilled.
6. **CLI `run()` at 650 lines and friends (C1 to C8).** Dead flags, unreachable branches and eight copies of one
   prompt pattern in the CLI; five dead props on `CodeBlock` in the webview (D1).

---

## A. Dependencies

### A1. Choose the update bot and make it run (owner decision)

**Status:** #923 (Dependabot; `renovate.json` removed).

- **Evidence:** `renovate.json` (schedule, grouping, majors disabled) exists and is well thought out, but no
  Renovate PR was ever opened; the Renovate GitHub App is not installed on `krzychdre/Tumble-Code`. No
  `.github/dependabot.yml` exists either. Refactor plan decision 10 chose Renovate; "Renovate vs Dependabot" is
  still listed as open in the plan memory.
- **Options:** (a) install the Renovate app (Mend) on the repository: the config is ready, groups and the
  Monday schedule start working at once; (b) write `.github/dependabot.yml` with the same groups (npm via pnpm,
  `uv` for the Python service, `github-actions`, `docker`) and delete `renovate.json`. Dependabot needs no third
  party app and supports pnpm lockfiles, uv and grouped updates; Renovate additionally supports pnpm catalogs (A5d)
  and `lockFileMaintenance`. Recommendation: (a), because the config and the decision already exist.
- **Effort:** S. **Risk:** none. **Verify:** a bot PR appears within one scheduled window.

### A2. GitHub Actions on deprecated Node 20 majors

**Status:** #919 (plus an em dash fix in #933).

- **Evidence:** every pinned action is one to three majors behind: `actions/checkout` v4 (latest v7),
  `actions/cache` v4 (v6), `actions/setup-node` v4 (v7), `pnpm/action-setup` v4 (v6), `actions/upload-artifact`
  v4 (v7), `actions/download-artifact` v4 (v8), `actions/github-script` v7 (v9), `github/codeql-action` v3 (v4),
  `changesets/action` v1 (v2), `astral-sh/setup-uv` v10.2.0 (v10.3.2). Three of them (`hmarr/auto-approve-action`,
  `changesets/action`, `actions/github-script`) are tag-pinned while the rest are SHA-pinned.
- **Proposal:** bump each to the latest major, SHA-pin all of them the same way, keep the `# vN` comment. Check
  the v5+ `actions/checkout` default of `persist-credentials` against the release workflows that push.
- **Effort:** S. **Risk:** low (workflows are the test). **Verify:** the next `code-qa.yml` run shows no
  "Node.js 20 is deprecated" annotation; `grep -rn 'uses:' .github | grep -v '@[0-9a-f]\{40\}'` is empty.

### A3. Safe batch: patch and minor npm updates, then dedupe

**Status:** #941, #953 (replaces the closed #949), #973, #974, #978. Prettier 3.9 moved to its own item: #995 reformat, #996 blame ignore. The final
verification PR (`chore/r4-final-green`) pins the CLI's `@vscode/ripgrep` back to ~1.17.1: 1.18 moved `rg` into
per-platform packages, which the CLI's lookup and its release build do not read.

- **Scope (minor, grouped as in `renovate.json`):** provider SDKs `openai` 7.23 to 7.43, `@google/genai` 2.24 to
  2.31, `@aws-sdk/*` 3.1140 to 3.1156, `@lmstudio/sdk` 2.0 to 2.1 (still needs zod 3, the override stays),
  `@qdrant/js-client-rest` 1.19 to 1.20, `ollama` 0.6.4; dev tooling `eslint` 10.13, `typescript-eslint` 8.72,
  `knip` 6.42, `turbo` 2.11, `tsx` 4.23, `prettier` 3.9, `vitest`/`vite` 5.0.5/8.3.5, `jsdom` 30.1.3;
  webview `@radix-ui/*` (ten packages), `@tanstack/react-query` 5.104, `lucide-react` 1.61, `mermaid` 12.2,
  `shiki` 4.5, `react-virtuoso` 4.18, `tailwind-merge` 3.7, `i18next` 26.5, `react-i18next` 17.1, `date-fns` 4.4,
  `lru-cache` 11.5; host `mammoth` 1.13, `uuid`, `yaml`, `tiktoken`, `turndown`, `ignore` 7.0.13 (two workspaces),
  `zustand` 5.0.16 (CLI), `react`/`react-dom` 19.3.1 (exact pin, both workspaces).
- **Then:** `pnpm dedupe` to collapse the 25 duplicate versions the check reported.
- **Effort:** S to M (one PR per group, full suites once per group). **Risk:** low; React 19.3.1 and the Radix
  bumps get the webview suite plus a manual look at the chat and settings views. **Verify:** `pnpm outdated -r`
  lists only majors; `pnpm dedupe --check` reports nothing.

### A4. Planned majors (one branch each, in this order)

**Status:** per sub-item below.

a. **`@anthropic-ai/sdk` 0.128 to 1.2.0, `@anthropic-ai/vertex-sdk` 0.19 to 1.1.0.** The 1.0.0 entry in the SDK
changelog (2026-10-21) has one breaking change: "add support for new API version 2026-10-21"; 1.1 and 1.2 add
user profile enforcement, message threads and cost reports (none used here). 76 files in `src` and `packages`
import the SDK, 149 of them from the package root (types mostly). Nets: `anthropic.spec.ts`,
`anthropic-vertex.spec.ts`, `bedrock-characterization.spec.ts`, `anthropic-protocol-characterization`. Read
the 2026-10-21 API version notes for changed defaults (the memory rule "SDK bumps need real-SDK
characterization specs" applies). **Effort:** M. **Risk:** medium.
**Status:** #982, plus #984 (bundle `@opentelemetry/api` into the extension).
b. **`@mistralai/mistralai` 2.7 to 3.1.** Five import sites (`mistral.ts`, `mistral-format.ts`). The breaking
list is in surface we do not use (`Runs`, `encode*`, beta records); one item to check is the `EventStream`
async iterator type, which our stream loop consumes. **Effort:** S. **Risk:** low.
**Status:** #985.
c. **`execa` 9 to 10** (three workspaces, two ranges today). Breaking: the subprocess is a plain promise, Node
`ChildProcess` members move to `subprocess.nodeChildProcess`; `execaCommand` removed; `input` now wins over
inherited stdin. Grep for `.on(`, `.kill(`, `.pid`, `execaCommand` on execa results before starting. New
`killDescendants` option is interesting for the command tool. **Effort:** S to M. **Risk:** medium (process
handling is where the CLI had its credential-prompt and timeout defects).
**Status:** #986.
d. **`ink` 7.1.1 to 8.0.0.** Requires React 19.3 (we have it). Breaking: `minWidth`/`maxWidth` numbers only,
generic stream types for stdin/stdout, `useInput` no longer delivers unrecognized control sequences (mouse,
focus, cursor reports). Several fixes target exactly what the CLI worked around by hand (incremental
rendering of single-line updates, scrollback preservation, `<Static>` replay). Plan: upgrade in a worktree,
run the App characterization snapshots, then re-test the known traps (ghost rows, stacked footers, tail
viewport height, ctrl+o live block) by hand. Some workarounds may become deletable. **Effort:** M.
**Risk:** medium.
**Status:** #993.
e. **`chokidar` 5 to 6** (host). Option renames (`interval` to `pollingInterval`), `close()` is terminal, native
recursive backend on macOS and Windows. Grep our `chokidar.watch(` options first. **Effort:** S.
**Status:** #987.
f. **`tsup` 8 to 9** (CLI, types): drops Node below 22.18, we are on 22.23.3. **Effort:** S.
**Status:** #988.
g. **Small majors with no API we use beyond the default export:** `@vscode/test-electron` 2 to 3, `mocha` 11 to
12, `nock` 14 to 15, `@dotenvx/dotenvx` 1 to 2, `globals` 16 to 17 (three workspaces), `google-auth-library`
10 to 11, `isbinaryfile` 5 to 6, `p-wait-for` 5 to 7, `safe-stable-stringify` 2 to 3, `serialize-error` 12 to
13, `debounce` 2 to 3, `fuzzysort` 3 to 4, `@vscode/codicons` 0.0.36 to 0.0.46, `katex` 0.18 to 0.19,
`ovsx` 1.3. One PR for the lot, read each changelog's breaking section while doing it. **Effort:** S to M.
**Status:** #989 and #990 (nock 15). Deferred: `mocha` 12 with `@vscode/test-electron` 3 (mocha 12 is ESM-only, the e2e suite is CommonJS), `serialize-error` 13 (changes the tool error text the model sees), `@dotenvx/dotenvx` 2 (adds 2 MB to the bundle), `google-auth-library` 11 (the SDKs still depend on ^10), `isbinaryfile` 6 (needs Node 24).
h. **`web-tree-sitter` 0.25 to 0.27 with `tree-sitter-wasms` 0.1.13.** The grammar WASM files must match the
runtime's ABI (`languageGrammars.ts:49` already documents one ABI mismatch). Verify in a worktree with the
tree-sitter spec family before merging. **Effort:** S. **Risk:** medium.
**Status:** skipped: the `tree-sitter-wasms` 0.1.13 grammars carry the legacy `dylink` section, the 0.26+ loader needs `dylink.0` (125 tests red).
i. **`@babel/core` 7 to 8** (webview, used by `@rolldown/plugin-babel` and `babel-plugin-react-compiler`).
Wait for the React Compiler plugin to declare Babel 8 support; check `npm view babel-plugin-react-compiler
   peerDependencies` first.
**Status:** skipped: `babel-plugin-react-compiler` declares no Babel 8 support.
j. **`undici` 7 to 8** (override `^7.29.0` and host dependency). Breaking: HTTP/2 on by default and the legacy
handler wrappers are gone. This touches proxies and every provider request. Defer until a reason appears;
when done, test against the local llama-swap and a corporate proxy. **Effort:** M. **Risk:** medium-high.
**Status:** deferred, as planned.
k. **`pnpm` 10.8.1 to 12.x.** Breaking: `onlyBuiltDependencies` becomes `allowBuilds`, `minimumReleaseAge`
defaults to one day (a supply-chain protection worth keeping), `.npmrc` holds auth only, `pnpm audit` filters
by GHSA ids (check `scripts/audit-allowlist.mjs` keys), `--frozen-lockfile false` is gone. The lockfile is
re-keyed once. Update `packageManager`, the composite action's default and `scripts/bootstrap.mjs` together.
**Effort:** M. **Risk:** medium (CI and every developer machine).
**Status:** #991, plus #992 (audit bumps for `follow-redirects` and DOMPurify).
l. **TypeScript 7.0.2 (the native compiler).** Our builds transpile with esbuild and tsup; `tsc` only type-checks.
Do a timed spike in a worktree: `pnpm check-types` before and after, plus the ESLint type-aware rules
(`typescript-eslint` 8.72 support for TS 7 must be confirmed). 7.1 is in beta. Keep 6.0.3 until the spike is
green. **Effort:** M for the spike. **Risk:** medium.
**Status:** #994, documentation only. Blocked by `typescript-eslint` (supports TypeScript below 6.1) and by tsup's dts build, which needs the compiler API. `check-types` took 59.8 s with tsc 6 and 10.5 s with TypeScript 7.
m. **Not planned:** `@types/node` 22 to 26 (the engine is Node 22.23.3; the types must match the runtime),
`@types/vscode` 1.103 to 1.140 and `engines.vscode ^1.102` (raise only when a newer API is needed; a low
floor keeps older VS Code builds working), Node 24 as engine (hypothesis to check: the extension host's Node
is set by VS Code's Electron, so the CLI would be the only beneficiary; revisit when VS Code ships Node 24).
**Status:** not planned, unchanged.

### A5. Dependency hygiene (one small PR)

**Status:** a to c #933, d #937. The final verification PR spells `@types/vscode` out in `src/package.json`, because
`vsce package` cannot parse `catalog:`.

a. **`esbuild-wasm` ^0.25 while `esbuild` is ^0.28.** The runtime transpiler for custom tools
(`packages/core/src/custom-tools/esbuild-runner.ts`) only passes CLI flags that exist in both, but two esbuild
lines in one tree is a trap. Align to ^0.28.2 and extend the root override. **Verify:** `grep -n esbuild-wasm
   src/package.json` shows ^0.28.
b. **`@types/jest` ^29 in `webview-ui`.** Nothing uses jest; `tsconfig.json` has `types: ["vitest/globals",
   "node"]`. The only reason it type-checks today is the redundant plain `import "@testing-library/jest-dom"` in
`webview-ui/vitest.setup.ts:1` next to the correct `/vitest` import on line 2. Delete the plain import and the
dev dependency. **Verify:** `pnpm --filter @tumble-code/vscode-webview check-types` green; `pnpm why
   @types/jest` empty.
c. **Audit the 12 `pnpm.overrides` floors** (`tar-fs`, `form-data`, `bluebird`, `brace-expansion`, `picomatch`,
`lodash-es`, `proxy-addr`, `glob`, `undici`, `jsdom>undici`, `rehype-katex>katex`, `@lmstudio/sdk>zod`). Each
was added for an advisory; some transitive dependencies may have moved past the floor on their own. Procedure:
in a scratch copy remove one override, run `pnpm install --lockfile-only --ignore-scripts`, keep the override
only if the lockfile changes. Record the advisory id next to each survivor. **Effort:** S to M.
d. **pnpm catalogs for the versions declared in many workspaces.** `vitest` is declared in 11 workspaces, `zod` in
9 (two spellings: `^4.6.5` and the exact `4.6.5`), `@types/node` in 14, `rimraf` in 5, `execa` in 3 (two ranges
`^9.5.2` and `^9.6.1`), `globals` in 3 (two ranges), `tsx`, `tsup`, `react`, `@types/react`, `ignore`, `openai`,
`i18next`, `axios`, `diff`, `fzf`, `pretty-bytes`, `p-wait-for` in 2 each. pnpm 10 supports a `catalog:` block
in `pnpm-workspace.yaml`; each `package.json` then says `"vitest": "catalog:"`. One place to bump, no more
range drift, and the `zod`/`typescript` overrides can go. Renovate updates catalogs; confirm Dependabot does
before choosing it in A1. **Effort:** S to M (mechanical). **Verify:** `grep -rn '"vitest": "' --include=package.json
   . | grep -v catalog | grep -v node_modules` is empty.

### A6. Python service (`self-hosted-cloudapi`)

**Status:** #924 (minors, base image, uv); SQLAlchemy 2.1 migrated in #929.

- **Updates available (dry run):** `fastapi` 0.141.1 to 0.161.1, `starlette` 1.7 to 1.9, `pydantic` 2.13.5 to
  2.14.1, `pydantic-settings` 2.16, `uvicorn` 0.54, `uvloop` 0.23, `asyncpg` 0.32, `alembic` 1.20.1, `pyjwt`
  2.15.1, `cryptography` 50.0.2, `websockets` 17.3, `certifi` 2026.10.23, and `sqlalchemy` 2.0.54 to 2.1.6.
- **SQLAlchemy 2.1 is the one to treat as a major** even though the `>=2.0.36` floor lets it in: it is a feature
  release with its own migration notes. Owner decision: either pin `sqlalchemy>=2.0.36,<2.1` and upgrade the rest
  now, or read the 2.1 notes and do the migration deliberately (the service uses `AsyncSession`, `select`, `update`,
  `delete`, `relationship`, `func`, nothing exotic). Recommendation: pin below 2.1 in this round, migrate in its own
  item.
- **Images and tools:** `python:3.13.15-slim` to 3.13.17 (new digest, see the Dockerfile comment for the
  procedure), `uv` 0.12.18 to 0.13.5 (digest), `astral-sh/setup-uv` v10.2.0 to v10.3.2. Python 3.14 in the CI
  matrix is a hypothesis to test, not a plan item.
- **Effort:** S (plus `pytest`, 119 test files). **Verify:** `uv lock --upgrade --dry-run` prints only SQLAlchemy
  if pinned; api image rebuilt and `/health/ready` green.

---

## B. Extension host (`src`)

### B1. ClineProvider: subagent panel bookkeeping posts twice and guards nothing (S)

**Status:** #927.

- **Where:** `ClineProvider.ts` 2200-2212 `cancelSubagent`, 2423-2430 `resetSubagentPanel`, 2451-2498
  `rehydrateSubagents`, 2501-2508 `readParentMessages`; about 110 lines.
- **Evidence:** `SubagentRegistry.clearSettled()` (`SubagentRegistry.ts:131-143`) already posts `subagentsUpdated`
  through its private `postUpdate()` when anything changed; `resetSubagentPanel` then posts the same message again
  (line 2426), and `rehydrateSubagents` builds it by hand a third time (2485). Three call sites (1163, 2017, 2532)
  wrap `resetSubagentPanel` in `try {} catch {}` labelled "Non-fatal: panel reset", but it cannot throw:
  `clearSettled` is synchronous map work and `postMessageToWebview` (1334-1347) swallows errors; the fourth call
  site (`clearTask`, 2517) has no try. `SubagentRegistry.clearForParent` is a one-line alias of `dropParent`.
- **Proposal:** make the registry's `postUpdate` public as `broadcast()`, delete the two hand-built posts and the
  three try/catch wrappers, delete the alias, move `rehydrateSubagents` and `readParentMessages` next to
  `subagentBackfill.ts` as functions over the registry.
- **Pinned by:** `rehydrateSubagents.spec.ts`, `ClineProvider.task-slot.spec.ts` (stubs the private methods at
  32, 81, 166, 483, 509; update the stubs).
- **Verify:** `grep -n 'type: "subagentsUpdated"' src/core/webview/ClineProvider.ts` empty;
  `grep -c "Non-fatal: panel reset" src/core/webview/ClineProvider.ts` is 0.

### B2. ClineProvider: task switching repeats "reset panel, leave task" four ways (S)

**Status:** #932.

- **Where:** `createTaskWithHistoryItem` 1147-1279 (133 lines), `showTaskWithId` 1542-1606 (five exits),
  `reattachTask` 2531-2545, `createTask` 1959-2069 (111 lines).
- **Evidence:** the "reset panel, then leave the current task" sequence appears four times with three error-handling
  styles (`createTask` also wraps `leaveCurrentTask` in a silent catch). The pending-edit replay is 42 lines inline
  (1235-1276) with an immediately-invoked function at 1247-1253. `cloudUserInfo` and `taskSyncEnabled` (1181-1182)
  are destructured and never read. `if (configuration)` at 1966 is always true (parameter defaults to `{}`).
- **Proposal:** one private `switchAwayFromCurrentTask()`; move the replay into
  `PendingEditOperations.replayInto(task, operationId)`; delete the dead destructures and the always-true branch.
  `cancelTask` (2286-2394) stays untouched (abort ordering is on the do-not-touch list).
- **Pinned by:** `checkpointRestoreHandler.spec.ts`, `webviewMessageHandler.checkpoint.spec.ts`,
  `ClineProvider.task-slot.spec.ts`.
- **Verify:** `grep -c "leaveCurrentTask()" src/core/webview/ClineProvider.ts` drops to 2.

### B3. ClineProvider: ten one-line delegators to `backgroundTaskRunner` (S)

**Status:** #939.

- **Where:** 2110-2284, about 175 lines mostly doc comments; 12 `this.backgroundTaskRunner.` forwards.
- **Evidence:** `createBackgroundTask`, `resolveSubagentProfile`, `awaitTaskCompletion` are used only by
  `RunParallelTasksTool`; `memoryWriterQuery`, `notifyBackgroundOutcome` only by `TaskLifecycle`;
  `setMemoryActivity` only by `Task`. `subagentRegistry` and `backgroundSubagents` are already public readonly
  fields on the provider, so the pattern exists.
- **Proposal:** expose `backgroundTaskRunner` the same way and delete the six runner delegators (three consumer
  files change). The `modeProfiles` and `taskHistory` forwards that implement `*Host` interfaces stay (they are
  load-bearing seams, see D3 in the roadmap).
- **Verify:** `grep -n "this.backgroundTaskRunner\.\(createBackgroundTask\|awaitTaskCompletion\|memoryWriterQuery\)"
src/core/webview/ClineProvider.ts` empty.

### B4. ClineProvider: the window-wide panel registry lives in a per-panel class (M)

**Status:** #951.

- **Where:** static fields 130-136, observer loop 280-283, `onSharedSettingsChanged` 533-557, running tasks
  722-770, instance lookups 893-955, `postStateToAllWebviewsWithoutClineMessages` 979-987, `getInstance` 989-1006;
  about 170 lines. New since round 3: `observeInstances`, `getLastActiveInstance`, `findTaskHost`, `getEditorTab`,
  `getRunningTasksOfAllPanels`, `postRunningTasksToAllPanels`, `mostRecentlyActive`.
- **Evidence:** window-wide state (`activeInstances`, `activationCount`, `instanceObservers`, `activatedAt`,
  `runningTasksInView`, `sharedSettingsPushTimer`) is mixed into the per-panel class; a static method reads private
  `_disposed` and `getOwnRunningTasks` of other instances; a state builder has the hidden side effect
  `getRunningTasks: () => (this.runningTasksInView = ...)` (line 336); `getInstance` ends with
  `if (!visibleProvider) return; return visibleProvider`. Callers: `registerCommands.ts` (5 sites),
  `extension/bridge.ts`, `extension/api.ts`, `extension.ts`, `handleUri.ts`.
- **Proposal:** a module `src/core/webview/panelRegistry.ts` owning the statics and the running-tasks merge or
  diff; `ClineProvider` registers itself and exposes `ownRunningTasks()`. No existing collaborator fits (all are
  per panel). Note: `panelRegistry` was the name of a module removed in #887/#888; pick the name knowing that.
- **Pinned by:** `ClineProvider.multipleTabs.spec.ts`, `ClineProvider.sharedSettings.spec.ts`,
  `ClineProvider.stateBuilder.spec.ts` (from line 686).
- **Verify:** `grep -n "static " src/core/webview/ClineProvider.ts` shows only `sideBarId` and `tabPanelId`.

### B5. RunParallelTasksTool: six exits, one impossible branch, drifted comments (S; R3 optional M)

**Status:** #926, including R3 (the outer per-call limiter is gone).

- **Where:** `src/core/tools/RunParallelTasksTool.ts` (824 lines, +561 since round 3).
- **Evidence:** `runOneSubtask` (373-504, 131 lines) has six exits each repeating "`registry.markTerminal`, build
  result, usually `finalize`"; lines 405-411 handle a slot-acquire failure that is not an abort, but
  `SubagentSlotPool.acquire` rejects only with `SlotWaitAbortedError` (`SubagentSlotPool.ts:67, 74`); 427-430
  repeat the `cancelled()` closure. `validateParallelParams` 94-97 re-checks a cap that `execute` already rejects
  through `isParallelTasksEnabled` (638). `SubagentSlotPool.fits` handles `profileKey === undefined`, but its only
  caller (`placeSubtasks`, 331) always passes a string. `DEFAULT_MAX_CONCURRENCY` (46) is an alias of a constant
  that line 637 uses directly. `execute` calls `provider.getState()` twice (637, 673). The `runWithConcurrency`
  doc (111-114) describes an `onError` that does not exist.
- **Negative finding:** the CLI duplicates none of this. `apps/cli/src/commands/cli/run.ts:362-374` only validates
  `maxParallelSubagents`; `extension-host.ts:365` passes it through. Worktree naming and the lock prefix exist only
  here.
- **Proposal (S):** a local `end(status, extra)` helper, delete the impossible branch, the dead checks, the alias,
  the second `getState()`, fix the doc. **Optional (R3, M):** `runWithConcurrency` (per-call cap) and
  `SubagentSlotPool` (global and per-profile cap) are two stacked limiters; the outer one matters only when the
  model asks for fewer slots than the cap. Passing the per-call bound into the pool request would delete the outer
  one, but it changes ordering semantics; owner call.
- **Pinned by:** `RunParallelTasksTool.spec.ts` (1641 lines).
- **Verify:** `grep -c markTerminal src/core/tools/RunParallelTasksTool.ts` drops from 7 to about 2;
  `grep -n "DEFAULT_MAX_CONCURRENCY\|onError" src/core/tools/RunParallelTasksTool.ts` empty.

### B6. Task: the background mistake-limit rule is written twice (S)

**Status:** #931.

- **Evidence:** "a limit of 0 means the default for background tasks" lives at `Task.ts:1074-1078` (repetition
  detector) and `TaskApiLoop.ts:514-516`; `Task.ts:1004` `consecutiveMistakeLimit ?? DEFAULT` is redundant after
  the default parameter at 935.
- **Proposal:** compute `effectiveMistakeLimit` once in the constructor, read it in both places.
- **Verify:** `grep -rn DEFAULT_CONSECUTIVE_MISTAKE_LIMIT src/core/task` shows the import and the default
  parameter only.

### B7. TaskApiLoop: `attemptApiRequest` is 256 lines (M, optional)

**Status:** #943, plus the bug fix #938 (the builder used a stale API handler after a profile switch).

- **Where:** `TaskApiLoop.ts:1443-1698`; it predates round 3 (261 lines then). Mixes context-token estimation,
  request assembly (history cleanup, tools, metadata, params) and streaming.
- **Proposal:** move history cleanup and metadata building into the existing `ApiRequestBuilder`. Medium risk,
  do it only when the loop is next touched.

### B8. The twelve exact clones (S each, one PR per file family)

**Status:** per sub-item below.

a. **Gemini models copied into the Vertex table.** `packages/types/src/providers/vertex.ts:19-61` and `91-132`
equal `gemini.ts:57-128` and `132-173` (114 lines). `vertex.ts` already derives its Claude entries by spread
(`"claude-sonnet-4-6": { ...claudeModels["sonnet-4-6"] }`, lines 305-315). Vertex has 22 Gemini ids, Gemini 17;
6 ids are Vertex-only (1.5 and 2.0 generation) and 2 are preview ids absent from `gemini.ts`. Derive the shared
17 by spread, keep the 8 Vertex-only entries literal. **Verify:** jscpd reports no gemini/vertex clone;
`provider-schema-derivation` and the Vertex model-family specs green.
**Status:** #945 (6 shared entries, not 17).
b. **`openai.ts` non-streaming branch twice** (246-281 in `createMessage`, 477-508 in `handleO3FamilyMessage`,
32 lines): same `sendChatCompletion`, tool-call and usage yielding. One private
`*yieldNonStreamingResponse(response)` generator.
**Status:** #948.
c. **`TaskContextManager.ts` condense row twice** (516-553 and 756-793, 38 lines): the `ContextCondense` row is
built and said in the truncate path and in the manual condense path. One `recordCondense(truncateResult)`.
**Status:** #952.
d. **User-content split in four message converters:** `mistral-format.ts:60-76`, `openai-format.ts:345-361`,
`native-ollama.ts:26-47`, `vscode-lm-format.ts:52-68` (17 to 21 lines each) run the same
`reduce` into `{ nonToolMessages, toolMessages }`. One `splitUserContent(content)` in
`src/api/transform/`. The second mistral/openai clone (119-136 vs 447-464, assistant tool_use split) gets the
sibling `splitAssistantContent`.
**Status:** #959.
e. **`openrouter.ts` error parse twice** (346-362 and 464-480, 17 lines): the OpenRouter error-shape parsing
after `chat.completions.create` in the streaming and the completion paths. One `parseOpenRouterError(error)`.
**Status:** #963.
f. **`gemini.ts` 202-229 vs 254-282 and `vertex.ts` 32-61 vs 61-90** are model data entries (preview and stable
aliases). Leave them; data is clearer spelled out.
**Status:** left as data, as planned.

### B9. Small host items (S)

**Status:** #970.

- `src/shared/support-prompt.ts:14` is the one `as any` in `src` without a justifying comment (the other four,
  `openai-codex.ts:211`, `openai-native.ts:141, 347`, `extension/bridge.ts:81`, are commented). Type
  `params["diagnostics"]` or justify it.
- Nine dated `TODO` markers older than 2026-09 in `src` (by `git blame`): `activate/registerCommands.ts:317`
  (2025-03), `core/config/ProviderSettingsManager.ts:73` (2025-03), `core/config/importExport.ts:235` (2025-04),
  `integrations/editor/DiffViewProvider.ts:47` (2025-05), `api/providers/openai.ts:77` (2025-05),
  `api/transform/model-params.ts:159` (2025-05), `shared/embeddingModels.ts:134` (2025-05),
  `api/providers/openrouter.ts:303` (2026-02), `core/task/TaskAskSay.ts:230` (2026-05). Each either becomes an
  item or is deleted; a TODO nobody acts on for a year is a comment that lies. `TerminalRegistry.ts:34` is in the
  protected terminal area and stays.

### B10. Negative finding: TaskHistoryStore stays as it is

**Status:** unchanged, as decided.

1686 lines, unchanged since 2026-10-02. Its only natural seam is the watcher block (1256-1526, about 270 lines,
six store members used); everything else shares `cache`, `fileMeta` and `perIdLocks`. Extract the watchers only
if the store changes again.

---

## C. CLI (`apps/cli`)

### C1. `run()` is 650 lines (M)

**Status:** #950.

- **Where:** `apps/cli/src/commands/cli/run.ts:158-805`: flag checks, settings resolution, provider checks, host
  options, TUI render and the print/JSON loop in one function with about 40 locals.
- **Evidence:** the config-to-provider-settings block (`toProviderSettings({...config, apiKey: keyFor(config),
reasoningEffort: reasoningEffortFor(config), modelSettings: modelSettingsFor(config)})`) is spelled twice
  (421-426, 549-554) and once more in a variant (540-545); the missing-API-key messages are written twice
  (138-147, 414-419). All 24 flags in `main.ts:33-75` are used by `run.ts` (no dead option).
- **Proposal:** `resolveRunOptions()`, `runTui()` (618-711), `runPrint()` (712-804), one `settingsFor(config)`.
- **Verify:** `grep -c "keyFor(config)" apps/cli/src/commands/cli/run.ts` is 1; `run()` under 120 lines;
  `run.test.ts` (1745 lines) green.

### C2. AskDispatcher: one prompt pattern eight times, dead return values (S to M)

**Status:** #934.

- **Where:** `apps/cli/src/agent/ask-dispatcher.ts` 366-374, 425-433, 462-470, 497-505, 523-531, 549-557,
  577-585, 597-605: the same `try { promptForYesNo; sendApprovalResponse; return } catch { "[Defaulting to:
no]" }` block (8 copies).
- **Evidence:** the only caller (`extension-host.ts:401`) ignores the `AskHandleResult`; `isHandled()` has no
  callers; every handler takes an unused `ts`; `handleResumableAsk` (246-248) only forwards. Two rules for one
  event: with `exitOnError`, `process.exit(1)` at 480-483 runs before the host's own `api_req_failed` rejection
  (`extension-host.ts:774-783`), so in print mode the host's dispose path never runs.
- **Proposal:** one `askYesNo(question)` helper; handlers return void; drop `ts`; keep only the host's exit rule.
- **Verify:** `grep -c "Defaulting to: no" apps/cli/src/agent/ask-dispatcher.ts` is 1; `grep -n process.exit
apps/cli/src/agent/ask-dispatcher.ts` empty.

### C3. useTaskSubmit: null guards that never fire, a 190-line callback (M)

**Status:** #942.

- **Evidence:** the options type declares `sendToExtension`, `runTask`, `switchModel`, `cloudAuth` as `| null`
  (28-45), but `useExtensionHost.ts:275-325` always returns stable functions, so the guards at 132, 221, 261, 393,
  460, 472, 485 are dead. `handleSubmit` (259-449) has 25 dependencies. `trimmedText.slice(commandMatch[0].length)
.trim()` appears 5 times; `addMessage({...role:"system"})` at 347, 357, 368 duplicates `note`; `handleApprove`
  and `handleReject` (471-492) differ only in the response value.
- **Proposal:** non-null types; parse command and argument once; dispatch through a small action-to-handler map.
- **Verify:** `grep -c "| null" apps/cli/src/ui/hooks/useTaskSubmit.ts` matches only `cloudSignInRef`.

### C4. JsonEventEmitter: three near-identical tool branches, four copies of one guard (M, protocol pinned)

**Status:** #946.

- **Evidence:** `handleToolUseAsk` (549-632) has command, mcp and tool branches each doing "partial: structured
  delta event, else: full event"; the "skip empty streaming delta" block appears at 393-398, 482-486, 513-518,
  536-541; completion_result handling is identical at 459-463 and 528-532; `computeDelta` (189-198) and
  `computeCommandOutputDelta` (261-271) are the same append-delta over different maps; the `mode ===
"stream-json"` checks at 258 and 550 can never matter because json-mode partials return at 377.
- **Constraint:** decision 19 (2026-09-26) keeps the stream-json and print output formats unchanged;
  `print-and-json-output.characterization.test.ts` is the arbiter and must not change.
- **Proposal:** a `{ name, input(msg) }` record per tool kind and one emit path; one `appendDelta(map, id,
text)`. **Verify:** `grep -c isEmptyStreamingDelta apps/cli/src/agent/json-event-emitter.ts` at most 2;
  characterization snapshots byte-identical.

### C5. agent-state: seven copies of one nine-field object, output nobody reads (S)

**Status:** #930.

- **Evidence:** `detectAgentState` (`agent-state.ts:121-445`) builds seven near-identical literals; the
  `!lastMessage` guard at 327-337 is documented as impossible; `description`, `getStateDescription` (254-301) and
  most of `requiredAction` (124-133, 225-249) are read only by a debug log at `message-processor.ts:159`.
- **Proposal:** drop `description` and `RequiredAction`, build the result with `make(state, ask?)`.
- **Verify:** `grep -rn "requiredAction\|getStateDescription" apps/cli/src` empty outside tests.

### C6. useExtensionHost: `continueSession` is always false (S)

**Status:** #920.

- **Evidence:** `run.ts:653` passes `continueSession: false` unconditionally because `--continue` is already
  resolved into `initialSessionId`; the branches at `useExtensionHost.ts:218-246`, `getMostRecentTaskId` (54-65)
  and the prop at `App.tsx:58, 82, 168` are unreachable. `isReady: isReadyRef.current` (330) is stale inside
  `useMemo` and unread.
- **Verify:** `grep -rn continueSession apps/cli/src` matches tests only, if any.

### C7. ExtensionHostOptions: dead and misplaced fields (S)

**Status:** #928.

- **Evidence:** `extensionAPI` is written (567, 836) and never read; `exitOnComplete` (147) is required but only
  `useExtensionHost.ts:181` reads it, so `list.ts:121` sets a meaningless `true`; the `resolveModelProviderSettings`
  fallback (664-674) is reachable only from tests (the one production creator with per-mode settings always
  passes it); `integrationTest` (168) is set only by tests.
- **Proposal:** delete `extensionAPI`; move `exitOnComplete` to the TUI props; make
  `resolveModelProviderSettings` required and drop the fallback.
- **Verify:** `grep -n "extensionAPI\|exitOnComplete" apps/cli/src/agent/extension-host.ts` empty.

### C8. MultilineTextInput: a flag with one value, an edit block copied three times (S)

**Status:** #936.

- **Evidence:** `showCursor` has one caller value (`AutocompleteInput.tsx:337`, `true`); guards at 311, 331, 351,
  360 are dead. The apply-edit block (refs, `onChange`, `setCursorIndex`) is copied at 285-292, 370-377, 384-392;
  up and down navigation (310-347) mirror each other.
- **Proposal:** remove `showCursor`; add `applyEdit(newValue, newCursor)` and `moveLine(delta)`.
- **Verify:** `grep -c "valueRef.current = newValue" apps/cli/src/ui/components/MultilineTextInput.tsx` is 1.

### C9. Negative findings (CLI)

**Status:** negative finding, nothing to do.

No CLI flag is used only by tests. No duplicated sibling files in `commands/cli` or `ui/hooks`. The suspected
CLI/webview overlaps (context gauge, mention trigger, slash parsing, reasoning-effort lists, image handling,
markdown rendering) were checked one by one: they are different by design or already shared through
`@tumble-code/types` and `@tumble-code/core/cli`.

---

## D. Webview (`webview-ui`)

### D1. CodeBlock: five props no caller passes (S)

**Status:** #957.

- **Evidence:** `CodeBlock.tsx:31-39` declares `rawSource`, `preStyle`, `initialWordWrap`, `initialWindowShade`,
  `collapsedHeight`; none of the 7 callers (McpExecution x2, CommandExecution, ErrorRow, CodeAccordion,
  MarkdownBlock, MermaidBlock) passes them. Consequences: `wordWrap` is a constant, `MemoizedCodeScroller` takes
  three extra props, the highlight effect lists `collapsedHeight` as a dependency (163) and its cleanup clears the
  unrelated collapse timers on every source change (148-162); `e.currentTarget === preRef.current` (441) is always
  true.
- **Verify:** `grep -rn "initialWordWrap\|rawSource\|collapsedHeight" webview-ui/src --include=*.tsx` empty.

### D2. ContextManagementSettings: nine settings rows spelled by hand (M)

**Status:** #976 (the file is 467 lines, not under 400).

- **Evidence:** four slider settings (about 22 lines each, 125-190, 305-384) and five checkbox settings (192-224,
  288-303, 386-418) share one shape; the two image-size inputs (226-286) and `pruneToolResultBudget` (601-620) are a
  third copy; the `maxDiagnosticMessages` "unlimited" expression is repeated four times (318-346);
  `listApiConfigMeta: any[]` plus `(listApiConfigMeta || [])` (490, 560) guards a value `SettingsView.tsx:594`
  already passes as `?? []`; `t(...) || "English fallback"` at 480-488 is unreachable.
- **Proposal:** local `CheckboxRow` and `SliderRow` helpers (the same shape recurs in 15+ settings files, so a
  shared primitive has real second uses); one const for the diagnostics value. Keep the `data-testid` values.
- **Verify:** file under 400 lines, test ids unchanged, settings specs green.

### D3. PlanReviewSurface: two editors in nine `useState` calls (M)

**Status:** #979.

- **Evidence:** `PlanReviewSurface.tsx:126-134`: a new-note editor (`showNoteEditor`, `noteEditorText`,
  `pendingQuote`, `editorPos`) and an edit-note editor (`editingId`, `editingText`); `annotationsPanel` (313-377)
  is a 65-line JSX tree inside `useMemo` with 8 dependencies; line 420 has a ternary with identical branches;
  `initialAnnotations` is a test-only prop (production caller `PlanReviewApp.tsx:100` never passes it).
- **Proposal:** an `AnnotationList` component; one `editor: { kind: "new" | "edit", ... } | null` state.
- **Verify:** `grep -c useState webview-ui/src/components/plan-review/PlanReviewSurface.tsx` at most 6.

### D4. Small webview items (S each, one PR)

**Status:** #972, plus the CLI `App.tsx` cleanup #956.

- `useMentionMenu.ts:200-214`: the URL, File/Folder and Git branches of the `insertValue` chain equal the default;
  the Command branch is unreachable (a Command with a value returned at 162); the selectable-option filter
  (273-277, 306-310) and the `getContextMenuOptions(...)` call (260-267, 298-305) are duplicated; magic indices 1
  and 3 at 252, 402, 438.
- `useScrollLifecycle.ts`: the three-ref pointer reset is copied at 370-373, 377-380, 395-397 (call
  `handlePointerEnd`); the sync effect at 231-233 is redundant; `scrollPhase` is returned but unused by ChatView.
- `ChatView.tsx:502-522`: `aggregatedCostsMap.get(currentTaskItem.id)` three times; tooltip content duplicated
  at 610-615 and 632-636; three separate `everVisible` clear effects (215-230).
- `SettingsView.tsx`: `renderTab = activeTab` (385) leftover alias; `sections` is a `useMemo` with `[]`
  dependencies (306-328), make it a module constant; `targetSection` check duplicated (161-165, 331-335).
- `apps/cli/src/ui/App.tsx` (listed here for the same PR style): `showFollowupSuggestions` (354-357) re-derives
  `showFollowupDialog` (302-306); `_hasStartedTask` (97) unused; `currentMode || mode` four times.
- `ApiOptions.tsx`: `apiConfiguration?.` on a required prop (119-126, 154-159, 446); the OpenRouter
  provider-routing block (432-475) is OpenRouter-only code in the generic component and belongs in the
  hand-written OpenRouter form (S4 keeps that form by design).

### D5. Carry-over: react-hooks rules still off

**Status:** #981 and #983: five rules re-enabled; `set-state-in-effect` stays off with 35 findings.

`packages/config-eslint/react.js:54-59` keeps `set-state-in-effect` (45 findings in 35 files), `refs` (7),
`immutability` (3), `preserve-manual-memoization` (3), `purity` (2), `globals` (1) off "until those components
are refactored one at a time". D1 to D4 touch some of those files; re-enable a rule whenever its last finding goes.

---

## E. Tests

The owner's rule: a test is useful only if it can fail because of our logic; never test a library or a mock; two
cases through one code path are one case. The findings below were read, not inferred from names.

### E1. Echo tests in `ClineProvider.spec.ts` (S)

**Status:** #962 (together with E2).

Lines 1290-1356: four tests (`writeDelayMs`, `soundEnabled`, `autoCondenseContext`, `autoCondenseContextPercent`)
each send `updateSettings { k: v }` and assert `globalState.update(k, v)`: one generic code path, echoed four
times, asserting the mock saw what the test passed in. Replace with one `it.each` over `[key, value]` that asserts
the resulting `getState()` value. **Verify:** `grep -c 'handles .* message' src/core/webview/__tests__/ClineProvider.spec.ts`
drops by 3.

### E2. Duplicate test (S)

**Status:** #962 (together with E1).

`ClineProvider.spec.ts:1358-1400` "loads saved API config when switching modes" is the same test as 1940-1998
(same name, same `providerSettingsManager` fake, same assertions). Delete one. **Verify:** `grep -c 'loads saved
API config when switching modes' src/core/webview/__tests__/ClineProvider.spec.ts` is 1.

### E3. "Comprehensive Edit/Delete Edge Cases" runs one path 20 ways (M)

**Status:** #967.

`ClineProvider.spec.ts:3281-4205` (about 925 lines): "network timeout", "connection drops" and "authorization
failures" (3494, 3534, 3662) each make a different mock reject and land in the same catch that shows
`errors.message.error_editing_message`; "large text", "large payloads", "identical timestamps", "future
timestamps" (3957, 4000, 4117, 4150) are the happy path with different strings. Keep about four tests: edit error
shows the error message, delete keeps prior messages, cancel does nothing, malformed input is ignored. Prove with a
mutation (break the catch mapping, see one test go red). **Verify:** `grep -c 'Network Failure Scenarios\|Large
Message Payloads\|Edge Cases with Message Timestamps' src/core/webview/__tests__/ClineProvider.spec.ts` is 0.

### E4. Duplicate describes in `config-manager.spec.ts` (M)

**Status:** #960.

`describe("loadConfiguration")` at 138 and 1613, `describe("isConfigured")` at 1200 and 1700, `getConfig` tested at
1356 and 1680 (1999 lines against 389 lines of code, 5.1x). Merge; turn the `isConfigured` cases (1201-1338,
1700-1754) into one `it.each` keyed by provider. **Verify:** `grep -c 'describe("isConfigured"'
src/services/code-index/__tests__/config-manager.spec.ts` is 1.

### E5. `openai-native.spec.ts` restates the model table (S)

**Status:** #964.

343-424: five "return GPT-5.x model info" tests restate `maxTokens` and `contextWindow` from `packages/types`
(they break on every table refresh, which is exactly the kind of change the Stale-model-defaults work makes
often). 436-753: six "handle <model> with Responses API" tests through one path. 1840 and 1879 differ only by
model id. Keep one "getModel resolves the selected id" test and one `it.each` over model ids. **Verify:**
`grep -c 'model info when selected' src/api/providers/__tests__/openai-native.spec.ts` is 0.

### E6. A test that cannot fail (S)

**Status:** #968.

`McpHub.spec.ts:817-877` "should handle connection type checks safely" wraps every assertion in
`if (type === "connected") ... else if (type === "disconnected")`, so it passes whatever happens. Delete.
1739-1758 (timeouts 0, 3601, -1 through `ServerConfigSchema`) tests zod's `min`/`max`; keep only if the bounds
themselves are the contract (then one `it.each`). **Verify:** `grep -c 'connection type checks safely'
src/services/mcp/__tests__/McpHub.spec.ts` is 0.

### E7. Twelve ClineProvider specs carry their own inline `vscode` mock (L)

**Status:** #975, #977, #980.

12 of the 20 `ClineProvider*.spec.ts` files repeat the same `vi.mock("vscode", ...)` block (for example
`sticky-mode.spec.ts:12`, `sticky-profile.spec.ts:11`, `lockApiConfig.spec.ts:8`) although `src/__mocks__/vscode.js`
exists, and the same `mockContext` / `mockOutputChannel` / `mockWebviewView` / `new ClineProvider(...)` setup
(`sticky-mode.spec.ts:236-311`, `sticky-profile.spec.ts:235-313`, `modeProfileBinding.spec.ts:291-357`); the
literal `cspSource "vscode-webview://test-csp-source"` marks each copy. `vi.mock` counts run 10 to 23 per file
(`taskHistory.spec.ts` 23). No shared harness exists (no `createTestProvider`, no `makeProvider`). Extract
`src/core/webview/__tests__/helpers/providerHarness.ts` and use the shared `vscode` mock. Lesson from round 2
applies: a module mock must list every export production imports. **Verify:** `grep -l
'vscode-webview://test-csp-source' src/core/webview/__tests__/*.spec.ts | wc -l` is 0.

### E8. The routing snapshot has done its job (S, owner decision)

**Status:** #971 (spec deleted).

`webviewMessageHandler.routing.spec.ts` header: "The snapshot was written before the handler was split into domain
modules and must stay byte-identical afterwards: that is the proof the split only moved code." The split (CORE-R3)
is done; the 3870-line snapshot is now a change detector on every handler, and rounds 2 and 3 carried a standing
rule "routing spec untouched" because of it. Options: retire it, or reduce it to "every message type has exactly
one handler" (a 20-line spec). The other two large snapshots (`NativeToolCallParser.args-snapshot` 15137 lines,
`provider-schema-derivation` 3960 lines) are deliberate and documented; leave them.

### E9. Other oversized spec families (for later rounds, numbers only)

**Status:** left for a later round, as planned.

`McpHub.spec.ts` 3738 lines against 737 (5.1x); `importExport.spec.ts` 2889 against 409 (7.1x, with four "BUG
REPRODUCTION" tests at 2385-2636 overlapping 1971-2098 and an echo test at 785-822); `Task.spec.ts` 2899 (the
`core/task` folder as a whole is 1.5x, fine). Apply E1 to E6 style pruning when those files are next edited.

---

## F. Python service code (`self-hosted-cloudapi`)

### F1. The task-owner query in four places (S)

**Status:** #935 (together with F2 and F5).

`select(Task.user_id).where(Task.id == task_id)` followed by an owner comparison at `routers/task_images.py:57`,
`routers/web_tasks.py:270`, `services/model_attribution.py:323`, `realtime/sio.py:122`, with variants at
`sio.py:112`, `web_tasks.py:201-203` and `task_access.py:61`. Add `task_owner(db, task_id) -> str | None` to
`services/task_access.py`. **Verify:** the grep returns one hit.

### F2. The models label split in three places (S)

**Status:** #935 (together with F1 and F5).

`web_tasks.py:184`, `model_attribution.py:304` and `:350`. One `split_models_label()` in `model_attribution`.
**Verify:** `grep -rn 'split(",")' self-hosted-cloudapi/src/routers/web_tasks.py` empty.

### F3. `auth_callback` is 168 lines with a dead branch (M)

**Status:** #940.

`routers/browser.py:231`: userinfo name parsing (319-324), ticket creation and redirect building in one function;
`org_id = None  # TODO` at 361 makes 380-381 unreachable. Move userinfo-to-user and the redirect build into
`services/auth_service.py`, delete the dead branch. **Verify:** `grep -n org_id self-hosted-cloudapi/src/routers/browser.py`
empty.

### F4. `task_list` does counting, paging and the rollup join in the router (M)

**Status:** #944.

`web_tasks.py:64-139` (100 lines) plus `_filter_suggestions` (165) running two queries. Move the query and paging
into `web/presenters/task_list.py`, which already owns `ListView`. **Verify:** `grep -c 'select('
self-hosted-cloudapi/src/routers/web_tasks.py` drops.

### F5. Validation of our own data (S)

**Status:** #935 (together with F1 and F2).

`telemetry_service.py:401` `isinstance(message, dict)`: its production callers (`sio._save_messages`, 297, and the
held partial buffer) only pass messages that `on_task_event` already checked at `sio.py:234`. Delete the check.

### F6. The old product name inside the service (S)

**Status:** #947.

`pyproject.toml:2` `roo-cloud-api`, `:4` "Self-hosted Roo Code Cloud API", `:5` "Roo Code Community";
`src/__init__.py:1` and `config/settings.py:64` "Roo Cloud API"; `src/main.py:35, 111` log lines;
`routers/auth.py:3`, `services/task_tree.py:5`, `services/task_summary.py:73` docstrings;
`services/problem_brief.py:80-81` is prompt text asserted by `tests/test_problem_filters_brief.py:357`, change
both together; `tests/test_web_tasks.py:58`; `web/static/render.js:268`; `services/problems/collect.py:70` quotes
"Roo tried..." while the extension now says "Tumble tried..." (`src/i18n/locales/en/tools.json:7`), harmless
because matching uses "tried to use " (collect.py:96). Renaming the project in `pyproject.toml` needs `uv lock`
re-run. **Leave alone:** `docker-compose.yml:24, 84, 90` (`roo` database user, `roo_cloud` database) is live
data, a rename is a migration with no reader benefit; `routers/browser.py:368` (`RooVeterinaryInc.roo-cline`) is
the real upstream extension id used for the migration bridge; alembic version files are history. **Verify:**
`grep -rn 'Roo Code\|roo-cloud\|Roo Cloud' self-hosted-cloudapi --include='*.py' --include='*.toml' --include='*.js'`
empty.

### F7. Noted, not proposed

**Status:** noted, not proposed.

`model_attribution.py:221, 256` accumulate in string-keyed dicts next to the `Completion` dataclass;
`anonymizer.report()` returns a list of dicts; `sio.py:76, 318` are process globals (fine for one worker, tests
cannot swap them). All small; do them when the file is next open.

---

## G. Documentation drift

- **G1 (S).** `docs/architecture.md:64-65` says `packages/cloud/src/backoff.ts` re-exports core backoff; the file
  was deleted in round 3 (R3-4a, #768). Cloud imports `@tumble-code/core/backoff` directly in `RefreshTimer.ts:1`,
  `BridgeOrchestrator.ts:14`, `RetryQueue.ts:3`. Line 28 lists core entry points without `./backoff`, which
  `packages/core/package.json` exports. **Verify:** `grep -n 'cloud/src/backoff.ts' docs/` empty.
  **Status:** #918 (together with G2).
- **G2 (S).** `architecture.md:91` credits `ClineProvider.getAppProperties` with the clientKind mapping; it lives in
  `src/core/webview/TelemetryPropertiesSource.ts:63` since R3-12, the provider only delegates.
  **Status:** #918 (together with G1).
- **G3 (S).** `docs/plan-ids.md` lists every CORE-R / PKG / API / CLI / WEB / DEP / TEST / SVC / CAPI-M id found in
  code (248 lines of hits) but none of `R3-2`, `R3-3a/b`, `R3-7` to `R3-10`, `R3-12` (round 3) or `AP-2` to
  `AP-8` (the 2026-07 findings register); the roadmap row "R3" (line 169) also clashes with "R3-n". Add two
  sections and a disambiguating note. **Verify:** `grep -c 'R3-12\|AP-7' docs/plan-ids.md` at least 2.
  **Status:** #921.
- **G4 (S).** `ai_plans/README.md` "Open plans" still lists `2026-10-01_simplification-round-2.md` as "In progress";
  the round finished 2026-10-02 (#664-#725, B11 cancelled by the owner). Move it to the roadmaps list with its
  final state.
  **Status:** #922.
- **G5 (S, optional).** `scripts/check-webview-radius.mjs` is the only CI-reached script without a test in
  `scripts/__tests__`. Everything else in `scripts/` has a caller (CI, package scripts, or documented manual use);
  no dead script found.
  **Status:** #925.

---

## Follow-ups found during execution

Final verification on `chore/r4-final-green` (every local suite, the VSIX build and GitHub CI) fixed three defects:
the CLI found no ripgrep after `@vscode/ripgrep` 1.18 (#974), `vsce package` failed on `"@types/vscode":
"catalog:"` (#937), and the autoDream MEM-2 and MEM-3 specs waited on fixed 10 ms sleeps instead of the condition
(the known timing flake; the MEM-3 test also never reached the re-entry guard, the scan throttle stopped the second
call first). Still open:

- Moving the CLI to `@vscode/ripgrep` 1.18: the per-platform package layout needs the lookup in
  `src/services/ripgrep/index.ts` and `apps/cli/src/commands/cli/doctor.ts`, `apps/cli/scripts/build.sh`,
  `.github/workflows/cli-release.yml` and `apps/cli/install.sh` to read `@vscode/ripgrep-<platform>-<arch>/bin`.
- The `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml` can go after 2026-10-24T14:27Z.
- `.prettierrc.json` has an unknown `ignore` key (Prettier reads `.prettierignore`).
- `scripts/audit-allowlist.mjs` keeps a dead `js-cookie` entry.
- The temperature slider is inert for Claude on Anthropic and Vertex: API version 2026-10-21 rejects `temperature`.
- `gemini-3-pro-preview` is marked deprecated in `gemini.ts` but not in `vertex.ts`.
- Clones outside this plan: the cloud `TelemetryClient` against the telemetry `BaseTelemetryClient`, and two blocks
  in the code-index `orchestrator.ts`.
- The openai-compatible descriptor checks the URL and the key twice.
- `doesConfigChangeRequireRestart` rule 1 is reachable another way.
- Suspected `NotificationSettings` bug: the too-long-file message is cleared on a sound reset (not reproduced).
- The follow-up countdown interrupted by the arrow keys has no CLI test.
- `ApiRequestBuilder.describeRequestParams` has no direct spec.
- `alembic downgrade` fails on databases built by `create_all` (constraint name `fk_tasks_parent_task_id`); the same
  on SQLAlchemy 2.0.
- The `brace-expansion` and `glob` overrides are no longer needed for the patched versions.
- The live cloud api image rebuild is owed to the owner.
- A VSIX smoke test is owed for `App`, `MermaidButton`, `useCodeIndexSettings` and `useScrollLifecycle`, which the
  React Compiler now compiles.
- TypeScript 7: revisit when `typescript-eslint` supports it (typescript-eslint#10940).
- `web-tree-sitter` 0.26+: revisit when `tree-sitter-wasms` ships grammars with `dylink.0`.
- Dependabot opened its first PRs (#954, #955, #958, #961, #965, #966, #969); they are left for the owner. #955
  moves the cloud api image to Python 3.14, which the CI matrix does not test yet.

## NOT worth doing (decided in this round)

- **Node 24 as `engines.node`.** No driver: the extension host's Node comes from VS Code's Electron; the CLI
  alone does not justify a split engine. Revisit with VS Code's own move.
- **`@types/node` 26, `typescript` 7 and `undici` 8 as routine bumps.** Listed under A4 as spikes or deferred, not
  as updates.
- **TaskHistoryStore split** (B10) and the **SubtaskRegistry / SubtaskProvider interfaces** in
  `RunParallelTasksTool.ts:236-298` (single implementors, but consistent with the Access/Host seam style and
  pinned by the same kind of spec).
- **CLI/webview dedup hunting.** Verified absent (C9); do not re-audit.
- **Renaming the compose database user** (F6) and anything on the round 3 "NOT worth doing" list (browser-harness
  `check()`, vscode-shim split, provider registries, config package merge, moving `src`/`webview-ui` under
  `apps/*`, the zoo-port script twins, `bootstrap.mjs`, CLI transcript shaping).
- **B11 terminal path.** Still the owner's "keep it"; nothing here touches it (`TerminalRegistry.ts:34` TODO stays).

## Suggested order

1. **CI and safety (half a day):** A2 actions, A1 decision and setup, A5 hygiene (a to d), A6 Python minors with
   SQLAlchemy pinned, A3 minors by group plus `pnpm dedupe`.
2. **Host small cleanups (one day):** B1, B2, B3, B5 (S part), B6, B8 (a to e), B9, G1 to G4.
3. **CLI and webview (one to two days):** C1 to C8, D1 to D4; re-enable one react-hooks rule per freed file (D5).
4. **Tests (one day):** E1 to E6, E8 after the owner's call, then E7 as its own branch.
5. **Majors (one branch each, with the characterization specs):** A4a Anthropic SDK first, then A4b to A4h, A4k
   pnpm, A4l TypeScript 7 spike last. A4i and A4j wait for a reason.
6. **Medium extractions when their files are next touched:** B4 panel registry, B7, F3, F4, D2, D3.

Rules that apply to every item: own branch from `main`, changeset, plan doc, `pnpm knip` and the three CI gates
green, lowest-layer regression test, mutation check for every pruned test, no behaviour change unless the item
says so.

## Owner decisions needed before starting

1. A1: install the Renovate app, or switch to Dependabot.
2. A6: pin SQLAlchemy below 2.1 now, or migrate to 2.1 in this round.
3. E8: retire or shrink the routing snapshot spec (it reverses the standing "routing spec untouched" rule).
4. B5 R3: delete the outer per-call limiter in `RunParallelTasksTool` (ordering semantics change) or keep both.
5. A4k: pnpm 12 now (affects every machine and CI) or stay on 10.x until the next toolchain round.
