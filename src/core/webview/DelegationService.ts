import * as vscode from "vscode"

import {
	type ClineMessage,
	type CreateTaskOptions,
	type ExtensionMessage,
	type HistoryItem,
	type TodoItem,
	RooCodeEventName,
} from "@roo-code/types"

import type { Mode } from "../../shared/modes"
import type { Task } from "../task/Task"
import type { TaskHistoryStore } from "../task-persistence"
import { readApiMessages, saveApiMessages, saveTaskMessages } from "../task-persistence"
import { readTaskMessages } from "../task-persistence/taskMessages"
import { validateAndFixToolResultIds } from "../task/validateToolResultIds"
import { findLastNewTaskToolUse, formatSubtaskResult, hasToolResultFor } from "./delegationHistory"

/**
 * What the delegation state machine needs from its provider. The member names
 * match ClineProvider's, so the provider hands in closures over itself and a
 * test can hand in a plain object.
 */
export interface DelegationHost {
	readonly isViewLaunched: boolean
	readonly contextProxy: { readonly globalStorageUri: { readonly fsPath: string } }
	/** Marks the provider's own store writes so the store's change echo is suppressed. */
	readonly taskHistoryOrigin?: symbol
	getTaskHistoryStore(): Promise<Pick<TaskHistoryStore, "get" | "atomicReadAndUpdate">>
	/** Throws "Task not found" for an unknown id. */
	getHistoryItem(id: string): Promise<HistoryItem>
	/** Persists the item and broadcasts it to the webview. */
	updateTaskHistory(item: HistoryItem): Promise<void>
	postMessageToWebview(message: ExtensionMessage): Promise<void>
	log(message: string): void
	getCurrentTask(): Task | undefined
	getCurrentTaskStack(): string[]
	removeClineFromStack(options?: { skipDelegationRepair?: boolean }): Promise<void>
	createTask(text?: string, images?: string[], parentTask?: Task, options?: CreateTaskOptions): Promise<Task>
	createTaskWithHistoryItem(item: HistoryItem, options?: { startTask?: boolean }): Promise<Task>
	handleModeSwitch(mode: Mode): Promise<void>
	emit(event: string | symbol, ...args: any[]): boolean
	/** Shows an organization allow-list rejection; returns whether `error` was one. */
	showAllowListViolation(error: unknown): boolean
}

/**
 * The completion gate: does this parent still wait for this child?
 *
 * `awaitingChildId` is the authoritative signal: it is set only by
 * {@link DelegationService.delegate} and {@link DelegationService.reattach}
 * and cleared by every genuine detach. The status is deliberately not
 * required to be "delegated" (only "completed" is rejected): a late
 * background usage-drain save on the disposed parent can flip the status
 * "delegated" to "active" while keeping `awaitingChildId`. See
 * ai_plans/2026-06-08_delegated-subtask-no-return.md.
 */
export function parentAwaitsChild(parent: HistoryItem | undefined, childTaskId: string): boolean {
	return parent?.awaitingChildId === childTaskId && parent?.status !== "completed"
}

/**
 * The delegation state machine between a parent task and the child it opened
 * with `new_task`. The state lives on the parent's `HistoryItem`:
 *
 * | transition   | parent before                                | parent after                                        |
 * | ------------ | -------------------------------------------- | --------------------------------------------------- |
 * | `delegate`   | the current task                             | delegated, awaiting and delegatedTo the child       |
 * | `detach`     | delegated, awaiting the child                | active, awaiting nothing (delegatedToId is kept)    |
 * | `reattach`   | active, awaiting nothing, delegatedTo child  | delegated, awaiting the child (with 2 more proofs)  |
 * | `complete`   | awaiting the child (see parentAwaitsChild)   | active, awaiting nothing, completedByChildId set    |
 *
 * `detach` runs when the child is removed from the stack or cancelled, so
 * the parent is not stuck waiting for a dead child; `reattach` undoes that
 * when the same child is later resumed and completes.
 */
export class DelegationService {
	/**
	 * Children whose delegated parent could not be proven detached on cancel.
	 * {@link complete} refuses to reopen a parent for any child here.
	 */
	readonly cancelledChildIds = new Set<string>()

	constructor(private readonly host: DelegationHost) {}

