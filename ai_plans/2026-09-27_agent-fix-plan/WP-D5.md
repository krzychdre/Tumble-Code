# WP-D5: Remove the re-export shims for @roo-code/core

Status: ready
Effort: S      Risk: low (part A) / medium (part B, test mocks)      Depends on: none
Branch name: fix/d5-remove-core-shims      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

Five files in `src/` only re-export `@roo-code/core`: `src/shared/array.ts`, `src/shared/todo.ts`,
`src/shared/cost.ts`, `src/shared/context-mentions.ts` (all from `@roo-code/core/browser`) and
`src/utils/safeWriteJson.ts` (from `@roo-code/core/fs`). Point every importer at the package directly and delete
the five files. Part A (the four `shared/*` shims) is a pure import rewrite. Part B (`safeWriteJson`) also rewrites
the `vi.mock(...)` paths in 22 spec files, because a mock only applies to the exact module path the code imports.

## 2. Why it matters (user-visible effect, 2-4 sentences)

No user-visible change. One import path per function: `grep` for a function finds its real home, and knip sees
the dependency. Leaving the shims "during the migration" (their own comment) keeps two names for the same thing.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `docs/architecture.md`: the workspaces table (`packages/core` entry points `.`, `./browser`, `./fs`) and the
  dependency graph (`webview --> core/browser`).
