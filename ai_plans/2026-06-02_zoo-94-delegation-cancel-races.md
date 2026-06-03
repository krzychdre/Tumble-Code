# Port plan — Zoo PR #94 (Tiers 2+3) → `feature/zoo-94-delegation-cancel-races`

> Stacked on `feature/zoo-94-child-start-gate`. This repo is **Tumble Code**;
> never introduce "Roo"/"Zoo" user-facing strings. Internal ids stay `Roo-Code`.

---

## 0. Context

- **Upstream:** Zoo PR #94 (commit `3df406e17`). Slices 2 and 3 of our
  three-slice port (Tier 1 = `feature/zoo-94-child-start-gate`).
- **What it does (the parts we keep):**
    1. **cancelTask detaches a delegated parent.** When a delegated subtask is
       cancelled, flip the parent `delegated → active` and clear `awaitingChildId`,
       and rehydrate the child as standalone (drop parent/root). Fail closed if the
       detach can't be proven.
    2. **reopenParentFromDelegation re-validates** the parent still awaits this
       child before routing the subtask result back; returns `boolean`; and is
       idempotent on the injected `subtask_result` / fallback messages.
    3. **AttemptCompletionTool** re-checks the parent's status before delegating and
       treats `reopenParentFromDelegation() === false` as "continue".
