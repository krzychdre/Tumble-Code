// Parallel subagent panel: live tail, cancel and mid-run guidance.

import { logger } from "../../../utils/logging"
import { loadSubagentTranscript } from "../../task-persistence/subagentSummariesStore"

import type { DomainHandlerMap } from "./types"

export const subagentsHandlers: DomainHandlerMap<"subagents"> = {
	subscribeSubagentMessages: async (ctx, message) => {
		const { provider } = ctx
		// Open a live tail on a parallel subagent: mark it watched (so
		// TaskMessageLog streams its subsequent messages) and send a snapshot
		// of everything said so far. A finished child is no longer live: its
		// messages come from the transcript `run_parallel_tasks` kept under
		// the parent. A queued placeholder, or a child from a fan-out older
		// than the transcripts, yields an empty snapshot and the panel falls
		// back to the summary's finalMessage.
		const subagentTaskId = message.taskId
		if (subagentTaskId) {
			provider.subagentRegistry.watch(subagentTaskId)
			const subagentTask = provider.getBackgroundTask(subagentTaskId)
			let subagentMessages = subagentTask ? [...subagentTask.clineMessages] : []
			const parentTaskId = subagentTask ? undefined : provider.subagentRegistry.get(subagentTaskId)?.parentTaskId
			if (parentTaskId) {
				subagentMessages = await loadSubagentTranscript(
					provider.globalStoragePath,
					parentTaskId,
					subagentTaskId,
				)
			}
			await provider.postMessageToWebview({
				type: "subagentMessages",
				sourceTaskId: subagentTaskId,
				subagentMessages,
			})
		}
	},

	unsubscribeSubagentMessages: (ctx, message) => {
		const { provider } = ctx
		if (message.taskId) {
			provider.subagentRegistry.unwatch(message.taskId)
		}
	},

	cancelSubagent: (ctx, message) => {
		const { provider } = ctx
		{
			const subagentTask = message.taskId ? provider.getBackgroundTask(message.taskId) : undefined
			if (subagentTask) {
				// Mark cancelled BEFORE aborting: first-terminal-wins in the
				// registry keeps the row "cancelled" when the TaskAborted
				// listener races in with its generic "failed".
				provider.subagentRegistry.markTerminal(subagentTask.taskId, "cancelled")
				subagentTask
					.abortTask()
					.catch((error) => logger.debug(`[subagents] cancel: abortTask failed: ${String(error)}`))
			}
		}
	},

	queueSubagentMessage: (ctx, message) => {
		const { provider } = ctx
		{
			// Mid-run guidance for a subagent: enqueue into the child's own
			// message queue - TaskAskSay drains it at the next ask boundary
			// (an already-pending followup consumes it immediately).
			const subagentTask = message.taskId ? provider.getBackgroundTask(message.taskId) : undefined
			if (subagentTask && message.text) {
				subagentTask.messageQueueService.addMessage(message.text)
			}
		}
	},
}
