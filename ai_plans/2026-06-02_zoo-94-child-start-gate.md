# Port plan — Zoo PR #94 (Tier 1) → `feature/zoo-94-child-start-gate`

> Executor: do the steps in order. This repo is **Tumble Code**; never introduce
> "Roo"/"Zoo" user-facing strings. Internal ids stay `Roo-Code`.

---

## 0. Context

- **Upstream:** Zoo PR #94 — "[Chore] Unskip VS Code e2e replay for subtasks"
  (commit `3df406e17`). This is the **first of three slices** we are porting from
  that PR (Tier 1 of the assessment).
- **What it does:** `createTask` in the provider gates its explicit `task.start()`
  call on `options.startTask !== false`, so a caller that passes `startTask: false`
  actually gets a non-started task.
- **Why we want it, with evidence in OUR code:**
    - [`src/core/webview/ClineProvider.ts:3019`](../src/core/webview/ClineProvider.ts#L3019)
      calls `task.start()` **unconditionally**. The `startTask: false` at line 3014
      is spread only into the **Task constructor** options, which suppresses the
      _constructor's_ auto-start ([`Task.ts:643`](../src/core/task/Task.ts#L643)) —
      not this explicit call.
    - `task.start()` → `lifecycle.start()` sets `_started = true` and, because the
      child's message text is present, runs the task loop immediately
      ([`TaskLifecycle.ts:385-396`](../src/core/task/TaskLifecycle.ts#L385-L396)).
    - In `delegateParentAndOpenChild` the child is created with `startTask: false`
      ([`ClineProvider.ts:3374`](../src/core/webview/ClineProvider.ts#L3374)) **so
      that** the child loop only begins at step 6 `child.start()`
      ([`:3398`](../src/core/webview/ClineProvider.ts#L3398)) — after step 5
      persists the parent's delegation metadata ([`:3378-3395`](../src/core/webview/ClineProvider.ts#L3378-L3395)).
      But because of the unconditional start, the child loop already began at step 4,
      making the step-6 `child.start()` a no-op (`_started` guard). The parent
      metadata is therefore persisted **after** the child is already running — the
      exact race the comment at lines 3365-3370 claims to prevent.
- **What we deliberately leave out (YAGNI):** the rest of PR #94 — the
  `runDelegationTransition` lock, `cancelTask` parent-detach, `reopenParentFromDelegation`
  guard/idempotency, rollback, `presentAssistantMessage`/`Task.ts` edits, and the
  e2e replay suite. Those are separate slices (Tiers 2-4).
- **Original author(s) — credit them.** Elliott de Launay. When committing (only
  if asked):

    ```text
    Co-authored-by: Elliott de Launay <edelauna@gmail.com>
    ```

## 1. Preconditions

- [ ] Branch `feature/zoo-94-child-start-gate` is checked out (off `main`).
- [ ] [`src/core/webview/ClineProvider.ts`](../src/core/webview/ClineProvider.ts)
      and [`src/core/webview/__tests__/ClineProvider.spec.ts`](../src/core/webview/__tests__/ClineProvider.spec.ts)
      exist.
- [ ] The edit site still reads exactly (around line 3017-3019):

```ts
await this.addClineToStack(task)
task.start()
```

- [ ] `createTask`'s signature has `options: CreateTaskOptions = {}` (so
      `options.startTask` is always safe to read) — confirmed at
      [`:2939`](../src/core/webview/ClineProvider.ts#L2939).

## 2. Write the failing test FIRST (TDD)

- **File:** `src/core/webview/__tests__/ClineProvider.spec.ts`.
- Prereq edit so the Task mock exposes `start`: in the `beforeAll`
  `vi.mocked(Task).mockImplementation(...)` block (around line 308), add a
  `start` mock to the returned `task` object:

```ts
			const task: any = {
				api: undefined,
				abortTask: vi.fn(),
				start: vi.fn(),
				handleWebviewAskResponse: vi.fn(),
```

- Add this test suite (place it after the `"constructor initializes correctly"`
  test, inside the top-level `describe("ClineProvider", ...)`):

```ts
describe("createTask startTask gating", () => {
	const stubCreateTaskDeps = () => {
		// createTask runs setValues + allowlist + addClineToStack before start();
		// stub those so the test exercises only the start()-gating branch.
		vi.spyOn(provider as any, "setValues").mockResolvedValue(undefined)
		vi.spyOn(provider, "getState").mockResolvedValue({ mode: "code" } as any)
		vi.spyOn(provider as any, "addClineToStack").mockResolvedValue(undefined)
	}

	it("auto-starts the task by default", async () => {
		stubCreateTaskDeps()
		const task = await provider.createTask("hello")
		expect((task as any).start).toHaveBeenCalledTimes(1)
	})

	it("does NOT auto-start when options.startTask is false", async () => {
		stubCreateTaskDeps()
		const task = await provider.createTask("hello", undefined, undefined, { startTask: false })
		expect((task as any).start).not.toHaveBeenCalled()
	})
})
```

- **Run (from `src/`):**
  `npx vitest run core/webview/__tests__/ClineProvider.spec.ts -t "createTask startTask gating"`
- **Expect:** the second test FAILS (`start` called once though `startTask:false`).
  The first passes.
- If the second test passes already, STOP — the gate is already present.

## 3. Implement — minimal change

### Edit 1 — `src/core/webview/ClineProvider.ts`

Replace:

```ts
await this.addClineToStack(task)
task.start()
```

With:

```ts
await this.addClineToStack(task)
// Gate the explicit start so callers passing `startTask: false`
// (e.g. delegateParentAndOpenChild) can persist surrounding metadata
// before the task loop begins. Without this, the child loop starts here
// and the later child.start() becomes a no-op (_started guard).
if (options.startTask !== false) {
	task.start()
}
```

## 4. Out of scope — do NOT do these

- The other PR #94 slices (lock, cancelTask detach, reopen guard, rollback,
  presentAssistantMessage, Task.ts, e2e suite).
- Do not touch `delegateParentAndOpenChild` itself — the gate alone makes its
  existing step-6 `child.start()` the real start.
- Do not re-add TTS / router / cloud / Roo branding.

## 5. Verify — paste real output

- From `src/`: `npx vitest run core/webview/__tests__/ClineProvider.spec.ts` → green.
- From `src/`: `npx tsc --noEmit` → clean.
- From `src/`: `npx eslint core/webview/ClineProvider.ts core/webview/__tests__/ClineProvider.spec.ts --max-warnings=0` → clean.

## 6. Acceptance criteria

- [ ] Both §2 tests pass; the ClineProvider suite is green.
- [ ] Only `ClineProvider.ts` + `ClineProvider.spec.ts` changed.
- [ ] No new "Roo"/"Zoo" user-facing strings; no removed feature reintroduced.

## 7. Record

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record \
  --pr 94 --status ported \
  --branch feature/zoo-94-child-start-gate \
  --plan ai_plans/2026-06-02_zoo-94-child-start-gate.md
```
