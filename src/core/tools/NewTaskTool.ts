import * as vscode from "vscode"

import { TodoItem } from "@tumble-code/types"

import { Task } from "../task/Task"
import { ignorePartialAskRejection } from "../task/AskIgnoredError"
import { getModeBySlug } from "../../shared/modes"
import { formatResponse } from "../prompts/responses"
import { t } from "../../i18n"
import { parseMarkdownChecklist } from "./UpdateTodoListTool"
import { Package } from "../../shared/package"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"

/**
 * How deep delegation may nest: the task the user started is level 0, its
 * subtask level 1, and so on. A normal chain (orchestrator -> code -> a helper)
 * is 2-3 levels deep; 5 leaves headroom for an orchestrator inside an
 * orchestrator while still stopping a runaway chain, where every level costs a
 * full system prompt and context (38k-100k input tokens each in the incident of
 * ai_plans/2026-10-07_new-task-delegation-guard.md).
 */
const MAX_DELEGATION_DEPTH = 5

interface NewTaskParams {
	mode: string
	message: string
	todos?: string
}

export class NewTaskTool extends BaseTool<"new_task"> {
	readonly name = "new_task" as const

	async execute(params: NewTaskParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { mode, message, todos } = params
		const { askApproval, handleError, pushToolResult, toolCallId } = callbacks

		try {
			// Background subagents must never delegate: a subtask is a small
			// one-shot job that returns to its parent. The tool is already
			// stripped from their tool list; this guards hallucinated calls
			// and prompt-listed (non-native) protocols.
			if (task.isBackground) {
				task.recordToolError("new_task")
				pushToolResult(
					formatResponse.toolError(
						"new_task is not available inside a parallel subtask. Subtasks are one-shot jobs: " +
							"do the work directly in this task and finish with attempt_completion so the " +
							"parent task can continue.",
					),
				)
				return
			}

			// Validate required parameters.
			if (!mode) {
				this.recordFailure(task, "new_task", { failTurn: true })
				pushToolResult(await task.sayAndCreateMissingParamError("new_task", "mode"))
				return
			}

			if (!message) {
				this.recordFailure(task, "new_task", { failTurn: true })
				pushToolResult(await task.sayAndCreateMissingParamError("new_task", "message"))
				return
			}

			// Get the VSCode setting for requiring todos.
			const provider = task.providerRef.deref()

			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const state = await provider.getState()

			// Use Package.name (dynamic at build time) as the VSCode configuration namespace.
			// Supports multiple extension variants (e.g., stable/nightly) without hardcoded strings.
			const requireTodos = vscode.workspace
				.getConfiguration(Package.name)
				.get<boolean>("newTaskRequireTodos", false)

			// Check if todos are required based on VSCode setting.
			// Note: `undefined` means not provided, empty string is valid.
			if (requireTodos && todos === undefined) {
				this.recordFailure(task, "new_task", { failTurn: true })
				pushToolResult(await task.sayAndCreateMissingParamError("new_task", "todos"))
				return
			}

			// Parse todos if provided, otherwise use empty array
			let todoItems: TodoItem[] = []
			if (todos) {
				try {
					todoItems = parseMarkdownChecklist(todos)
				} catch (error) {
					this.recordFailure(task, "new_task", { failTurn: true })
					pushToolResult(formatResponse.toolError("Invalid todos format: must be a markdown checklist"))
					return
				}
			}

			// Un-escape one level of backslashes before '@' for hierarchical subtasks
			// Un-escape one level: \\@ -> \@ (removes one backslash for hierarchical subtasks)
			const unescapedMessage = message.replace(/\\\\@/g, "\\@")

			// Verify the mode exists
			const targetMode = getModeBySlug(mode, state?.customModes)

			if (!targetMode) {
				pushToolResult(formatResponse.toolError(`Invalid mode: ${mode}`))
				return
			}

			// Stop self-delegation loops before asking the user. Counted as a
			// mistake (without failing the turn, so attempt_completion stays
			// open), so a model that keeps retrying reaches the mistake limit.
			const refusal = await this.delegationRefusal(task, targetMode.slug, (id) => provider.getHistoryItem(id))
			if (refusal) {
				this.recordFailure(task, "new_task")
				pushToolResult(formatResponse.toolError(refusal))
				return
			}

			task.consecutiveMistakeCount = 0

			const toolMessage = JSON.stringify({
				tool: "newTask",
				mode: targetMode.name,
				content: message,
				todos: todoItems,
				// Stamp the native tool-call id so the finalized-duplicate dedup
				// links this complete card to its streaming placeholder, whose
				// payload differs (mode slug vs name, raw vs parsed todos).
				toolCallId,
			})

			const didApprove = await askApproval("tool", toolMessage)

			if (!didApprove) {
				return
			}

			// Delegate parent and open child as sole active task
			const child = await provider.delegateParentAndOpenChild({
				parentTaskId: task.taskId,
				message: unescapedMessage,
				initialTodos: todoItems,
				mode,
			})

			// Reflect delegation in tool result (no pause/unpause, no wait)
			pushToolResult(`Delegated to child task ${child.taskId}`)
			return
		} catch (error) {
			await handleError("creating new task", error, this.name)
			return
		}
	}

