# D5 — remove the `@roo-code/core` re-export shims in `src`

Roadmap item D5 of `ai_plans/2026-09-27_simplification-roadmap.md` (Priority 2: DRY and YAGNI):

> **D5**: Re-export shims in `src`: `src/shared/{array,todo,cost,context-mentions}.ts`, `src/utils/safeWriteJson.ts` only re-export `@roo-code/core`. | Fix: Codemod the imports, delete the shims. | Effort: S.

## Status

Implemented on branch `feature/d5-remove-reexport-shims` off `main` @ f6a99d57e (2026-09-28).

## The shims (verified on main @ f6a99d57e)

All five files exist and are pure re-export shims with zero logic:

1. [`src/shared/array.ts`](../src/shared/array.ts:1) — `export { findLast, findLastIndex } from "@roo-code/core/browser"`
2. [`src/shared/todo.ts`](../src/shared/todo.ts:1) — `export { getLatestTodo } from "@roo-code/core/browser"` (+ type `ToolPayloadParser`)
3. [`src/shared/cost.ts`](../src/shared/cost.ts:1) — `export { calculateApiCostAnthropic, calculateApiCostOpenAI, parseApiPrice } from "@roo-code/core/browser"` (+ type `ApiCostResult`)
4. [`src/shared/context-mentions.ts`](../src/shared/context-mentions.ts:1) — `export { mentionRegex, mentionRegexGlobal, commandRegexGlobal, unescapeSpaces } from "@roo-code/core/browser"` (+ types `MentionSuggestion`, `GitMentionSuggestion`)
5. [`src/utils/safeWriteJson.ts`](../src/utils/safeWriteJson.ts:1) — `export * from "@roo-code/core/fs"`

