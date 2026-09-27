# WP-D8: Merge RepoPerTaskCheckpointService into ShadowCheckpointService

Status: ready
Effort: S      Risk: low      Depends on: none
Branch name: fix/d8-one-checkpoint-service      Base: origin/main

## 1. Goal (2-4 sentences, plain words)

`ShadowCheckpointService` (553 lines, `abstract`) has exactly one subclass, `RepoPerTaskCheckpointService` (15 lines),
which only adds a static `create` factory. Move `create` into `ShadowCheckpointService`, drop `abstract`, delete
`RepoPerTaskCheckpointService.ts`, and use the one class name everywhere. The kept name is
`ShadowCheckpointService` (it describes what the class is: a shadow git repository; its file and spec already carry
that name).

## 2. Why it matters (user-visible effect, 2-4 sentences)

No user-visible change except the prefix of some log lines in the "Tumble Code" output channel (see section 5).
A reader no longer has to open two files and wonder which other subclasses exist.

## 3. Read these first (exact paths, and the symbol to look for in each)

- `src/services/checkpoints/ShadowCheckpointService.ts`: `export abstract class ShadowCheckpointService`, the
  constructor, `protected static taskRepoDir`, `public static deleteTask`.
- `src/services/checkpoints/RepoPerTaskCheckpointService.ts` (whole file).
- `src/services/checkpoints/index.ts` (whole file).
- `src/core/checkpoints/index.ts`: `getCheckpointService`, `checkGitInstallation`.
- `src/core/task/Task.ts`: the `checkpointService?:` field.
- `src/services/checkpoints/__tests__/ShadowCheckpointService.spec.ts`, `src/core/checkpoints/__tests__/checkpoint.test.ts`.

## 4. Current code (verbatim excerpts, each headed by path and symbol name; line numbers only as a hint "near line N")

`src/services/checkpoints/RepoPerTaskCheckpointService.ts` (whole file):

```ts
import * as path from "path"

import { CheckpointServiceOptions } from "./types"
import { ShadowCheckpointService } from "./ShadowCheckpointService"

export class RepoPerTaskCheckpointService extends ShadowCheckpointService {
	public static create({ taskId, workspaceDir, shadowDir, log = console.log }: CheckpointServiceOptions) {
		return new RepoPerTaskCheckpointService(
			taskId,
			path.join(shadowDir, "tasks", taskId, "checkpoints"),
			workspaceDir,
			log,
		)
	}
}
```

`src/services/checkpoints/index.ts` (whole file):

```ts
export type { CheckpointServiceOptions } from "./types"

export { RepoPerTaskCheckpointService } from "./RepoPerTaskCheckpointService"
```

`src/services/checkpoints/ShadowCheckpointService.ts` (near line 16 and 115):

```ts
import { CheckpointDiff, CheckpointResult, CheckpointEventMap } from "./types"
```

```ts
export abstract class ShadowCheckpointService extends EventEmitter {
```

and (near line 472), a static helper that computes exactly the path `create` builds by hand and that nothing calls
today:

```ts
	protected static taskRepoDir({ taskId, globalStorageDir }: { taskId: string; globalStorageDir: string }) {
		return path.join(globalStorageDir, "tasks", taskId, "checkpoints")
	}
```

## 5. Root cause / analysis

VERIFIED: complete reference list (`grep -rn "ShadowCheckpointService\|RepoPerTaskCheckpointService" src webview-ui/src apps packages docs --include=*.ts --include=*.tsx --include=*.md`):

RepoPerTaskCheckpointService:
- `src/services/checkpoints/RepoPerTaskCheckpointService.ts` (definition, deleted)
- `src/services/checkpoints/index.ts:3` (re-export)
- `src/core/task/Task.ts:82` (import) and `:457` (`checkpointService?: RepoPerTaskCheckpointService`)
- `src/core/checkpoints/index.ts:18` (import), `:114` (`RepoPerTaskCheckpointService.create(options)`), `:135`
  (`service: RepoPerTaskCheckpointService,` parameter type)