- **Why we want it, evidence in OUR code:**
    - **Race A (orphaned parent):** [`cancelTask`](../src/core/webview/ClineProvider.ts#L3028)
      preserves `parentTask`/`rootTask` and rehydrates the child
      ([`:3115`](../src/core/webview/ClineProvider.ts#L3115)) but never detaches the
      parent — after cancelling a subtask the parent stays `status:"delegated"`,
      `awaitingChildId` still set = stuck/orphaned.
    - **Race B (stale routing):** [`reopenParentFromDelegation`](../src/core/webview/ClineProvider.ts#L3413)
      loads the parent and unconditionally writes the subtask result, even if the
      parent was detached / child cancelled during the `askFinishSubTaskApproval`
      gap. It also pushes the `subtask_result` UI message
      ([`:3457`](../src/core/webview/ClineProvider.ts#L3457)) and fallback text
      ([`:3520`](../src/core/webview/ClineProvider.ts#L3520)) non-idempotently
      (duplicates on retry).
- **What we deliberately leave out (YAGNI / Tier 4):**
    - The `runDelegationTransition` **serialization lock** (`Map` + free function).
      The per-method guards below already prevent the corruption; the lock only adds
      protection against truly concurrent transitions and would graft a concurrency
      framework onto our diverged provider. **Do not port it.** Because of this, the
      edits below run their bodies **directly**, not wrapped in a lock.
    - `delegateParentAndOpenChild` rollback (only triggers on a rare
      `updateTaskHistory` throw).
    - The `presentAssistantMessage` abort→return and the `Task.ts` `pWaitFor` guard
      (our `Task.ts` has no such `pWaitFor`; it doesn't apply).
    - The e2e replay suite.
- **Original author(s) — credit them.** Elliott de Launay. When committing
  (only if asked):

    ```text
    Co-authored-by: Elliott de Launay <edelauna@gmail.com>
    ```

## 1. Preconditions

- [ ] Branch `feature/zoo-94-delegation-cancel-races` (stacked on Tier 1).
- [ ] [`src/core/webview/ClineProvider.ts`](../src/core/webview/ClineProvider.ts),
      [`src/core/tools/AttemptCompletionTool.ts`](../src/core/tools/AttemptCompletionTool.ts) exist.
- [ ] `HistoryItem` has `status`, `awaitingChildId`, `parentTaskId`, `rootTaskId`,
      `completedByChildId`, `completionResultSummary`, `childIds`
      (confirmed [`packages/types/src/history.ts:9-28`](../packages/types/src/history.ts#L9-L28)).
- [ ] `cancelTask` still declares `const rootTask`/`const parentTask` at
      [`:3053-3054`](../src/core/webview/ClineProvider.ts#L3053-L3054) and ends with
      `await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })`.

## 2. Write the failing tests FIRST (TDD)

- **File (new):** `src/core/webview/__tests__/ClineProvider.delegation-cancel-races.spec.ts`
- Use the mock scaffolding from `ClineProvider.flicker-free-cancel.spec.ts`
  (copy its `vi.mock(...)` block verbatim) plus the two tests below.

```ts
it("cancelTask detaches a delegated parent and rehydrates the child standalone", async () => {
	const childTask: any = {
		taskId: "child-1",
		instanceId: "ci-1",
		parentTaskId: "parent-1",
		rootTask: { taskId: "parent-1" },
		parentTask: { taskId: "parent-1" },
		isStreaming: false,
		emit: vi.fn(),
		abortTask: vi.fn().mockResolvedValue(undefined),
		cancelCurrentRequest: vi.fn(),
		abandoned: false,
	}
	;(provider as any).clineStack = [childTask]
	const updateTaskHistory = vi.fn().mockResolvedValue(undefined)
	;(provider as any).updateTaskHistory = updateTaskHistory
	provider.getTaskWithId = vi.fn().mockImplementation((id: string) =>
		Promise.resolve({
			historyItem:
				id === "parent-1"
					? { id: "parent-1", status: "delegated", awaitingChildId: "child-1" }
					: { id: "child-1", status: "active", parentTaskId: "parent-1", rootTaskId: "parent-1" },
		}),
	)
	const createWithHistory = vi.fn().mockResolvedValue(undefined)
	provider.createTaskWithHistoryItem = createWithHistory as any

	await provider.cancelTask()

	// Parent detached: delegated -> active, awaitingChildId cleared.
	expect(updateTaskHistory).toHaveBeenCalledWith(
		expect.objectContaining({ id: "parent-1", status: "active", awaitingChildId: undefined }),
	)
	// Child rehydrated standalone (no parentTask/rootTask carried over).
	expect(createWithHistory).toHaveBeenCalledWith(
		expect.objectContaining({ parentTask: undefined, rootTask: undefined }),
	)
})

it("reopenParentFromDelegation aborts (returns false) when parent no longer awaits this child", async () => {
	const updateTaskHistory = vi.fn().mockResolvedValue(undefined)
	const fakeProvider: any = {
		contextProxy: { globalStorageUri: { fsPath: "/test/storage" } },
		cancelledDelegationChildIds: new Set<string>(),
		log: vi.fn(),
		updateTaskHistory,
		getTaskWithId: vi.fn().mockResolvedValue({
			historyItem: { id: "parent-1", status: "active", awaitingChildId: undefined },
		}),
	}

	const result = await (ClineProvider.prototype as any).reopenParentFromDelegation.call(fakeProvider, {
		parentTaskId: "parent-1",
		childTaskId: "child-1",
		completionResultSummary: "done",
	})

	expect(result).toBe(false)
	expect(updateTaskHistory).not.toHaveBeenCalled()
})
```

- **Run (from `src/`):**
  `npx vitest run core/webview/__tests__/ClineProvider.delegation-cancel-races.spec.ts`
- **Expect:** the cancelTask test FAILS (parent never detached; child rehydrated
  with parent), and the reopen test FAILS (returns `undefined`, not `false`).

## 3. Implement — minimal changes

### Edit 1 — `src/core/webview/ClineProvider.ts`: add the fail-closed Set field

Find the `private clineStack: Task[] = []` field and add immediately after it:

```ts
	private clineStack: Task[] = []
	// Children whose delegated parent could not be proven detached on cancel.
	// reopenParentFromDelegation() refuses to reopen a parent for any child here.
	private cancelledDelegationChildIds = new Set<string>()
```

### Edit 2 — `src/core/webview/ClineProvider.ts`: `cancelTask` `const` → `let`

Replace:

```ts
// Preserve parent and root task information for history item.
const rootTask = task.rootTask
const parentTask = task.parentTask
```

With:

```ts
// Preserve parent and root task information for history item.
// `let` because a delegated-parent detach below may clear them.
let rootTask = task.rootTask
let parentTask = task.parentTask
```

### Edit 3 — `src/core/webview/ClineProvider.ts`: detach delegated parent on cancel

Replace:

```ts
		if (!historyItem) {
			return
		}

		// Clears task again, so we need to abortTask manually above.
		await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
	}
```

With:

```ts
		if (!historyItem) {
			return
		}

		// If this is a delegated subtask, detach its parent so the parent does not
		// stay stuck in "delegated" awaiting a child that the user just cancelled.
		if (task.parentTaskId) {
			try {
				const { historyItem: parentHistory } = await this.getTaskWithId(task.parentTaskId)

				if (parentHistory?.status === "delegated" && parentHistory?.awaitingChildId === task.taskId) {
					await this.updateTaskHistory({
						...parentHistory,
						status: "active",
						awaitingChildId: undefined,
					})

					this.log(
						`[cancelTask] Detached delegated parent ${task.parentTaskId}: delegated → active (child ${task.taskId} cancelled)`,
					)
					parentTask = undefined
					rootTask = undefined
					// Clear any stale fail-closed entry from a prior failed cancel attempt.
					this.cancelledDelegationChildIds.delete(task.taskId)
				}
			} catch (error) {
				// Fail closed: if we cannot prove the parent was detached, make the
				// rehydrated child standalone so later completions cannot reopen a
				// stale delegated parent, even after a provider reload.
				parentTask = undefined
				rootTask = undefined
				this.cancelledDelegationChildIds.add(task.taskId)
				historyItem = {
					...historyItem,
					parentTaskId: undefined,
					rootTaskId: undefined,
				}
				try {
					await this.updateTaskHistory(historyItem)
				} catch (historyError) {
					this.log(
						`[cancelTask] Failed to persist standalone child state for ${task.taskId}: ${
							historyError instanceof Error ? historyError.message : String(historyError)
						}`,
					)
					throw historyError
				}
				this.log(
					`[cancelTask] Failed to detach delegated parent for ${task.taskId}: ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
			}
		}

		// Clears task again, so we need to abortTask manually above.
		await this.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
	}
```

### Edit 4 — `src/core/webview/ClineProvider.ts`: `reopenParentFromDelegation` signature → `boolean`

Replace:

```ts
	public async reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void> {
```

With:

```ts
	public async reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<boolean> {
```

### Edit 5 — `reopenParentFromDelegation`: revalidation guard

Replace:

```ts
// 1) Load parent from history and current persisted messages
const { historyItem } = await this.getTaskWithId(parentTaskId)

let parentClineMessages: ClineMessage[] = []
```

With:

```ts
// 1) Load parent from history and current persisted messages
const { historyItem } = await this.getTaskWithId(parentTaskId)

// Guard: re-validate delegation state after the async approval gap.
// cancelTask() or removeClineFromStack() may have already detached the parent
// (status → "active", awaitingChildId → undefined) while the user was
// approving the subtask finish. Routing output back now would corrupt an
// unrelated task.
if (
	this.cancelledDelegationChildIds.has(childTaskId) ||
	historyItem.status !== "delegated" ||
	historyItem.awaitingChildId !== childTaskId
) {
	this.log(
		`[reopenParentFromDelegation] Aborting: parent ${parentTaskId} is no longer delegated to child ${childTaskId} ` +
			`(status=${historyItem.status}, awaitingChildId=${historyItem.awaitingChildId})`,
	)
	return false
}

let parentClineMessages: ClineMessage[] = []
```

### Edit 6 — `reopenParentFromDelegation`: idempotent `subtask_result` push

Replace:

```ts
parentClineMessages.push(subtaskUiMessage)
await saveTaskMessages({ messages: parentClineMessages, taskId: parentTaskId, globalStoragePath })
```

With:

```ts
const lastParentClineMessage = parentClineMessages.at(-1)
if (
	lastParentClineMessage?.type !== "say" ||
	lastParentClineMessage.say !== "subtask_result" ||
	lastParentClineMessage.text !== completionResultSummary
) {
	parentClineMessages.push(subtaskUiMessage)
}
await saveTaskMessages({ messages: parentClineMessages, taskId: parentTaskId, globalStoragePath })
```

### Edit 7 — `reopenParentFromDelegation`: idempotent fallback text push

Replace:

```ts
		} else {
			// If there is no corresponding tool_use in the parent API history, we cannot emit a
			// tool_result. Fall back to a plain user text note so the parent can still resume.
			parentApiMessages.push({
				role: "user",
				content: [
					{
						type: "text" as const,
						text: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
					},
				],
				ts,
			})
		}
```

With:

```ts
		} else {
			// If there is no corresponding tool_use in the parent API history, we cannot emit a
			// tool_result. Fall back to a plain user text note so the parent can still resume.
			const fallbackText = `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`
			const lastParentApiMessage = parentApiMessages.at(-1)
			const alreadyHasFallback =
				lastParentApiMessage?.role === "user" &&
				Array.isArray(lastParentApiMessage.content) &&
				lastParentApiMessage.content.some(
					(block: { type?: string; text?: string }) => block.type === "text" && block.text === fallbackText,
				)
			if (!alreadyHasFallback) {
				parentApiMessages.push({
					role: "user",
					content: [
						{
							type: "text" as const,
							text: fallbackText,
						},
					],
					ts,
				})
			}
		}
```

### Edit 8 — `reopenParentFromDelegation`: child removal skips redundant repair

Replace:

```ts
const current = this.getCurrentTask()
if (current?.taskId === childTaskId) {
	await this.removeClineFromStack()
}
```

With:

```ts
const current = this.getCurrentTask()
if (current?.taskId === childTaskId) {
	// This method explicitly persists the parent's active state below, so the
	// generic delegated→active repair in removeClineFromStack would be redundant.
	await this.removeClineFromStack({ skipDelegationRepair: true })
}
```

### Edit 9 — `reopenParentFromDelegation`: clear guard + return true at the end

Find the end of the method (after the final `// 9) Emit TaskDelegationResumed` try/catch block, the closing of the method body). Replace the closing:

```ts
		// 9) Emit TaskDelegationResumed (provider-level)
		try {
			this.emit(RooCodeEventName.TaskDelegationResumed, parentTaskId, childTaskId)
		} catch {
			// non-fatal
		}
	}
```

With:

```ts
		// 9) Emit TaskDelegationResumed (provider-level)
		try {
			this.emit(RooCodeEventName.TaskDelegationResumed, parentTaskId, childTaskId)
		} catch {
			// non-fatal
		}

		this.cancelledDelegationChildIds.delete(childTaskId)
		return true
	}
```

### Edit 10 — `src/core/tools/AttemptCompletionTool.ts`: interface return type

Replace:

```ts
	reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void>
```

With:

```ts
	reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<boolean>
```

### Edit 11 — `AttemptCompletionTool`: re-check parent status before delegating

Replace:

```ts
					} else if (status === "active") {
						// Normal subtask completion - do delegation
						const delegation = await this.delegateToParent(
							task,
							result,
							provider,
							askFinishSubTaskApproval,
							pushToolResult,
						)
						if (delegation === "delegated") {
							this.emitTaskCompleted(task)
						}
						if (delegation !== "continue") return
					} else {
```

With:

```ts
					} else if (status === "active") {
						// Re-check the parent: it may have been detached (e.g. the user
						// cancelled this child) since delegation began. Only delegate if the
						// parent still awaits this child; otherwise fall through to the normal
						// completion ask flow.
						const { historyItem: parentHistory } = await provider.getTaskWithId(task.parentTaskId!)

						if (parentHistory?.status === "delegated" && parentHistory?.awaitingChildId === task.taskId) {
							const delegation = await this.delegateToParent(
								task,
								result,
								provider,
								askFinishSubTaskApproval,
								pushToolResult,
							)
							if (delegation === "delegated") {
								this.emitTaskCompleted(task)
							}
							if (delegation !== "continue") return
						}
						// else: parent already detached — fall through to normal completion ask flow.
					} else {
```

### Edit 12 — `AttemptCompletionTool.delegateToParent`: honor `boolean` from reopen

Replace:

```ts
pushToolResult("")

await provider.reopenParentFromDelegation({
	parentTaskId: task.parentTaskId!,
	childTaskId: task.taskId,
	completionResultSummary: result,
})

return "delegated"
```

With:

```ts
const didReopen = await provider.reopenParentFromDelegation({
	parentTaskId: task.parentTaskId!,
	childTaskId: task.taskId,
	completionResultSummary: result,
})

if (didReopen === false) {
	// Parent was detached during the approval gap; let the caller fall through
	// to the normal completion ask flow instead of reporting a (false) delegation.
	return "continue"
}

pushToolResult("")
return "delegated"
```

## 4. Out of scope — do NOT do these

- Do **not** add `runDelegationTransition` / the lock `Map` (Tier 4).
- Do **not** add `delegateParentAndOpenChild` rollback, `presentAssistantMessage`
  changes, `Task.ts` `pWaitFor` guard, or the e2e suite.
- Do **not** re-add TTS / router / cloud / Roo branding.

## 5. Verify — paste real output

- From `src/`: `npx vitest run core/webview/__tests__/ClineProvider.delegation-cancel-races.spec.ts` → green.
- From `src/`: `npx vitest run core/webview/__tests__/ClineProvider.spec.ts core/webview/__tests__/ClineProvider.flicker-free-cancel.spec.ts __tests__/provider-delegation.spec.ts __tests__/nested-delegation-resume.spec.ts __tests__/history-resume-delegation.spec.ts core/tools/__tests__/attemptCompletionTool.spec.ts` → green.
- From `src/`: `npx tsc --noEmit` → clean.
- From `src/`: `npx eslint core/webview/ClineProvider.ts core/tools/AttemptCompletionTool.ts core/webview/__tests__/ClineProvider.delegation-cancel-races.spec.ts --max-warnings=0` → clean.

## 6. Acceptance criteria

- [ ] §2 tests pass; all suites in §5 green.
- [ ] Only `ClineProvider.ts`, `AttemptCompletionTool.ts`, and the new spec changed.
- [ ] No `runDelegationTransition`/lock introduced.
- [ ] No new "Roo"/"Zoo" user-facing strings; no removed feature reintroduced.

## 7. Record

```bash
node .claude/skills/zoo-port/scripts/zoo-prs.mjs record \
  --pr 94 --status ported \
  --branch feature/zoo-94-delegation-cancel-races \
  --plan ai_plans/2026-06-02_zoo-94-delegation-cancel-races.md
```
