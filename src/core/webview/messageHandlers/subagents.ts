// Parallel subagent panel: live tail, cancel and mid-run guidance.

import type { MessageHandlerMap } from "./types"

export const subagentsHandlers: MessageHandlerMap = {
	subscribeSubagentMessages: async (ctx, message) => {
		const { provider } = ctx
		// Open a live tail on a parallel subagent: mark it watched (so
		// TaskHistory streams its subsequent messages) and send a snapshot
		// of everything said so far. A queued placeholder or an
		// already-disposed child yields an empty snapshot - the panel
		// falls back to the summary's finalMessage.
		const subagentTaskId = message.taskId
		if (subagentTaskId) {
			provider.subagentRegistry.watch(subagentTaskId)
			const subagentTask = provider.getBackgroundTask(subagentTaskId)
			await provider.postMessageToWebview({
				type: "subagentMessages",
				sourceTaskId: subagentTaskId,
				subagentMessages: subagentTask ? [...subagentTask.clineMessages] : [],
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
				subagentTask.abortTask().catch(() => {})
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