- `src/core/checkpoints/__tests__/checkpoint.test.ts:108` and `:432` (`checkpointsModule.RepoPerTaskCheckpointService.create`)
- `src/services/checkpoints/__tests__/ShadowCheckpointService.spec.ts:13` (import), `:82` (`describe.each([[RepoPerTaskCheckpointService, "RepoPerTaskCheckpointService"]])`),
  `:89` (`let service: RepoPerTaskCheckpointService`), `:1063`, `:1067`, `:1099`, `:1107` (`new RepoPerTaskCheckpointService(...)`)

ShadowCheckpointService (outside its own file): `src/core/webview/TaskHistoryGateway.ts:13,551`,
`src/core/webview/__tests__/TaskHistoryGateway.spec.ts:8,25,26,381`,
`src/core/webview/__tests__/ClineProvider.taskHistory.spec.ts:14,1268,1306,1328`, and a comment in
`src/core/webview/BackgroundTaskRunner.ts:252`. These keep working unchanged (same class, same file, same static
`deleteTask`).

`docs/` does not name either class (verified). No test asserts a log line containing either class name
(`grep -rn "RepoPerTaskCheckpointService#\|ShadowCheckpointService#" src --include=*.spec.ts --include=*.test.ts` -> nothing).

Behaviour: identical, except log prefixes. The class logs `[${this.constructor.name}#...]`; instances were
`RepoPerTaskCheckpointService`, so lines like `[RepoPerTaskCheckpointService#saveCheckpoint] ...` become
`[ShadowCheckpointService#saveCheckpoint] ...`. Static `deleteTask` already logged `ShadowCheckpointService`.

Observation (not changed here): `deleteTask`, `workspaceRepoDir` and `hashWorkspaceDir` clean up a branch
`roo-<taskId>` in the old per-workspace repo layout (`<globalStorage>/checkpoints/<hash>`), which nothing creates any
more. Removing that legacy cleanup is a separate decision (old installs may still have such repos).

## 6. Step-by-step changes

1. `src/services/checkpoints/ShadowCheckpointService.ts`. Find:

```ts
import { CheckpointDiff, CheckpointResult, CheckpointEventMap } from "./types"
```

Replace with:

```ts
import { CheckpointDiff, CheckpointResult, CheckpointEventMap, CheckpointServiceOptions } from "./types"
```

2. Same file. Find:

```ts
export abstract class ShadowCheckpointService extends EventEmitter {
```

Replace with:

```ts
/**
 * Checkpoints of one task, kept as commits in a shadow git repository of its
 * own (`<globalStorage>/tasks/<taskId>/checkpoints`) whose work tree is the
 * user's workspace. Create one with {@link ShadowCheckpointService.create}.
 */
export class ShadowCheckpointService extends EventEmitter {
```

3. Same file, add the factory directly above the constructor. Find:

```ts
	constructor(taskId: string, checkpointsDir: string, workspaceDir: string, log: (message: string) => void) {
```

Replace with:

```ts
	public static create({ taskId, workspaceDir, shadowDir, log = console.log }: CheckpointServiceOptions) {
		return new ShadowCheckpointService(
			taskId,
			ShadowCheckpointService.taskRepoDir({ taskId, globalStorageDir: shadowDir }),
			workspaceDir,
			log,
		)
	}

	constructor(taskId: string, checkpointsDir: string, workspaceDir: string, log: (message: string) => void) {
```

(`taskRepoDir` returns `path.join(globalStorageDir, "tasks", taskId, "checkpoints")`, the same path the old
`create` built inline. It is `protected static`, callable from inside the class.)

4. Delete `src/services/checkpoints/RepoPerTaskCheckpointService.ts` (`git rm`).

5. `src/services/checkpoints/index.ts`: replace the whole content with:

```ts
export type { CheckpointServiceOptions } from "./types"

export { ShadowCheckpointService } from "./ShadowCheckpointService"
```

6. `src/core/task/Task.ts`:
   - `import { RepoPerTaskCheckpointService } from "../../services/checkpoints"` ->
     `import { ShadowCheckpointService } from "../../services/checkpoints"`
   - `checkpointService?: RepoPerTaskCheckpointService` -> `checkpointService?: ShadowCheckpointService`