- The five shims (quoted in section 4).
- `packages/core/package.json`: `exports` (`"./browser": "./src/browser.ts"`, `"./fs": "./src/fs/index.ts"`).
- `packages/core/src/browser.ts` and `packages/core/src/fs/index.ts`.
- `src/utils/__tests__/safeWriteJson.spec.ts` (guards the shim; deleted with it).
- `knip.jsonc`: the `webview-ui` workspace `project` includes `../src/shared/*.ts` (no change needed).

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/shared/array.ts`:

```ts
// Moved to @roo-code/core (PKG-6); this stub keeps the `@roo/array` and
// `shared/array` import paths working during the migration.
export { findLast, findLastIndex } from "@roo-code/core/browser"
```

`src/shared/todo.ts`:

```ts
// Moved to @roo-code/core (PKG-6); this stub keeps the `@roo/todo` and
// `shared/todo` import paths working during the migration.
export { getLatestTodo } from "@roo-code/core/browser"
export type { ToolPayloadParser } from "@roo-code/core/browser"
```

`src/shared/cost.ts`:

```ts
// Moved to @roo-code/core (PKG-6); this stub keeps the `@roo/cost` and
// `shared/cost` import paths working during the migration.
export { calculateApiCostAnthropic, calculateApiCostOpenAI, parseApiPrice } from "@roo-code/core/browser"
export type { ApiCostResult } from "@roo-code/core/browser"
```

`src/shared/context-mentions.ts`:

```ts
// Moved to @roo-code/core (PKG-6); this stub keeps the `@roo/context-mentions` and
// `shared/context-mentions` import paths working during the migration.
export { mentionRegex, mentionRegexGlobal, commandRegexGlobal, unescapeSpaces } from "@roo-code/core/browser"
export type { MentionSuggestion, GitMentionSuggestion } from "@roo-code/core/browser"
```

`src/utils/safeWriteJson.ts`:

```ts
// The implementation lives in packages/core (src/fs/safeWriteJson.ts). This re-export keeps
// the extension's import path stable, and with it the vi.mock("../utils/safeWriteJson")
// calls in the specs, which only take effect when the code under test imports this path.
export * from "@roo-code/core/fs"
```

## 5. Root cause / analysis

VERIFIED by grep (command below, run on `aa173b9`):

- The webview has NO importer of `@roo/array`, `@roo/todo`, `@roo/cost` or `@roo/context-mentions`; it already
  imports these functions from `@roo-code/core/browser` (for example `webview-ui/src/components/chat/TaskHeader.tsx`,
  `ChatTextArea.tsx`, `Mention.tsx`, `hooks/useAskButtons.ts`, `ui/hooks/useOpenRouterModelProviders.ts`), and
  `webview-ui/package.json` declares `"@roo-code/core": "workspace:^"`. So the webview needs no change, and it can
  import `@roo-code/core/browser` (it already does).
- `apps/`, `packages/` have no importer (the two hits in `packages/config-eslint/__tests__/boundaries.test.mjs`,
  lines 70 and 81, are fixture STRINGS for the lint-rule test, not imports; leave them).
- `apps/cli/src/lib/storage/settings.ts` imports `safeWriteJson` from `@roo-code/core` directly (not affected).
- No spec mocks a `shared/*` shim path. No spec in `src/` mocks `@roo-code/core/browser`, so importing the four
  shared helpers from `@roo-code/core/browser` cannot collide with a mock. (Five specs mock `@roo-code/core` with a
  full factory: `core/task/__tests__/build-tools-slim-toolset.spec.ts`, `core/task/__tests__/grace-retry-errors.spec.ts`,
  `core/assistant-message/__tests__/presentAssistantMessage-custom-tool.spec.ts`,
  `core/tools/__tests__/RunParallelTasksTool.spec.ts`, `core/webview/__tests__/webviewMessageHandler.routing.spec.ts`.
  That is why the new imports must use `@roo-code/core/browser`, NOT `@roo-code/core`: a full `@roo-code/core`
  factory would otherwise remove `findLastIndex` etc. from those tests.)

Grep used (reproduce):

```sh
cd /home/user/Tumble-Code
grep -rnE "(from|import\(|mock\(|require\()\s*[\"'][^\"']*(shared/(array|todo|cost|context-mentions)|@roo/(array|todo|cost|context-mentions)|utils/safeWriteJson)[\"']" --include=*.ts --include=*.tsx --include=*.mts --include=*.js --include=*.mjs src webview-ui/src apps packages | grep -v node_modules | grep -v /dist/
grep -rnE "[\"'](@roo/(array|todo|cost|context-mentions)|\./(array|todo|cost|context-mentions)|\.\./(array|todo|cost|context-mentions)|\./safeWriteJson|\.\./safeWriteJson)[\"']" --include=*.ts --include=*.tsx src webview-ui/src apps packages | grep -v node_modules
```

HYPOTHESIS (part B): replacing `vi.mock("<rel>/utils/safeWriteJson", ...)` by `vi.mock("@roo-code/core/fs", ...)`
mocks the same functions for the code under test, because after the change the code imports exactly
`@roo-code/core/fs`. Side effect: `packages/core/src/index.ts` re-exports `./fs/index.js` (the same module), so
inside those specs `safeWriteJson` imported from `@roo-code/core` is mocked too. No `src/` code imports
`safeWriteJson` from `@roo-code/core` (verified), so this should not matter. Confirm with section 8 step 7 (whole
`src` suite). If a spec fails only after part B, see section 12.

## 6. Step-by-step changes

Part A: the four `shared/*` shims. Every replacement below is a whole import line; the new module is always
`"@roo-code/core/browser"`. No file listed already imports from `@roo-code/core/browser` or `@roo-code/core`
(verified), so no merging with an existing import is needed except where one file has two shim imports (merge
given explicitly).

A1. `src/api/providers/openai-native.ts`:
`import { calculateApiCostOpenAI } from "../../shared/cost"` ->
`import { calculateApiCostOpenAI } from "@roo-code/core/browser"`

A2. `src/api/providers/fetchers/openrouter.ts`:
`import { parseApiPrice } from "../../../shared/cost"` ->
`import { parseApiPrice } from "@roo-code/core/browser"`

A3. `src/api/providers/utils/completion-usage.ts`:
`import { calculateApiCostOpenAI } from "../../../shared/cost"` ->
`import { calculateApiCostOpenAI } from "@roo-code/core/browser"`

A4. `src/api/transform/anthropic-stream.ts`:
`import { calculateApiCostAnthropic } from "../../shared/cost"` ->
`import { calculateApiCostAnthropic } from "@roo-code/core/browser"`

A5. `src/core/task/TaskStreamProcessor.ts`: replace the two lines

```ts
import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../shared/cost"
import { findLastIndex } from "../../shared/array"
```

with

```ts
import { calculateApiCostAnthropic, calculateApiCostOpenAI, findLastIndex } from "@roo-code/core/browser"
```

A6. `src/core/task/Task.ts`: replace `import { findLastIndex } from "../../shared/array"` (near line 69) with
`import { calculateApiCostAnthropic, calculateApiCostOpenAI, findLastIndex } from "@roo-code/core/browser"`
and DELETE the line `import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../shared/cost"` (near line 90).

A7. `src/core/task/TaskResumption.ts`: replace the two lines

```ts
import { findLastIndex } from "../../shared/array"
import { getLatestTodo } from "../../shared/todo"
```

with

```ts
import { findLastIndex, getLatestTodo } from "@roo-code/core/browser"
```

A8. `src/core/task/TaskAskSay.ts`: `import { findLastIndex } from "../../shared/array"` ->
`import { findLastIndex } from "@roo-code/core/browser"`

A9. `src/core/task/validateToolResultIds.ts`: `import { findLastIndex } from "../../shared/array"` ->
`import { findLastIndex } from "@roo-code/core/browser"`

A10. `src/core/task/TaskApiLoop.ts`: `import { findLastIndex } from "../../shared/array"` ->
`import { findLastIndex } from "@roo-code/core/browser"`

A11. `src/core/task-persistence/taskMetadata.ts`: `import { findLastIndex } from "../../shared/array"` ->
`import { findLastIndex } from "@roo-code/core/browser"`

A12. `src/core/condense/index.ts`: `import { findLast } from "../../shared/array"` ->
`import { findLast } from "@roo-code/core/browser"`

A13. `src/core/webview/ClineProvider.ts`: `import { findLast } from "../../shared/array"` ->
`import { findLast } from "@roo-code/core/browser"` (an import line only; nothing in the do-not-touch methods changes)

A14. `src/core/tools/UpdateTodoListTool.ts`: `import { getLatestTodo } from "../../shared/todo"` ->
`import { getLatestTodo } from "@roo-code/core/browser"`

A15. `src/core/mentions/index.ts`:
`import { mentionRegexGlobal, commandRegexGlobal, unescapeSpaces } from "../../shared/context-mentions"` ->
`import { mentionRegexGlobal, commandRegexGlobal, unescapeSpaces } from "@roo-code/core/browser"`

A16. `src/core/mentions/resolveImageMentions.ts`:
`import { mentionRegexGlobal, unescapeSpaces } from "../../shared/context-mentions"` ->
`import { mentionRegexGlobal, unescapeSpaces } from "@roo-code/core/browser"`

A17. Specs (imports only):
- `src/api/providers/__tests__/anthropic-sdk-wire.spec.ts`: `import { calculateApiCostAnthropic } from "../../../shared/cost"` -> `import { calculateApiCostAnthropic } from "@roo-code/core/browser"`
- `src/api/providers/__tests__/anthropic-protocol-characterization.spec.ts`: same replacement.
- `src/api/providers/__tests__/anthropic-vertex.spec.ts`: same replacement.
- `src/api/transform/__tests__/anthropic-stream.spec.ts`: same replacement.
- `src/api/providers/__tests__/deepseek.spec.ts` (near line 134): `import { calculateApiCostOpenAI } from "../../../shared/cost"` -> `import { calculateApiCostOpenAI } from "@roo-code/core/browser"`

A18. Delete `src/shared/array.ts`, `src/shared/todo.ts`, `src/shared/cost.ts`, `src/shared/context-mentions.ts`
(`git rm`).

A19. Check: `grep -rnE "shared/(array|todo|cost|context-mentions)\"|@roo/(array|todo|cost|context-mentions)\"" src webview-ui/src apps packages --include=*.ts --include=*.tsx | grep -v node_modules`
prints nothing.

Part B: `src/utils/safeWriteJson.ts`. New module id everywhere: `"@roo-code/core/fs"`.

B1. Production importers (whole line replacements):
- `src/services/code-index/cache-manager.ts:5` `import { safeWriteJson } from "../../utils/safeWriteJson"` -> `import { safeWriteJson } from "@roo-code/core/fs"`
- `src/services/mcp/McpConfigStore.ts:6` `import { safeWriteJson } from "../../utils/safeWriteJson"` -> `import { safeWriteJson } from "@roo-code/core/fs"`
- `src/api/providers/fetchers/modelEndpointCache.ts:13` `import { safeWriteJson } from "../../../utils/safeWriteJson"` -> `import { safeWriteJson } from "@roo-code/core/fs"`
- `src/api/providers/fetchers/modelCache.ts:11` same as above.
- `src/core/context-tracking/FileContextTracker.ts:1` `import { safeWriteJson } from "../../utils/safeWriteJson"` -> `import { safeWriteJson } from "@roo-code/core/fs"`
- `src/core/config/importExport.ts:1` same.
- `src/core/task-persistence/subagentSummariesStore.ts:6` same.
- `src/core/task-persistence/apiMessages.ts:1` same.
- `src/core/task-persistence/taskMessages.ts:1` same.
- `src/core/task-persistence/TaskHistoryStore.ts:8` `import { safeWriteJson, withLockedJsonTransaction, type LockedJsonWriter } from "../../utils/safeWriteJson"` -> `import { safeWriteJson, withLockedJsonTransaction, type LockedJsonWriter } from "@roo-code/core/fs"`
- `src/core/webview/messageHandlers/mcp.ts:9` `import { safeWriteJson } from "../../../utils/safeWriteJson"` -> `import { safeWriteJson } from "@roo-code/core/fs"`

B2. Specs: in each file below replace the quoted module string (and ONLY that string) with `"@roo-code/core/fs"`.
The mock factories stay as they are.
- `src/services/code-index/__tests__/cache-manager.spec.ts` lines 8 (`vitest.mock("../../../utils/safeWriteJson", ...`) and 13 (`import { safeWriteJson } from "../../../utils/safeWriteJson"`)
- `src/services/mcp/__tests__/McpConfigStore.spec.ts` line 23
- `src/services/mcp/__tests__/McpHub.spec.ts` lines 44 and 47
- `src/__tests__/delegation-concurrent.spec.ts` line 80 (`vi.mock("../utils/safeWriteJson", ...`)
- `src/__tests__/task-resume-ui.spec.ts` line 64 (`vi.mock("../utils/safeWriteJson", ...`)
- `src/core/config/__tests__/importExport.spec.ts` lines 15 and 65
- `src/core/task/__tests__/flushPendingToolResultsToHistory.spec.ts` line 25
- `src/core/task-persistence/__tests__/TaskHistoryStore.crossInstance.spec.ts` line 17
- `src/core/task-persistence/__tests__/TaskHistoryStore.spec.ts` lines 17 and 488 (`await import("../../../utils/safeWriteJson")`)
- `src/core/task-persistence/__tests__/taskMessages.spec.ts` line 10
- `src/core/tools/__tests__/generateImageTool.test.ts` line 16
- `src/core/webview/__tests__/ClineProvider.reacquire.spec.ts` line 54
- `src/core/webview/__tests__/ClineProvider.lockApiConfig.spec.ts` line 82
- `src/core/webview/__tests__/ClineProvider.modeProfileBinding.spec.ts` line 93
- `src/core/webview/__tests__/webviewMessageHandler.routing.spec.ts` line 154
- `src/core/webview/__tests__/ClineProvider.stateBuilder.spec.ts` line 65
- `src/core/webview/__tests__/ClineProvider.spec.ts` lines 24 and 71
- `src/core/webview/__tests__/ClineProvider.sticky-mode.spec.ts` line 88
- `src/core/webview/__tests__/ClineProvider.storageError.spec.ts` line 55
- `src/core/webview/__tests__/ClineProvider.sticky-profile.spec.ts` line 87
- `src/core/webview/__tests__/ClineProvider.taskHistory.spec.ts` lines 71 and 889 (`await import(...)`)
- `src/core/webview/__tests__/ClineProvider.cliModeProviderSettings.spec.ts` line 84

A mechanical way to do B1 + B2 in one go (run from the repo root, then review `git diff`):

```sh
cd /home/user/Tumble-Code
grep -rlE "[\"'](\.\./)+utils/safeWriteJson[\"']" src --include=*.ts \
  | xargs sed -i -E "s#([\"'])(\.\./)+utils/safeWriteJson([\"'])#\1@roo-code/core/fs\3#g"
```

Then `grep -rn "utils/safeWriteJson" src --include=*.ts` must print only the two comment lines in
`src/utils/safeWriteJson.ts` and `src/utils/__tests__/safeWriteJson.spec.ts`, which are deleted next.

B3. Delete `src/utils/safeWriteJson.ts` and `src/utils/__tests__/safeWriteJson.spec.ts` (the latter only asserts that
the shim forwards to core; nothing left to guard).

B4. Prettier may re-wrap a line that got shorter; run prettier `--write` on the changed files only.

No docs change needed: `docs/06-persistence.md` already names `packages/core/src/fs/safeWriteJson.ts`, and no page
under `docs/` names the shims (verified with `grep -rn "shared/array\|shared/todo\|shared/cost\|shared/context-mentions\|utils/safeWriteJson" docs`).

## 7. Tests to add or change

No new test: this is an import rewrite; the existing specs that import these functions (A17) and the 22 specs that
mock `safeWriteJson` (B2) are the regression suite. Deleted: `src/utils/__tests__/safeWriteJson.spec.ts` (it tested the
shim itself). The type checker proves every import resolves.

## 8. Commands to run (exact, from which directory) and the expected result

1. Before any change, record the baseline: `cd /home/user/Tumble-Code/src && npx vitest run 2>&1 | tail -5` (note
   the failed count, if any).
2. Part A, then: `cd /home/user/Tumble-Code/src && pnpm check-types` -> no errors;
   `cd /home/user/Tumble-Code/webview-ui && pnpm check-types` -> no errors (the webview includes `../src/shared`).
3. `cd /home/user/Tumble-Code/src && npx vitest run api core/task core/mentions core/condense core/tools core/task-persistence`
   -> as baseline.
4. Part B, then `cd /home/user/Tumble-Code/src && pnpm check-types` -> no errors.
5. `cd /home/user/Tumble-Code/src && npx vitest run core/task-persistence core/webview core/config services/mcp services/code-index core/task core/tools __tests__`
   -> as baseline.
6. `cd /home/user/Tumble-Code/webview-ui && npx vitest run` -> as baseline (nothing should change).
7. Whole suite: `cd /home/user/Tumble-Code/src && npx vitest run` -> same failed count as step 1.
8. Lint: `cd /home/user/Tumble-Code/src && npx eslint $(git diff --name-only origin/main -- . | sed 's#^src/##' | grep -E '\.tsx?$' | while read f; do [ -f "$f" ] && echo "$f"; done) --max-warnings=0`.
9. `cd /home/user/Tumble-Code && npx prettier --check $(git diff --name-only origin/main | grep -E '\.tsx?$' | while read f; do [ -f "$f" ] && echo "$f"; done)`.
10. `cd /home/user/Tumble-Code && pnpm knip` (if it runs offline): no new "unused file"/"unresolved import" entries.
11. Build smoke: `cd /home/user/Tumble-Code/src && pnpm bundle` (or the repo's usual extension build script; check
    `src/package.json` "scripts") -> succeeds.

## 9. Do not touch / pitfalls

- Use `@roo-code/core/browser` for part A, not `@roo-code/core` (see section 5: five specs replace `@roo-code/core`
  with a full factory).
- Do not touch `packages/config-eslint/__tests__/boundaries.test.mjs` (its `shared/array` strings are fixtures).
- Do not change the `@roo/*` alias in `webview-ui/tsconfig.json` / `vitest.config.ts` / vite config: other shared
  files still use it.
- Keep the knip `proper-lockfile` ignore in `knip.jsonc` (specs still `vi.mock("proper-lockfile")`).
- Do-not-touch list: `TaskHistoryStore` is listed; this WP changes only its import line (same functions, same module
  underneath). No behaviour change.
- Known flaky: F2 (Windows TaskHistoryStore lock count) may fail on Windows CI regardless; F1 is CLI-only.

## 10. Acceptance checklist (checkboxes)

- [ ] The five shim files and `src/utils/__tests__/safeWriteJson.spec.ts` are deleted.
- [ ] Grep in A19 and `grep -rn "utils/safeWriteJson" src` print nothing.
- [ ] `src` and `webview-ui` check-types pass; full `src` suite has the same result as the baseline.
- [ ] eslint and prettier clean on changed files.

## 11. Commit, changeset and PR text

Two commits are fine (one per part), or one:

Commit title: `refactor: import @roo-code/core directly and delete the re-export shims (D5)`

Body:

```
src/shared/{array,todo,cost,context-mentions}.ts and src/utils/safeWriteJson.ts
only re-exported @roo-code/core. Importers now use @roo-code/core/browser and
@roo-code/core/fs; the specs mock @roo-code/core/fs instead of the shim path.
The webview already imported these helpers from @roo-code/core/browser.

<the commit attribution trailers your harness requires>
```

Changeset: none (no user-visible change).

`ai_plans/2026-MM-DD_d5-remove-core-shims.md`:

```
# D5: remove the @roo-code/core re-export shims

Item D5 of `2026-09-27_simplification-roadmap.md`.

## Problem
Five files in src/ only re-exported @roo-code/core (PKG-6 migration leftovers), so each helper had two import paths.

## Change
16 production files and 5 specs import @roo-code/core/browser; 11 production files import @roo-code/core/fs;
22 specs mock @roo-code/core/fs instead of src/utils/safeWriteJson. Shims and the shim's own spec deleted.
No webview change was needed.

## Tests
Existing suites (import rewrite only); full src run equal to the baseline.
```

PR body outline: Summary; list of deleted files; why `/browser` and not the root entry (the full-factory mocks);
the mock-path change; test results; end with
the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If after part B a spec fails that passes at baseline, and the cause is that the spec needs the real
  `safeWriteJson` somewhere while mocking it for the code under test, stop, revert part B only
  (`git checkout -- src` for the part B files, restore the shim), ship part A alone, and report the spec name.
- If `pnpm check-types` in `webview-ui` fails because some webview file still imports a deleted shim (the grep says
  none does), fix that import to `@roo-code/core/browser` and mention it in the PR.