	/**
	 * Why this task may not delegate to `targetMode`, or undefined when it may.
	 *
	 * 1. A subtask may not delegate to its own mode. A mode is bound to one
	 *    provider profile (modeApiConfigs), so the child would run the same
	 *    model with the same tools and could do nothing the subtask cannot;
	 *    this is how an ask -> ask -> ask chain of ~90 subtasks formed. The
	 *    task the user started may still do it, to get a fresh context.
	 * 2. The child may not be deeper than MAX_DELEGATION_DEPTH.
	 */
	private async delegationRefusal(
		task: Task,
		targetMode: string,
		getHistoryItem: (taskId: string) => Promise<{ parentTaskId?: string }>,
	): Promise<string | undefined> {
		if (!task.parentTaskId) {
			return undefined
		}

		const doInstead =
			"Do the work yourself in this task. If it cannot be done here, finish with attempt_completion " +
			"and explain what could not be done and why, so the parent task can decide what to do next."

		if ((await task.getTaskMode()) === targetMode) {
			return (
				`new_task refused: this task is already a subtask in "${targetMode}" mode, and a new ` +
				`"${targetMode}" subtask would run the same model with the same tools, so it could not do ` +
				`anything this task cannot. ${doInstead}`
			)
		}

		// Walk the parent chain through the task history (parentTaskId, not
		// rootTaskId). The walk stops at the limit, so a broken chain that
		// points back at itself cannot loop forever.
		let depth = 0
		let parentTaskId: string | undefined = task.parentTaskId
		while (parentTaskId && depth < MAX_DELEGATION_DEPTH) {
			depth++
			try {
				parentTaskId = (await getHistoryItem(parentTaskId)).parentTaskId
			} catch {
				// The parent is gone from the history: count what is known.
				break
			}
		}

		if (depth >= MAX_DELEGATION_DEPTH) {
			return (
				`new_task refused: this task is already ${depth} levels of subtasks below the task the user ` +
				`started, which is the limit (${MAX_DELEGATION_DEPTH}). ${doInstead}`
			)
		}

		return undefined
	}

	override async handlePartial(task: Task, block: ToolUse<"new_task">): Promise<void> {
		const mode: string | undefined = block.params.mode
		const message: string | undefined = block.params.message
		const todos: string | undefined = block.params.todos

		const partialMessage = JSON.stringify({
			tool: "newTask",
			mode: mode ?? "",
			content: message ?? "",
			todos: todos,
			// Stamp the native tool-call id so this placeholder links to the
			// later complete card under the finalized-duplicate dedup.
			toolCallId: block.id,
		})

		await task.ask("tool", partialMessage, block.partial).catch(ignorePartialAskRejection)
	}
}

export const newTaskTool = new NewTaskTool()