7. `src/core/checkpoints/index.ts`:
   - `import { CheckpointServiceOptions, RepoPerTaskCheckpointService } from "../../services/checkpoints"` ->
     `import { CheckpointServiceOptions, ShadowCheckpointService } from "../../services/checkpoints"`
   - `const service = RepoPerTaskCheckpointService.create(options)` -> `const service = ShadowCheckpointService.create(options)`
   - `service: RepoPerTaskCheckpointService,` -> `service: ShadowCheckpointService,`

8. `src/core/checkpoints/__tests__/checkpoint.test.ts`:
   - line near 108: `vi.mocked(checkpointsModule.RepoPerTaskCheckpointService.create).mockReturnValue(mockCheckpointService)` ->
     `vi.mocked(checkpointsModule.ShadowCheckpointService.create).mockReturnValue(mockCheckpointService)`
   - line near 432: `expect(vi.mocked(checkpointsModule.RepoPerTaskCheckpointService.create)).toHaveBeenCalledWith({` ->
     `expect(vi.mocked(checkpointsModule.ShadowCheckpointService.create)).toHaveBeenCalledWith({`
   (the file auto-mocks `../../../services/checkpoints` with `vi.mock("../../../services/checkpoints")`; the automock
   now mocks `ShadowCheckpointService` and its static `create` in the same way.)

9. `src/services/checkpoints/__tests__/ShadowCheckpointService.spec.ts`:
   - replace the two import lines

```ts
import { RepoPerTaskCheckpointService } from "../RepoPerTaskCheckpointService"
import { BLOCKED_ENV_KEYS } from "../ShadowCheckpointService"
```

     with

```ts
import { BLOCKED_ENV_KEYS, ShadowCheckpointService } from "../ShadowCheckpointService"
```

   - `describe.each([[RepoPerTaskCheckpointService, "RepoPerTaskCheckpointService"]])(` ->
     `describe.each([[ShadowCheckpointService, "ShadowCheckpointService"]])(`
   - `let service: RepoPerTaskCheckpointService` -> `let service: ShadowCheckpointService`
   - the four `new RepoPerTaskCheckpointService(` (near lines 1063, 1067, 1099, 1107) -> `new ShadowCheckpointService(`
   Afterwards `grep -rn RepoPerTaskCheckpointService src` must print nothing.

10. Add the test in section 7.

## 7. Tests to add or change

Add to `src/services/checkpoints/__tests__/ShadowCheckpointService.spec.ts`, at the end of the file (top level,
outside other `describe` blocks):

```ts
describe("ShadowCheckpointService.create", () => {
	it("puts the shadow repository of a task under <shadowDir>/tasks/<taskId>/checkpoints", () => {
		const shadowDir = path.join(os.tmpdir(), "d8-shadow")
		const workspaceDir = path.join(os.tmpdir(), "d8-workspace")

		const service = ShadowCheckpointService.create({ taskId: "task-1", shadowDir, workspaceDir, log: () => {} })

		expect(service).toBeInstanceOf(ShadowCheckpointService)
		expect(service.taskId).toBe("task-1")
		expect(service.workspaceDir).toBe(workspaceDir)
		expect(service.checkpointsDir).toBe(path.join(shadowDir, "tasks", "task-1", "checkpoints"))
		expect(service.isInitialized).toBe(false)
	})
})
```

Exception to 00-README.md section 2 step 1 ("a test that passes before the change proves nothing"): this WP is a behaviour-preserving refactor, so its new test is a characterization test that passes before and after; the mutation check described here is the proof that it can fail.

(`path` and `os` are already imported at the top of that spec.) It pins the directory layout the factory used to
build by hand, so replacing the inline `path.join` with `taskRepoDir` cannot move existing checkpoints. It passes
before the change too if written against `RepoPerTaskCheckpointService`; to see it fail, change `"tasks"` to
`"task"` in `taskRepoDir` temporarily. Existing coverage: the whole `describe.each` suite runs through `create`.

