// Parallel subagent panel: live tail, cancel and mid-run guidance.

import * as path from "path"

import type { ClineMessage } from "@tumble-code/types"

import { GlobalFileNames } from "../../../shared/globalFileNames"
import { fileExistsAtPath } from "../../../utils/fs"
import { logger } from "../../../utils/logging"
import { getStorageBasePath } from "../../../utils/storage"
import { readTaskMessages } from "../../task-persistence"
import { isSafeSubagentTaskId, loadSubagentTranscript } from "../../task-persistence/subagentSummariesStore"

import type { HandlerContext } from "./context"
import type { DomainHandlerMap } from "./types"

/**
 * A finished subagent's messages: its own task directory first (kept since
 * subagents write a history item), else the copy older runs kept under the
 * parent (`tasks/<parent>/subagents/<child>.json`). Existence is checked
 * without `getTaskDirectoryPath`, whose mkdir would leave an empty task
 * directory behind for every old run the user expands.
 */
async function loadFinishedSubagentMessages(ctx: HandlerContext, subagentTaskId: string): Promise<ClineMessage[]> {
	const { provider } = ctx
	const basePath = await getStorageBasePath(provider.globalStoragePath)
	if (await fileExistsAtPath(path.join(basePath, "tasks", subagentTaskId, GlobalFileNames.uiMessages))) {
		return readTaskMessages({ taskId: subagentTaskId, globalStoragePath: provider.globalStoragePath })
	}
	const parentTaskId = provider.subagentRegistry.get(subagentTaskId)?.parentTaskId
	return parentTaskId ? loadSubagentTranscript(provider.globalStoragePath, parentTaskId, subagentTaskId) : []
}

export const subagentsHandlers: DomainHandlerMap<"subagents"> = {
	subscribeSubagentMessages: async (ctx, message) => {
		const { provider } = ctx
		// Open a live tail on a parallel subagent: mark it watched (so
		// TaskMessageLog streams its subsequent messages) and send a snapshot
		// of everything said so far. A finished child is no longer live: its
		// messages are read from storage. A queued placeholder, or a child
		// from a fan-out older than the transcripts, yields an empty snapshot
		// and the panel falls back to the summary's finalMessage.
		const subagentTaskId = message.taskId
		if (subagentTaskId) {
			// The id comes from the webview and names a directory: a value
			// with a path separator or ".." must not read outside "tasks".
			if (!isSafeSubagentTaskId(subagentTaskId)) {
				logger.debug(`[subagents] subscribe: rejected task id "${subagentTaskId}"`)
				return
			}
			provider.subagentRegistry.watch(subagentTaskId)
			const subagentTask = provider.getBackgroundTask(subagentTaskId)
			const subagentMessages = subagentTask
				? [...subagentTask.clineMessages]
				: await loadFinishedSubagentMessages(ctx, subagentTaskId)
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
