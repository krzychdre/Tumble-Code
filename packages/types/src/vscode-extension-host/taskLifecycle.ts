/*
 * Extension host channel, taskLifecycle domain: the webview requests handled by
 * src/core/webview/messageHandlers/taskLifecycle.ts and the host to view
 * messages of the same domain.
 */

import type { QueuedMessage } from "../message.js"

/** Task lifecycle requests: launch, start, answer, cancel, history, todo list and message queue. */
export type TaskLifecycleWebviewMessageType =
	| "webviewDidLaunch"
	| "resyncClineMessages"
	| "newTask"
	| "askResponse"
	| "terminalOperation"
	| "clearTask"
	| "didShowAnnouncement"
	| "exportCurrentTask"
	| "showTaskWithId"
	| "condenseTaskContextRequest"
	| "deleteTaskWithId"
	| "deleteMultipleTasksWithIds"
	| "exportTaskWithId"
	| "getTaskWithAggregatedCosts"
	| "cancelTask"
	| "cancelAutoApproval"
	| "updateTodoList"
	| "queueMessage"
	| "removeQueuedMessage"
	| "editQueuedMessage"

/** State and transcript pushes, task history, navigation actions and chat input commands. */
export type TaskLifecycleExtensionMessageType =
	| "state"
	| "taskHistoryUpdated"
	| "taskHistoryItemUpdated"
	| "taskHistoryItemDeleted"
	| "messageUpdated"
	| "messageAdded"
	| "memoryActivity"
	| "condenseTaskContextStarted"
	| "condenseTaskContextResponse"
	| "interactionRequired"
	| "taskWithAggregatedCosts"
	| "commandExecutionStatus"
	| "action"
	| "invoke"
	| "acceptInput"
	| "insertTextIntoTextarea"
	| "theme"
	| "workspaceUpdated"

export type ClineAskResponse = "yesButtonClicked" | "noButtonClicked" | "messageResponse" | "objectResponse"

export interface UpdateTodoListPayload {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	todos: any[]
}

export type EditQueuedMessagePayload = Pick<QueuedMessage, "id" | "text" | "images">