	/**
	 * Delegate the current task to a new child task and open the child.
	 *
	 * - Enforce single-open invariant
	 * - Persist parent delegation metadata
	 * - Emit TaskDelegated (task-level; API forwards to provider/bridge)
	 * - Create child as sole active and switch mode to child's mode
	 */
	async delegate(params: {
		parentTaskId: string
		message: string
		initialTodos: TodoItem[]
		mode: string
	}): Promise<Task> {
		const { parentTaskId, message, initialTodos, mode } = params

		// Metadata-driven delegation is always enabled

		// 1) Get parent (must be current task)
		const parent = this.host.getCurrentTask()
		if (!parent) {
			throw new Error("[delegateParentAndOpenChild] No current task")
		}
		if (parent.taskId !== parentTaskId) {
			throw new Error(
				`[delegateParentAndOpenChild] Parent mismatch: expected ${parentTaskId}, current ${parent.taskId}`,
			)
		}
		// 2) Flush pending tool results to API history BEFORE disposing the parent.
		//    This is critical: when tools are called before new_task,
		//    their tool_result blocks are in userMessageContent but not yet saved to API history.
		//    If we don't flush them, the parent's API conversation will be incomplete and
		//    cause 400 errors when resumed (missing tool_result for tool_use blocks).
		//
		//    NOTE: We do NOT pass the assistant message here because the assistant message
		//    is already added to apiConversationHistory by the normal flow in
		//    recursivelyMakeClineRequests BEFORE tools start executing. We only need to
		//    flush the pending user message with tool_results.
		try {
			const flushSuccess = await parent.flushPendingToolResultsToHistory()

			if (!flushSuccess) {
				console.warn(`[delegateParentAndOpenChild] Flush failed for parent ${parentTaskId}, retrying...`)
				const retrySuccess = await parent.retrySaveApiConversationHistory()

				if (!retrySuccess) {
					console.error(
						`[delegateParentAndOpenChild] CRITICAL: Parent ${parentTaskId} API history not persisted to disk. Child return may produce stale state.`,
					)
					vscode.window.showWarningMessage(
						"Warning: Parent task state could not be saved. The parent task may lose recent context when resumed.",
					)
				}
			}
		} catch (error) {
			this.host.log(
				`[delegateParentAndOpenChild] Error flushing pending tool results (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}

		// 3) Enforce single-open invariant by closing/disposing the parent first
		//    This ensures we never have >1 tasks open at any time during delegation.
		//    Await abort completion to ensure clean disposal and prevent unhandled rejections.
		try {
			await this.host.removeClineFromStack({ skipDelegationRepair: true })
		} catch (error) {
			this.host.log(
				`[delegateParentAndOpenChild] Error during parent disposal (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
			// Non-fatal: proceed with child creation even if parent cleanup had issues
		}

		// 3) Switch provider mode to child's requested mode BEFORE creating the child task
		//    This ensures the child's system prompt and configuration are based on the correct mode.
		//    The mode switch must happen before createTask() because the Task constructor
		//    initializes its mode from provider.getState() during initializeTaskMode().
		try {
			await this.host.handleModeSwitch(mode as any)
		} catch (e) {
			this.host.log(
				`[delegateParentAndOpenChild] handleModeSwitch failed for mode '${mode}': ${
					(e as Error)?.message ?? String(e)
				}`,
			)
		}

		// 4) Create child as sole active (parent reference preserved for lineage)
		// Pass initialStatus: "active" to ensure the child task's historyItem is created
		// with status from the start, avoiding race conditions where the task might
		// call attempt_completion before status is persisted separately.
		//
		// Pass startTask: false to prevent the child from beginning its task loop
		// (and persisting its own history_item.json via saveClineMessages →
		// updateTaskHistory) before we persist the parent's delegation
		// metadata in step 5. Without this, the child's fire-and-forget
		// startTask() races with step 5's atomicReadAndUpdate, and the last
		// writer to the parent's history_item.json overwrites the other's
		// changes, causing the parent's delegation fields to be lost.
		const child = await this.host.createTask(message, undefined, parent as any, {
			initialTodos,
			initialStatus: "active",
			startTask: false,
		})

		// 5) Persist parent delegation metadata BEFORE the child starts writing.
		//    atomicReadAndUpdate reads from the in-memory cache and writes back within a
		//    single lock acquisition: no concurrent writer can slip between the read and
		//    write, and the pure updater cannot re-enter the lock (no deadlock).
		//    Broadcast and cache invalidation happen outside the lock after it releases.
		try {
			// Mark self-originated so the shared store's onChange echo
			// (external:false) is suppressed for us; we send our own
			// targeted message below. Other providers sharing the store
			// still receive the echo and push their own targeted update.
			const taskHistoryStore = await this.host.getTaskHistoryStore()
			await taskHistoryStore.atomicReadAndUpdate(
				parentTaskId,
				(historyItem) => {
					const childIds = Array.from(new Set([...(historyItem.childIds ?? []), child.taskId]))
					return {
						...historyItem,
						status: "delegated",
						delegatedToId: child.taskId,
						awaitingChildId: child.taskId,
						childIds,
					}
				},
				this.host.taskHistoryOrigin,
			)
			if (this.host.isViewLaunched) {
				const updatedItem = taskHistoryStore.get(parentTaskId)
				if (updatedItem) {
					await this.host.postMessageToWebview({
						type: "taskHistoryItemUpdated",
						taskHistoryItem: updatedItem,
					})
				}
			}
		} catch (err) {
			this.host.log(
				`[delegateParentAndOpenChild] Failed to persist parent metadata for ${parentTaskId} -> ${child.taskId}: ${
					(err as Error)?.message ?? String(err)
				}`,
			)
		}

		// 6) Start the child task now that parent metadata is safely persisted.
		child.start()

		// 7) Emit TaskDelegated (provider-level)
		try {
			this.host.emit(RooCodeEventName.TaskDelegated, parentTaskId, child.taskId)
		} catch {
			// non-fatal
		}

		return child
	}

	/**
	 * Detach a parent from a child that went away (removed from the stack or
	 * cancelled): "delegated" awaiting this child becomes "active" awaiting
	 * nothing, so the parent is resumable from the history list instead of
	 * stuck waiting for a dead child. Returns whether the parent was detached.
	 * Throws when the parent cannot be read or written; callers decide whether
	 * that is fatal.
	 */
	async detach(parentTaskId: string, childTaskId: string): Promise<boolean> {
		const parentHistory = await this.host.getHistoryItem(parentTaskId)

		if (parentHistory?.status !== "delegated" || parentHistory?.awaitingChildId !== childTaskId) {
			return false
		}

		await this.host.updateTaskHistory({
			...parentHistory,
			status: "active",
			awaitingChildId: undefined,
		})
		return true
	}

	/**
	 * The cancel path of {@link detach}. Returns the child's history item to
	 * rehydrate and whether its parent/root task references must be dropped.
	 *
	 * Fail closed: if the parent cannot be proven detached, the child is made
	 * standalone (persisted without parent/root ids) and fenced in
	 * {@link cancelledChildIds}, so a later completion cannot reopen a stale
	 * delegated parent, even after a provider reload. Rethrows only when that
	 * standalone state cannot be persisted either.
	 */
	async detachOnCancel(
		childTaskId: string,
		parentTaskId: string,
		childHistory: HistoryItem,
	): Promise<{ dropLineage: boolean; childHistory: HistoryItem }> {
		try {
			if (!(await this.detach(parentTaskId, childTaskId))) {
				return { dropLineage: false, childHistory }
			}

			this.host.log(
				`[cancelTask] Detached delegated parent ${parentTaskId}: delegated → active (child ${childTaskId} cancelled)`,
			)
			// Clear any stale fail-closed entry from a prior failed cancel attempt.
			this.cancelledChildIds.delete(childTaskId)
			return { dropLineage: true, childHistory }
		} catch (error) {
			this.cancelledChildIds.add(childTaskId)
			const standalone: HistoryItem = {
				...childHistory,
				parentTaskId: undefined,
				rootTaskId: undefined,
			}
			try {
				await this.host.updateTaskHistory(standalone)
			} catch (historyError) {
				this.host.log(
					`[cancelTask] Failed to persist standalone child state for ${childTaskId}: ${
						historyError instanceof Error ? historyError.message : String(historyError)
					}`,
				)
				throw historyError
			}
			this.host.log(
				`[cancelTask] Failed to detach delegated parent for ${childTaskId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
			return { dropLineage: true, childHistory: standalone }
		}
	}

	/**
	 * Attempt to re-attach a detached parent when its cancelled/resumed child later completes.
	 *
	 * Both `cancelTask` and `removeClineFromStack` deliberately detach the parent
	 * (status → "active", awaitingChildId → undefined) so the parent is not stuck
	 * waiting for a dead child. But if the child is later resumed and completes,
	 * nothing re-establishes delegation, so the child falls through to standalone
	 * completion instead of returning its result to the parent.
	 *
	 * This method re-stamps the parent `{status: "delegated", awaitingChildId: childTaskId}`
	 * ONLY when ALL five evidence conditions hold (see ai_plans/2026-07-12_delegated-child-return-after-cancel.md):
	 *   1. parentHistory.status === "active" (not completed; not already delegated to someone else);
	 *   2. parentHistory.awaitingChildId === undefined (no live delegation);
	 *   3. parentHistory.delegatedToId === childTaskId (the parent's LAST delegation was to THIS child);
	 *   4. parent is not currently open in the task stack (user is not actively working in it);
	 *   5. untouched-tail proof: the parent's persisted API messages still end frozen at the
	 *      delegation: the last `new_task` tool_use has NO tool_result answering it in any
	 *      later message (same backward scan as {@link complete}).
	 *
	 * Returns true on successful re-attach, false otherwise (never throws).
	 */
	async reattach(parentTaskId: string, childTaskId: string): Promise<boolean> {
		try {
			// 1-3: Load parent history and check the three metadata conditions.
			const parentHistory = await this.host.getHistoryItem(parentTaskId)

			if (parentHistory.status !== "active") {
				this.host.log(
					`[tryReattachDelegatedParent] Rejecting: parent ${parentTaskId} status is "${parentHistory.status}", not "active"`,
				)
				return false
			}

			if (parentHistory.awaitingChildId !== undefined) {
				this.host.log(
					`[tryReattachDelegatedParent] Rejecting: parent ${parentTaskId} already has awaitingChildId="${parentHistory.awaitingChildId}"`,
				)
				return false
			}

			if (parentHistory.delegatedToId !== childTaskId) {
				this.host.log(
					`[tryReattachDelegatedParent] Rejecting: parent ${parentTaskId} delegatedToId="${parentHistory.delegatedToId}" !== child "${childTaskId}"`,
				)
				return false
			}

			// 4: Parent must not be currently open in the task stack.
			const stackIds = this.host.getCurrentTaskStack()
			if (stackIds.includes(parentTaskId)) {
				this.host.log(
					`[tryReattachDelegatedParent] Rejecting: parent ${parentTaskId} is currently open in the task stack [${stackIds.join(", ")}]`,
				)
				return false
			}

			// 5: Untouched-tail proof: read the parent's persisted API messages and scan
			//    backward for the last `new_task` tool_use, then verify NO later message
			//    contains a `tool_result` with that tool_use_id.
			let parentApiMessages: any[] = []
			try {
				parentApiMessages = (await readApiMessages({
					taskId: parentTaskId,
					globalStoragePath: this.host.contextProxy.globalStorageUri.fsPath,
				})) as any[]
			} catch (readErr) {
				this.host.log(
					`[tryReattachDelegatedParent] Rejecting: failed to read parent API messages for ${parentTaskId}: ${
						readErr instanceof Error ? readErr.message : String(readErr)
					}`,
				)
				return false
			}

			if (!Array.isArray(parentApiMessages)) {
				this.host.log(
					`[tryReattachDelegatedParent] Rejecting: parent ${parentTaskId} API messages is not an array`,
				)
				return false
			}

			// Same backward scan as complete().
			const lastNewTask = findLastNewTaskToolUse(parentApiMessages)

			if (!lastNewTask) {
				this.host.log(
					`[tryReattachDelegatedParent] Rejecting: no new_task tool_use found in parent ${parentTaskId} API history (cannot prove frozen state)`,
				)
				return false
			}

			// Scan ALL messages AFTER the tool_use for a matching tool_result.
			const { toolUseId, messageIndex } = lastNewTask
			if (hasToolResultFor(parentApiMessages, toolUseId, messageIndex)) {
				this.host.log(
					`[tryReattachDelegatedParent] Rejecting: parent ${parentTaskId} already has a tool_result for new_task tool_use_id="${toolUseId}" (parent was resumed)`,
				)
				return false
			}

			// All five conditions hold: re-attach.
			await this.host.updateTaskHistory({
				...parentHistory,
				status: "delegated",
				awaitingChildId: childTaskId,
			})

			this.host.log(
				`[tryReattachDelegatedParent] Re-attached parent ${parentTaskId} to child ${childTaskId} (status: active → delegated, awaitingChildId: undefined → ${childTaskId})`,
			)
			return true
		} catch (err) {
			this.host.log(
				`[tryReattachDelegatedParent] Error re-attaching parent ${parentTaskId} to child ${childTaskId}: ${
					err instanceof Error ? err.message : String(err)
				}`,
			)
			return false
		}
	}

	/**
	 * Complete a delegation: write the child's result into the parent's
	 * histories, close the child, mark it completed, and reopen the parent
	 * with write-back and events. Returns false when the parent no longer
	 * awaits this child (nothing is written then).
	 */
	async complete(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<boolean> {
		const { parentTaskId, childTaskId, completionResultSummary } = params
		const globalStoragePath = this.host.contextProxy.globalStorageUri.fsPath

		// 1) Load parent from history and current persisted messages
		const historyItem = await this.host.getHistoryItem(parentTaskId)

		// Guard: re-validate delegation state after the async approval gap.
		// cancelTask() or removeClineFromStack() may have already detached the parent
		// (status → "active", awaitingChildId → undefined) while the user was
		// approving the subtask finish. Routing output back now would corrupt an
		// unrelated task. The same gate as AttemptCompletionTool (parentAwaitsChild),
		// so delegateToParent does not get a false `didReopen === false`.
		if (this.cancelledChildIds.has(childTaskId) || !parentAwaitsChild(historyItem, childTaskId)) {
			this.host.log(
				`[reopenParentFromDelegation] Aborting: parent ${parentTaskId} is no longer delegated to child ${childTaskId} ` +
					`(status=${historyItem.status}, awaitingChildId=${historyItem.awaitingChildId})`,
			)
			return false
		}

		let parentClineMessages: ClineMessage[] = []
		try {
			parentClineMessages = await readTaskMessages({
				taskId: parentTaskId,
				globalStoragePath,
			})
		} catch {
			parentClineMessages = []
		}

		let parentApiMessages: any[] = []
		try {
			parentApiMessages = (await readApiMessages({
				taskId: parentTaskId,
				globalStoragePath,
			})) as any[]
		} catch {
			parentApiMessages = []
		}

		// 2) Inject synthetic records: UI subtask_result and update API tool_result
		const ts = Date.now()

		// Defensive: ensure arrays
		if (!Array.isArray(parentClineMessages)) parentClineMessages = []
		if (!Array.isArray(parentApiMessages)) parentApiMessages = []

		const subtaskUiMessage: ClineMessage = {
			type: "say",
			say: "subtask_result",
			text: completionResultSummary,
			ts,
		}
		const lastParentClineMessage = parentClineMessages.at(-1)
		if (
			lastParentClineMessage?.type !== "say" ||
			lastParentClineMessage.say !== "subtask_result" ||
			lastParentClineMessage.text !== completionResultSummary
		) {
			parentClineMessages.push(subtaskUiMessage)
		}
		await saveTaskMessages({ messages: parentClineMessages, taskId: parentTaskId, globalStoragePath })

		// Find the tool_use_id from the last assistant message's new_task tool_use
		const toolUseId = findLastNewTaskToolUse(parentApiMessages)?.toolUseId
		const subtaskResultText = formatSubtaskResult(childTaskId, completionResultSummary)

		// Preferred: if the parent history contains the native tool_use for new_task,
		// inject a matching tool_result for the Anthropic message contract:
		// user → assistant (tool_use) → user (tool_result)
		if (toolUseId) {
			// Check if the last message is already a user message with a tool_result for this tool_use_id
			// (in case this is a retry or the history was already updated)
			const lastMsg = parentApiMessages[parentApiMessages.length - 1]
			let alreadyHasToolResult = false
			if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
				for (const block of lastMsg.content) {
					if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
						// Update the existing tool_result content
						block.content = subtaskResultText
						alreadyHasToolResult = true
						break
					}
				}
			}

			// If no existing tool_result found, create a NEW user message with the tool_result
			if (!alreadyHasToolResult) {
				parentApiMessages.push({
					role: "user",
					content: [
						{
							type: "tool_result" as const,
							tool_use_id: toolUseId,
							content: subtaskResultText,
						},
					],
					ts,
				})
			}

			// Validate the newly injected tool_result against the preceding assistant message.
			// This ensures the tool_result's tool_use_id matches a tool_use in the immediately
			// preceding assistant message (Anthropic API requirement).
			const lastMessage = parentApiMessages[parentApiMessages.length - 1]
			if (lastMessage?.role === "user") {
				const validatedMessage = validateAndFixToolResultIds(lastMessage, parentApiMessages.slice(0, -1))
				parentApiMessages[parentApiMessages.length - 1] = validatedMessage
			}
		} else {
			// If there is no corresponding tool_use in the parent API history, we cannot emit a
			// tool_result. Fall back to a plain user text note so the parent can still resume.
			const fallbackText = subtaskResultText
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

		await saveApiMessages({ messages: parentApiMessages as any, taskId: parentTaskId, globalStoragePath })

		// 3) Close child instance if still open (single-open-task invariant).
		//    This MUST happen BEFORE updating the child's status to "completed" because
		//    removeClineFromStack() → abortTask(true) → saveClineMessages() writes
		//    the historyItem with initialStatus (typically "active"), which would
		//    overwrite a "completed" status set earlier.
		const current = this.host.getCurrentTask()
		if (current?.taskId === childTaskId) {
			// This method explicitly persists the parent's active state below, so the
			// generic delegated→active repair in removeClineFromStack would be redundant.
			await this.host.removeClineFromStack({ skipDelegationRepair: true })
		}

		// 4) Update child metadata to "completed" status.
		//    This runs after the abort so it overwrites the stale "active" status
		//    that saveClineMessages() may have written during step 3.
		try {
			const childHistory = await this.host.getHistoryItem(childTaskId)
			await this.host.updateTaskHistory({
				...childHistory,
				status: "completed",
			})
		} catch (err) {
			this.host.log(
				`[reopenParentFromDelegation] Failed to persist child completed status for ${childTaskId}: ${
					(err as Error)?.message ?? String(err)
				}`,
			)
		}

		// 5) Update parent metadata and persist BEFORE emitting completion event
		const childIds = Array.from(new Set([...(historyItem.childIds ?? []), childTaskId]))
		const updatedHistory: typeof historyItem = {
			...historyItem,
			status: "active",
			completedByChildId: childTaskId,
			completionResultSummary,
			awaitingChildId: undefined,
			childIds,
		}
		await this.host.updateTaskHistory(updatedHistory)

		// 6) Emit TaskDelegationCompleted (provider-level)
		try {
			this.host.emit(RooCodeEventName.TaskDelegationCompleted, parentTaskId, childTaskId, completionResultSummary)
		} catch {
			// non-fatal
		}

		// 7) Reopen the parent from history as the sole active task (restores saved mode)
		//    IMPORTANT: startTask=false to suppress resume-from-history ask scheduling
		let parentInstance: Task
		try {
			parentInstance = await this.host.createTaskWithHistoryItem(updatedHistory, { startTask: false })
		} catch (error) {
			// The parent's profile is no longer allowed. The child is already
			// closed and the parent's history holds the result (steps 2-5), so
			// the delegation is complete; the parent just stays closed until
			// the user reopens it on an allowed profile. Returning true keeps
			// the closed child from falling through to its own completion ask.
			if (!this.host.showAllowListViolation(error)) {
				throw error
			}
			this.host.log(
				`[reopenParentFromDelegation] Parent ${parentTaskId} not reopened: ${(error as Error).message}`,
			)
			this.cancelledChildIds.delete(childTaskId)
			return true
		}

		// 8) Inject restored histories into the in-memory instance before resuming
		if (parentInstance) {
			try {
				await parentInstance.overwriteClineMessages(parentClineMessages)
			} catch {
				// non-fatal
			}
			try {
				await parentInstance.overwriteApiConversationHistory(parentApiMessages as any)
			} catch {
				// non-fatal
			}

			// Auto-resume parent without ask("resume_task")
			await parentInstance.resumeAfterDelegation()
		}

		// 9) Emit TaskDelegationResumed (provider-level)
		try {
			this.host.emit(RooCodeEventName.TaskDelegationResumed, parentTaskId, childTaskId)
		} catch {
			// non-fatal
		}

		this.cancelledChildIds.delete(childTaskId)
		return true
	}
}
