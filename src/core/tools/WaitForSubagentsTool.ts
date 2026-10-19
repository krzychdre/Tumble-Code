import { TumbleCodeEventName } from "@tumble-code/types"

import type { Task } from "../task/Task"
import type { BackgroundSubagents } from "../webview/BackgroundSubagents"
import { formatResponse } from "../prompts/responses"
import type { ToolResponse } from "../../shared/tools"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { formatSubagentUpdate, formatUserMessageWhileWaiting, NOTHING_TO_WAIT_FOR } from "./helpers/subagentResults"

/** What the wait reads from the parent task. */
export type WaitingTask = Pick<Task, "taskId" | "abort" | "messageQueueService" | "say" | "on" | "off">

/** Resolves on the next change that can end a wait: a subagent ended, a user message, an abort. */
function nextChange(task: WaitingTask, subagents: BackgroundSubagents): Promise<void> {
	return new Promise((resolve) => {
		const wake = () => {
			unsubscribe()
			task.messageQueueService.off("stateChanged", wake)
			task.off(TumbleCodeEventName.TaskAborted, wake)
			resolve()
		}
		const unsubscribe = subagents.subscribe(task.taskId, wake)
		task.messageQueueService.on("stateChanged", wake)
		task.on(TumbleCodeEventName.TaskAborted, wake)
	})
}

/**
 * Wait until something the parent model must react to happens, and return
 * it as a tool result. Shared by wait_for_subagents and run_parallel_tasks
 * (which waits the same way right after starting its subagents).
 *
 * Returns when:
 * - the user sent a message (queued while the task runs): it is shown in the
 *   chat as the user's message and returned, the subagents keep running;
 * - one or more subagents finished: every unread result, plus the list of
 *   the subagents still running and the next step;
 * - nothing runs and nothing is unread;
 * - the task was stopped.
 */
export async function waitForSubagents(task: WaitingTask, subagents: BackgroundSubagents): Promise<ToolResponse> {
	for (;;) {
		if (task.abort) {
			return "wait_for_subagents stopped: this task was stopped."
		}
		const running = subagents.running(task.taskId)
		const unreadCount = subagents.unreadCount(task.taskId)
		if (running.length === 0 && unreadCount === 0) {
			return NOTHING_TO_WAIT_FOR
		}
		// The user comes first: they wait for an answer, the results keep.
		const message = task.messageQueueService.isEmpty() ? undefined : task.messageQueueService.dequeueMessage()
		if (message) {
			await task.say("user_feedback", message.text, message.images)
			return formatResponse.toolResult(
				formatUserMessageWhileWaiting(message.text, running.length, unreadCount),
				message.images,
			)
		}
		const finished = subagents.takeUnread(task.taskId)
		if (finished.length > 0) {
			return formatSubagentUpdate(finished, subagents.running(task.taskId))
		}
		await nextChange(task, subagents)
	}
}

export class WaitForSubagentsTool extends BaseTool<"wait_for_subagents"> {
	readonly name = "wait_for_subagents" as const

	async execute(_params: Record<string, never>, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { handleError, pushToolResult } = callbacks
		try {
			// A subagent never starts subagents of its own, so it has nothing
			// to wait for. The tool is stripped from its tool list; this guards
			// a hallucinated call.
			if (task.isBackground) {
				this.recordFailure(task, "wait_for_subagents")
				pushToolResult(
					formatResponse.toolError(
						"wait_for_subagents is not available inside a parallel subtask. Do the work directly " +
							"in this task and finish with attempt_completion.",
					),
				)
				return
			}
			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}
			const subagents = provider.backgroundSubagents
			if (!subagents.hasWork(task.taskId)) {
				// Not an error, but a model that keeps calling it is stuck:
				// counting it lets the mistake limit stop the loop.
				this.recordFailure(task, "wait_for_subagents")
				pushToolResult(NOTHING_TO_WAIT_FOR)
				return
			}
			task.consecutiveMistakeCount = 0
			await task.say("tool", JSON.stringify({ tool: "waitForSubagents" }))
			pushToolResult(await waitForSubagents(task, subagents))
		} catch (error) {
			await handleError("waiting for subagents", error as Error, this.name)
		}
	}
}

export const waitForSubagentsTool = new WaitForSubagentsTool()
