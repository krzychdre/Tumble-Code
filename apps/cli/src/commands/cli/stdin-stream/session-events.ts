import { isRecord } from "@/lib/utils/guards.js"

import { isExpectedControlFlowError } from "../cancellation.js"
import { parseQueueSnapshot } from "./queue-tracker.js"
import type { StdinStreamSession } from "./session.js"

interface ExtensionWebviewMessage {
	type?: string
	text?: unknown
	state?: {
		currentTaskId?: unknown
		currentTaskItem?: { id?: unknown }
		messageQueue?: unknown
	}
}

function handleClientError(session: StdinStreamSession, error: Error): void {
	if (
		isExpectedControlFlowError(error, {
			stdinStreamMode: true,
			cancelRequested: session.cancelRequestedForActiveTask,
			shuttingDown: session.shouldShutdown,
			operation: "client",
		})
	) {
		session.endActiveTaskAfterControlFlowError(error, session.activeRequestId)
		return
	}

	session.fatalStreamError = error
	session.emitControl({
		subtype: "error",
		requestId: session.activeRequestId,
		command: session.activeTaskCommand,
		content: error.message,
		code: "client_error",
		success: false,
	})
}

function handleCommandExecutionStatus(session: StdinStreamSession, text: unknown): void {
	if (typeof text !== "string") {
		return
	}

	let parsedStatus: unknown
	try {
		parsedStatus = JSON.parse(text)
	} catch {
		return
	}

	if (!isRecord(parsedStatus) || typeof parsedStatus.status !== "string") {
		return
	}

	const { jsonEmitter } = session

	if (parsedStatus.status === "output" && typeof parsedStatus.output === "string") {
		jsonEmitter.emitCommandOutputChunk(parsedStatus.output)
		return
	}

	if (parsedStatus.status === "exited") {
		const exitCode = typeof parsedStatus.exitCode === "number" ? parsedStatus.exitCode : undefined

		if (typeof parsedStatus.output === "string") {
			jsonEmitter.emitCommandOutputChunk(parsedStatus.output)
		}

		jsonEmitter.markCommandOutputExited(exitCode)
		return
	}

	if (parsedStatus.status === "timeout" || parsedStatus.status === "fallback") {
		jsonEmitter.emitCommandOutputDone(undefined)
	}
}

function handleExtensionMessage(session: StdinStreamSession, message: ExtensionWebviewMessage): void {
	if (message.type === "commandExecutionStatus") {
		handleCommandExecutionStatus(session, message.text)
		return
	}

	if (message.type !== "state") {
		return
	}

	const currentTaskId = message.state?.currentTaskId ?? message.state?.currentTaskItem?.id
	if (typeof currentTaskId === "string" && currentTaskId.trim().length > 0) {
		session.latestTaskId = currentTaskId
	}

	const queueSnapshot = parseQueueSnapshot(message.state?.messageQueue)
	if (!queueSnapshot) {
		return
	}

	session.queue.handleSnapshot(queueSnapshot, session.latestTaskId)
}

function handleTaskCompleted(session: StdinStreamSession, success: boolean): void {
	if (session.activeTaskCommand !== "start") {
		return
	}

	const cancelled = session.cancelRequestedForActiveTask

	session.emitControl({
		subtype: "done",
		requestId: session.activeRequestId,
		command: "start",
		content: success ? "task completed" : cancelled ? "task cancelled" : "task failed",
		code: success ? "task_completed" : cancelled ? "task_aborted" : "task_failed",
		success,
	})

	// If user messages were queued while the task was still running, shift
	// event attribution to the oldest pending message request as soon as the
	// task turn completes so prompt echo/user feedback events are tagged.
	const nextQueuedRequestId = session.queue.nextQueuedRequestId()
	if (nextQueuedRequestId) {
		session.setStreamRequestId(nextQueuedRequestId)
	}

	session.activeTaskCommand = undefined
	session.activeRequestId = undefined
	session.cancelRequestedForActiveTask = false
}

/**
 * Listen to the host for client errors, command output, state (task id and
 * queue) and task completion. Returns the function that stops listening.
 */
export function attachSessionListeners(session: StdinStreamSession): () => void {
	const { host } = session

	const offClientError = host.client.on("error", (error) => handleClientError(session, error))
	const onExtensionMessage = (message: ExtensionWebviewMessage) => handleExtensionMessage(session, message)
	host.on("extensionWebviewMessage", onExtensionMessage)
	const offTaskCompleted = host.client.on("taskCompleted", (event) => handleTaskCompleted(session, event.success))

	return () => {
		offClientError()
		host.off("extensionWebviewMessage", onExtensionMessage)
		offTaskCompleted()
	}
}