The stub headers say "this stub keeps the `@roo/array` … import paths working during the migration"
(PKG-6). The migration is done: the webview and apps already import from
`@roo-code/core/browser` / `@roo-code/core/fs` directly, and `webview-ui`'s `@roo/*`
tsconfig alias points at `../src/shared/*` — no code uses `@roo/array`-style aliases
(grep over the whole tree found zero `@shared/`, `@src/shared`, `~/shared` or
`@roo/array` import sites outside the stubs' own comments).

## Import-site inventory

Grep for `shared/(array|todo|cost|context-mentions)` and `utils/safeWriteJson`
found **58 consumer files** — all inside `src/`, all relative-path imports; zero
hits in `webview-ui/`, `apps/`, `packages/` (they already import from
`@roo-code/core` directly). No path-alias forms exist (`@shared/…`, `@src/shared/…`,
`~/shared/…` — none; webview's `@roo/*` alias was never used for these four).

Per-target counts (file:count):

- `shared/array` (→ `@roo-code/core/browser`): `src/core/task/Task.ts` (2 imports:
  `findLast`, `findLastIndex`), `TaskApiLoop.ts`, `TaskAskSay.ts`, `TaskResumption.ts`,
  `TaskStreamProcessor.ts`, `validateToolResultIds.ts`, `condense/index.ts`,
  `task-persistence/taskMetadata.ts`, `webview/ClineProvider.ts` — 9 files
- `shared/todo` (→ `@roo-code/core/browser`): `src/core/task/TaskResumption.ts`,
  `src/core/tools/UpdateTodoListTool.ts` — 2 files
- `shared/cost` (→ `@roo-code/core/browser`): `src/core/task/Task.ts`,
  `TaskStreamProcessor.ts`, `api/providers/openai-native.ts`,
  `api/providers/utils/completion-usage.ts`, `api/providers/fetchers/openrouter.ts`,
  `api/transform/anthropic-stream.ts`, 4 provider specs
  (`anthropic-protocol-characterization`, `anthropic-sdk-wire`, `anthropic-vertex`,
  `deepseek`), `api/transform/__tests__/anthropic-stream.spec.ts` — 10 files
- `shared/context-mentions` (→ `@roo-code/core/browser`):
  `src/core/mentions/index.ts`, `src/core/mentions/resolveImageMentions.ts` — 2 files
- `utils/safeWriteJson` (→ `@roo-code/core/fs`): 35 files — 17 production modules
  (`api/providers/fetchers/modelCache.ts`, `modelEndpointCache.ts`,
  `core/config/importExport.ts`, `core/context-tracking/FileContextTracker.ts`,
  `core/task-persistence/{apiMessages,subagentSummariesStore,TaskHistoryStore,taskMessages}.ts`,
  `core/webview/messageHandlers/mcp.ts`, `core/webview/ClineProvider.ts` (via
  `shared/array` only — no), `services/code-index/cache-manager.ts`,
  `services/mcp/McpConfigStore.ts`) plus ~18 spec files that `vi.mock` the path
  (all under `src/`).

`Task.ts`, `TaskStreamProcessor.ts` and `TaskResumption.ts` import two different
shims that both map to `@roo-code/core/browser` — those import statements get merged
into one per file to keep imports unique (lint `no-duplicate-imports` family).

## Files deleted

- The 5 shims above.
- [`src/utils/__tests__/safeWriteJson.spec.ts`](../src/utils/__tests__/safeWriteJson.spec.ts:1) — its whole purpose was to guard
  the re-export (`expect(shim.safeWriteJson).toBe(core.safeWriteJson)`); the
  implementation is covered by `packages/core/src/fs/__tests__/safeWriteJson.spec.ts`.
  Note: it mocks `proper-lockfile` by module id — see the knip note below; the
  `vi.mock("proper-lockfile")` sites live in the _task-persistence_ specs, not here,
  so nothing else depends on this spec.

## Codemod

Mechanical: in every consumer, replace the specifier with the package path the shim
re-exported from:

- `../../shared/array` / `../../shared/todo` / `../../shared/cost` /
  `../../shared/context-mentions` (any depth) → `@roo-code/core/browser`
- `../../utils/safeWriteJson` (any depth) → `@roo-code/core/fs`
- both specifiers used in one file → merge into a single import from
  `@roo-code/core/browser`
- `vi.mock("<old path>", …)` calls in specs → `vi.mock("@roo-code/core/fs", …)` so
  the mock still intercepts what the code under test imports.

Two substitution subtleties:

1. `src/shared/cost.ts`'s type export `ApiCostResult` also lives on
   `@roo-code/core/browser`, so `import type … from "../../shared/cost"` rewrites
   identically. Same for all types the four stubs re-export.
2. The extension bundle resolves `@roo-code/core` through the workspace
   dependency (`src/package.json` already declares it), and esbuild bundles it in
   (only the `extensionExternals` list stays external), so no bundler changes are
   needed. The webview alias `@roo/*` → `../src/shared/*` keeps working for the
   remaining, non-shim `src/shared` files (it is only a _type-only_ webview import
   surface now for the files that remain).

## Why this is safe (behaviour unchanged)

- Every export the shims forwarded is exported from the exact entry point the
  codemod retargets (`browser.ts` for the four `shared/*` ones, `fs/index.ts` for
  `safeWriteJson`); the module identity is the same node the shim re-exported, so
  `vi.mock` by the new path still patches the same functions the specs spy on.
- `vi.mock` path identity: vitest resolves the mock path relative to the _test_
  file and the import path relative to the _module under test_; both resolve to
  `packages/core/src/fs/index.ts` after the change, which is exactly what the old
  two-hop setup achieved via the shim.

## Architecture compliance

`docs/architecture.md` allows `src` → `packages/core` (`@roo-code/core` is listed as
a dependency in the workspace table) and forbids the reverse. This change REMOVES an
indirection layer; the dependency direction was already `src → packages/core` via
the shims. The `src/shared` browser-safety rule (no `vscode` imports) is untouched —
the four deleted files were the only `src/shared` members whose entire content was a
`@roo-code/core` re-export.

## Other shim-like files found (NOT touched, out of D5 scope)

`src/shared/` contains more PKG-6 stubs that re-export `@roo-code/core/browser`
but with import-and-re-export style (not `export … from`):

- [`src/shared/api.ts`](../src/shared/api.ts:1) — `import … from "@roo-code/core/browser"` + re-export
- [`src/shared/parse-command.ts`](../src/shared/parse-command.ts:1) — same pattern
- [`src/shared/getApiMetrics.ts`](../src/shared/getApiMetrics.ts:1) — same pattern
- [`src/shared/combineApiRequests.ts`](../src/shared/combineApiRequests.ts:1) —
  renames `consolidateApiRequests` → `combineApiRequests`
- [`src/shared/combineCommandSequences.ts`](../src/shared/combineCommandSequences.ts:1) —
  renames `consolidateCommands` → `combineCommandSequences`

These rename or partially re-export, so they are not pure shims; D5 does not
delete them. The roadmap (D6/D7) may pick them up separately.

## Regression proof

Pure deletion — no new logic to unit-test. The proof is:

1. `tsc --noEmit` in every workspace that consumed the shims (`src` only — the
   webview/apps/packages never imported the deleted paths).
2. The existing spec suites that exercise these utilities still pass (cost
   functions, context-mentions, todo, safeWriteJson consumers: task-persistence,
   ClineProvider, mcp, code-index specs).
3. Grep proof: zero remaining references to `shared/array`, `shared/todo`,
   `shared/cost`, `shared/context-mentions`, `utils/safeWriteJson` as import
   specifiers anywhere in the repo (code files; historical plan docs keep their
   mentions — they describe past states).

## Changeset

`.changeset/d5-remove-reexport-shims.md`, patch, internal refactor note.