## 8. Commands to run (exact, from which directory) and the expected result

1. `cd /home/user/Tumble-Code/src && npx vitest run services/checkpoints core/checkpoints core/webview/__tests__/TaskHistoryGateway.spec.ts core/webview/__tests__/ClineProvider.taskHistory.spec.ts`
   before the change (baseline) and after -> same result, plus the new test passing. (The checkpoint spec needs a
   `git` binary; it runs real git in a temp dir.)
2. `cd /home/user/Tumble-Code/src && npx vitest run core/task` -> as baseline.
3. `cd /home/user/Tumble-Code/src && pnpm check-types` -> no errors.
4. `cd /home/user/Tumble-Code/src && npx eslint services/checkpoints core/checkpoints core/task/Task.ts --max-warnings=0`.
5. `cd /home/user/Tumble-Code && npx prettier --check src/services/checkpoints src/core/checkpoints src/core/task/Task.ts`.
6. `cd /home/user/Tumble-Code && grep -rn RepoPerTaskCheckpointService src apps packages webview-ui/src docs` -> nothing.

## 9. Do not touch / pitfalls

- Do not change the directory layout (`tasks/<taskId>/checkpoints`), `BLOCKED_ENV_KEYS`, `createSanitizedGit`, or
  the static `deleteTask` (TaskHistoryGateway and two specs mock/spy it by this exact class and file path:
  `vi.mock("../../../services/checkpoints/ShadowCheckpointService", ...)` in `TaskHistoryGateway.spec.ts`).
- Keep the constructor public: the spec constructs services directly with a custom `checkpointsDir`.
- Do-not-touch list: task control / `cancelTask` ordering is not affected (only a type name in `Task.ts` changes).
- Keep `protected` members as they are (no subclass any more, but narrowing to `private` is a separate cleanup and
  some specs reach them with `as any`).

## 10. Acceptance checklist (checkboxes)

- [ ] `RepoPerTaskCheckpointService.ts` deleted; no reference to the name remains.
- [ ] `ShadowCheckpointService` is not abstract and has `static create`.
- [ ] New `create` test passes; the checkpoint, TaskHistoryGateway and taskHistory specs pass as on baseline.
- [ ] check-types, eslint, prettier clean.

## 11. Commit, changeset and PR text

Commit title: `refactor(checkpoints): merge RepoPerTaskCheckpointService into ShadowCheckpointService (D8)`

Body:

```
ShadowCheckpointService was abstract with one 15-line subclass that only added
the create() factory. The factory moves into ShadowCheckpointService (using its
taskRepoDir helper, same path), the subclass file is deleted and callers use
the one class. Log lines now start with [ShadowCheckpointService#...].

<the commit attribution trailers your harness requires>
```

Changeset: none (no user-visible change beyond log prefixes).

`ai_plans/2026-MM-DD_d8-one-checkpoint-service.md`:

```
# D8: one checkpoint service class

Item D8 of `2026-09-27_simplification-roadmap.md`.

## Problem
Abstract ShadowCheckpointService (553 lines) had one subclass, RepoPerTaskCheckpointService, that only added create().

## Change
create() moved into ShadowCheckpointService (via taskRepoDir, same directory layout); subclass deleted; Task.ts,
core/checkpoints and two specs renamed. Legacy per-workspace deleteTask cleanup left as is.

## Tests
New ShadowCheckpointService.create layout test; existing checkpoint specs unchanged in behaviour.
```

PR body outline: Summary; reference list; log-prefix note; tests; end with
the PR attribution footer your harness requires (see 00-README.md, section 3).

## 12. If stuck

- If `checkpoint.test.ts` fails because the automock of `../../../services/checkpoints` no longer provides a mocked
  static `create` (it should, vitest automocks class statics), report the error output instead of rewriting the mock.
- If `tsc` complains that `taskRepoDir` is not accessible in `create`, use the inline
  `path.join(shadowDir, "tasks", taskId, "checkpoints")` exactly as the old factory did.
