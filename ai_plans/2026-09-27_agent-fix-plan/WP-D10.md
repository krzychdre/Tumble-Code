# WP-D10: Rename TaskHistory (one task's messages) to TaskMessageLog; move searchTaskHistory to tools/helpers

Status: ready
Effort: S      Risk: low      Depends on: none (touches `Task*.ts` import lines; rebase over D2/D5 if they merge first)
Branch name: fix/d10-task-message-log      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

Four things are called "TaskHistory": `TaskHistory` (one task's API and UI message log, `src/core/task/TaskHistory.ts`),
`TaskHistoryStore` (the list of all tasks), `TaskHistoryGateway` (the provider's facade over the store) and
`searchTaskHistory` (a tool helper that lives in `core/task`). Rename the first to `TaskMessageLog` (class, access
interface, file, helpers file, its two spec files) and move `src/core/task/searchTaskHistory.ts` (and its spec) to
`src/core/tools/helpers/`. Pure rename and move; no behaviour change.

## 2. Why it matters (user-visible effect, 2-4 sentences)

No user-visible change. `grep TaskHistory` today mixes the per-task message log with the global history list; after
the rename each name means one thing, and the search helper sits next to the only tool that uses it.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `src/core/task/TaskHistory.ts`: `export interface TaskHistoryAccess`, `export class TaskHistory`,
  `flushPendingClineMessageSaves`, `CLINE_MESSAGES_SAVE_IDLE_MS`.
- `src/core/task/TaskHistory.helpers.ts` (imported only by `TaskHistory.ts`).
- `src/core/task/Task.ts`: `readonly history: TaskHistory`, `this.history = new TaskHistory(this)`.
- `src/core/task/searchTaskHistory.ts` and `src/core/tools/SearchTaskHistoryTool.ts` (its only production importer).
- `docs/03-task-agent-loop.md`, `docs/06-persistence.md`, `docs/architecture.md` (section "From a provider stream to
  a chat row", step 3).

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/core/task/TaskHistory.ts` (near lines 48-50, 110-129):

```ts
} from "./TaskHistory.helpers"

export interface TaskHistoryAccess {
```

```ts
/** Every TaskHistory with a coalesced write pending (for {@link flushPendingClineMessageSaves}). */
const historiesWithPendingSave = new Set<TaskHistory>()
```

```ts
export class TaskHistory {
```

```ts
	constructor(private readonly access: TaskHistoryAccess) {}
```

`src/core/task/searchTaskHistory.ts` (near line 6):

```ts
import { ARTIFACT_DIRECTORIES, isValidArtifactId } from "../artifacts/ArtifactStore"
import type { ApiMessage } from "../task-persistence/apiMessages"
```

`src/core/tools/SearchTaskHistoryTool.ts` (near line 5):

```ts
import {
	HISTORY_SEARCH_DEFAULTS,
	clampMaxResults,
	readTaskArtifacts,
	searchTaskHistoryCorpus,
} from "../task/searchTaskHistory"
```

`src/core/task/__tests__/searchTaskHistory.spec.ts` (lines 9 and 23):

```ts
import type { ApiMessage } from "../../task-persistence/apiMessages"
```

```ts
} from "../searchTaskHistory"
```

`docs/03-task-agent-loop.md` (near lines 18 and 31):

```
  T --> H[TaskHistory<br/>api and ui message persistence]
```

```
| `TaskHistory.ts`                                             | Reads and writes `api_conversation_history.json` and `ui_messages.json`       |
```

`docs/06-persistence.md` (near lines 22 and 32):

```
  TH[TaskHistory - per task] --> API
```

```
| `src/core/task/TaskHistory.ts`                       | One task's API and UI messages                                                                      |
```

`docs/architecture.md` (near line 117):

```
3. `TaskAskSay` records the result as a `ClineMessage`; `TaskHistory.addToClineMessages` pushes a state update and
   `TaskHistory.updateClineMessage` sends a `messageUpdated` message for a streaming partial.
```

## 5. Root cause / analysis

VERIFIED. Complete list of files that contain the whole word `TaskHistory` or `TaskHistoryAccess`
(`grep -rlE "\bTaskHistory\b|TaskHistoryAccess" --include=*.ts --include=*.tsx --include=*.md src apps packages webview-ui/src docs`),
all of which change in this WP:

```
apps/cli/src/agent/__tests__/transcript-reducer.test.ts        (comment, line 928)
apps/cli/src/ui/hooks/__tests__/useTranscriptSink.test.tsx      (comment, line 334)
docs/03-task-agent-loop.md                                      (lines 18, 31)
docs/06-persistence.md                                          (lines 22, 32)
docs/architecture.md                                            (lines 117, 118)
src/core/task/ApiRequestBuilder.ts                              (comments, lines 39, 283)
src/core/task/Task.ts                                           (import 137; field 809; comments 805, 998, 999, 1837; new at 1002)
src/core/task/TaskApiLoop.ts                                    (import 32; type 190)
src/core/task/TaskAskSay.ts                                     (import 19; type 56)
src/core/task/TaskContextManager.ts                             (import 26; type 169)
src/core/task/TaskHistory.ts                                    (the class; renamed file)
src/core/task/TaskLifecycle.ts                                  (import 22; type 123)
src/core/task/TaskResumption.ts                                 (import 25; type 54)
src/core/task/TaskStreamProcessor.ts                            (import 37; type 104)
src/core/task/TaskSubtasks.ts                                   (import 7; type 41)
src/core/task/__tests__/ApiRequestBuilder.reasoning-items.spec.ts (comments 34, 54)
src/core/task/__tests__/Task.access-types.spec.ts               (comment 2; import 15; type 25)
src/core/task/__tests__/Task.throttle.test.ts                   (import path 4)
src/core/task/__tests__/TaskHistory.background-guard.spec.ts    (renamed file; lines 1, 16, 23, 37, 53, 56, 64, 75)
src/core/task/__tests__/TaskHistory.turn-counts.spec.ts         (renamed file; lines 1, 4, 42, 46, 65, 69, 73, 156, 217)
src/core/webview/SubagentRegistry.ts                            (comment 246)
src/core/webview/messageHandlers/subagents.ts                   (comment 9)
src/extension.ts                                                (import path 35: flushPendingClineMessageSaves)
```

Plus `src/core/task/TaskHistory.helpers.ts` (file rename; imported only by `TaskHistory.ts`, verified with
`grep -rn "TaskHistory.helpers" src`).

The `\bTaskHistory\b` pattern does NOT match `TaskHistoryStore`, `TaskHistoryGateway`, `TaskHistoryItem`,
`postStateToWebviewWithoutTaskHistory`, `forgetWebviewTaskHistory`, `getTaskHistory`, etc. (word boundary), so a
word-boundary replace is safe. The webview and `packages/` have no hit.

`searchTaskHistory.ts`: importers are `src/core/tools/SearchTaskHistoryTool.ts` and
`src/core/task/__tests__/searchTaskHistory.spec.ts` only (verified). The name `searchTaskHistory` elsewhere
(`approvalMatrix.spec.ts`, `toolPayload.ts`, the CLI, `packages/types`) is the tool payload string
`"searchTaskHistory"`, which must NOT change (it is part of `ClineSayTool` / `ExtensionMessage`, do-not-touch
"public shapes").

Not renamed (out of scope): the `Task` field `history` (`task.history`), the variable `historiesWithPendingSave`,
the function `flushPendingClineMessageSaves`, and the historical `ai_plans/*.md` notes.

## 6. Step-by-step changes

Run from `/home/user/Tumble-Code`.

1. Rename the files with git (keeps history):

```sh
git mv src/core/task/TaskHistory.ts src/core/task/TaskMessageLog.ts
git mv src/core/task/TaskHistory.helpers.ts src/core/task/TaskMessageLog.helpers.ts
git mv src/core/task/__tests__/TaskHistory.background-guard.spec.ts src/core/task/__tests__/TaskMessageLog.background-guard.spec.ts
git mv src/core/task/__tests__/TaskHistory.turn-counts.spec.ts src/core/task/__tests__/TaskMessageLog.turn-counts.spec.ts
git mv src/core/task/searchTaskHistory.ts src/core/tools/helpers/searchTaskHistory.ts
git mv src/core/task/__tests__/searchTaskHistory.spec.ts src/core/tools/helpers/__tests__/searchTaskHistory.spec.ts
```

2. Replace the identifiers, import paths and comments in exactly these files (the list from section 5 with the new
   file names), in this order (`TaskHistoryAccess` first, then the whole word `TaskHistory`):

```sh
FILES="apps/cli/src/agent/__tests__/transcript-reducer.test.ts
apps/cli/src/ui/hooks/__tests__/useTranscriptSink.test.tsx
docs/03-task-agent-loop.md
docs/06-persistence.md
docs/architecture.md
src/core/task/ApiRequestBuilder.ts
src/core/task/Task.ts
src/core/task/TaskApiLoop.ts
src/core/task/TaskAskSay.ts
src/core/task/TaskContextManager.ts
src/core/task/TaskMessageLog.ts
src/core/task/TaskLifecycle.ts
src/core/task/TaskResumption.ts
src/core/task/TaskStreamProcessor.ts
src/core/task/TaskSubtasks.ts
src/core/task/__tests__/ApiRequestBuilder.reasoning-items.spec.ts
src/core/task/__tests__/Task.access-types.spec.ts
src/core/task/__tests__/Task.throttle.test.ts
src/core/task/__tests__/TaskMessageLog.background-guard.spec.ts
src/core/task/__tests__/TaskMessageLog.turn-counts.spec.ts
src/core/webview/SubagentRegistry.ts
src/core/webview/messageHandlers/subagents.ts
src/extension.ts"
for f in $FILES; do
  sed -i -E 's/\bTaskHistoryAccess\b/TaskMessageLogAccess/g; s/\bTaskHistory\b/TaskMessageLog/g' "$f"
done
```

   This turns, for example, `import { type TaskHistory } from "./TaskHistory"` into
   `import { type TaskMessageLog } from "./TaskMessageLog"`, `"./TaskHistory.helpers"` into
   `"./TaskMessageLog.helpers"`, `from "./core/task/TaskHistory"` (extension.ts) into
   `from "./core/task/TaskMessageLog"`, and the spec header comments
   `core/task/__tests__/TaskHistory.turn-counts.spec.ts` into `.../TaskMessageLog.turn-counts.spec.ts` (matching step 1).

3. Check nothing was missed and nothing extra changed:
   - `grep -rnE "\bTaskHistory\b|TaskHistoryAccess" src apps packages webview-ui/src docs --include=*.ts --include=*.tsx --include=*.md`
     -> prints nothing.
   - `git diff --stat` -> only the files listed in step 2 plus the renames.
   - `git diff | grep "^[-+]" | grep -E "TaskHistoryStore|TaskHistoryGateway|TaskHistoryItem|WithoutTaskHistory"` -> nothing
     changed on those names (lines may appear as context only if a line had both; review any hit by hand).

4. Fix the relative imports of the moved search helper.
   `src/core/tools/helpers/searchTaskHistory.ts`: find

```ts
import { ARTIFACT_DIRECTORIES, isValidArtifactId } from "../artifacts/ArtifactStore"
import type { ApiMessage } from "../task-persistence/apiMessages"
```

   replace with

```ts
import { ARTIFACT_DIRECTORIES, isValidArtifactId } from "../../artifacts/ArtifactStore"
import type { ApiMessage } from "../../task-persistence/apiMessages"
```

   `src/core/tools/helpers/__tests__/searchTaskHistory.spec.ts`: find
   `import type { ApiMessage } from "../../task-persistence/apiMessages"` and replace with
   `import type { ApiMessage } from "../../../task-persistence/apiMessages"`. The line `} from "../searchTaskHistory"`
   stays as it is (the spec is still one folder below the helper). Also update its first-line comment
   `// cd src && npx vitest run core/task/__tests__/searchTaskHistory.spec.ts` to
   `// cd src && npx vitest run core/tools/helpers/__tests__/searchTaskHistory.spec.ts`.

   `src/core/tools/SearchTaskHistoryTool.ts`: find `} from "../task/searchTaskHistory"` and replace with
   `} from "./helpers/searchTaskHistory"`.

5. Before running anything, grep for other relative imports inside the moved files:
   `grep -n "from \"\.\|import(\"\.\|mock(\"\." src/core/tools/helpers/searchTaskHistory.ts src/core/tools/helpers/__tests__/searchTaskHistory.spec.ts`
   -> only the lines handled in step 4 (verified at `aa173b9`: the helper has two relative imports, the spec two).

6. Docs: step 2 already renamed the words in `docs/03-task-agent-loop.md`, `docs/06-persistence.md` and
   `docs/architecture.md`. Run prettier on the three files (the tables re-align). In `docs/03-task-agent-loop.md`
   the table row now reads `` `TaskMessageLog.ts` ``; check the mermaid node `H[TaskMessageLog<br/>api and ui message persistence]`.
   If `docs/03-task-agent-loop.md` or any other page lists the files of `src/core/tools/helpers/` or mentions
   `core/task/searchTaskHistory`, update it too (`grep -rn "searchTaskHistory" docs` -> nothing at `aa173b9`).

## 7. Tests to add or change

No new test (rename/move only). Renamed: `TaskMessageLog.background-guard.spec.ts`, `TaskMessageLog.turn-counts.spec.ts`;
moved: `core/tools/helpers/__tests__/searchTaskHistory.spec.ts`. The type checker proves every import resolves; the
existing specs prove behaviour.

## 8. Commands to run (exact, from which directory) and the expected result

1. `cd /home/user/Tumble-Code/src && pnpm check-types` -> no errors.
2. `cd /home/user/Tumble-Code/src && npx vitest run core/task core/tools core/webview core/assistant-message` -> same
   result as on origin/main (run it there first to have a baseline).
3. `cd /home/user/Tumble-Code/apps/cli && npx vitest run src/agent/__tests__/transcript-reducer.test.ts src/ui/hooks/__tests__/useTranscriptSink.test.tsx` -> pass (comments only).
4. `cd /home/user/Tumble-Code/src && npx eslint core/task core/tools/SearchTaskHistoryTool.ts core/tools/helpers core/webview/SubagentRegistry.ts core/webview/messageHandlers/subagents.ts extension.ts --max-warnings=0`.
5. `cd /home/user/Tumble-Code && npx prettier --check $(git diff --name-only --diff-filter=AMR origin/main)`; if the
   docs tables fail, run `npx prettier --write` on the three docs files and re-check.
6. `cd /home/user/Tumble-Code/src && pnpm bundle` -> succeeds (esbuild resolves the moved files).

## 9. Do not touch / pitfalls

- Do NOT rename `TaskHistoryStore` (do-not-touch list: "`TaskHistoryStore` (`src/core/task-persistence/`)"),
  `TaskHistoryGateway`, or the tool payload string `"searchTaskHistory"` (public `ExtensionMessage` shape).
- Do not rename the `Task` field `history`; many specs use `task.history`.
- Do not edit `ai_plans/*.md` except adding the new note (they are a historical record).
- A plain `sed s/TaskHistory/TaskMessageLog/` without `\b` would corrupt `TaskHistoryStore` etc. Use the command in
  step 2 exactly.
- Known flaky: F2 (Windows TaskHistoryStore lock count) is unrelated.

## 10. Acceptance checklist (checkboxes)

- [ ] `src/core/task/TaskMessageLog.ts`, `TaskMessageLog.helpers.ts`, two renamed specs; no `\bTaskHistory\b` left in code or docs.
- [ ] `src/core/tools/helpers/searchTaskHistory.ts` + spec moved; `SearchTaskHistoryTool.ts` imports `./helpers/searchTaskHistory`.
- [ ] `docs/03-task-agent-loop.md`, `docs/06-persistence.md`, `docs/architecture.md` updated in the same PR.
- [ ] check-types, test folders, eslint, prettier, bundle all pass.

## 11. Commit, changeset and PR text

Commit title: `refactor(task): rename TaskHistory to TaskMessageLog and move searchTaskHistory to tools/helpers (D10)`

Body:

```
"TaskHistory" named four things. The per-task message log (class, access
interface, file, helpers file, two specs) is now TaskMessageLog;
TaskHistoryStore and TaskHistoryGateway keep their names. The search helper of
search_task_history moves next to its only user, core/tools/helpers. Docs 03,
06 and architecture.md follow the rename. No behaviour change.

<the commit attribution trailers your harness requires>
```

Changeset: none.

`ai_plans/2026-MM-DD_d10-task-message-log.md`:

```
# D10: TaskMessageLog

Item D10 of `2026-09-27_simplification-roadmap.md`.

## Problem
TaskHistory (one task's messages), TaskHistoryStore (all tasks), TaskHistoryGateway and searchTaskHistory (a tool
helper in core/task) shared one name.

## Change
TaskHistory -> TaskMessageLog (class, TaskMessageLogAccess, files, specs); searchTaskHistory.ts -> core/tools/helpers.
Docs 03, 06 and architecture.md updated. Tool payload name "searchTaskHistory" unchanged.

## Tests
Existing specs, renamed/moved; no behaviour change.
```

PR body outline: Summary; rename table (old -> new); "Unchanged on purpose" (TaskHistoryStore, TaskHistoryGateway,
payload string, `task.history`); verification; end with
the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If `pnpm check-types` reports an unresolved `./TaskHistory` import in a file not listed in step 2, a new importer
  was added after `aa173b9`: apply the same `sed` to that file and mention it in the PR.
- If a spec fails that passed on origin/main, report the spec name and output; do not edit test logic.
