import { randomUUID } from "crypto"

import type { RooCliStartCommand } from "@roo-code/types"

import { isExpectedControlFlowError } from "../../cancellation.js"
import type { StdinStreamSession } from "../session.js"

async function waitForPreviousTaskToSettle(session: StdinStreamSession): Promise<void> {
	if (!session.activeTaskPromise) {
		return
	}

	try {
		await session.activeTaskPromise
	} catch {
		// Errors are emitted through control/error events.
	}
}

export async function handleStartCommand(session: StdinStreamSession, command: RooCliStartCommand): Promise<void> {
	const { host } = session

	// A task can emit completion events before runTask() finalizers run.
	// Wait for full settlement to avoid false "task_busy" on immediate next start.
	// Safe from races: `for await` processes stdin commands serially, so no
	// concurrent command can mutate state between the check and the await.
	if (session.activeTaskPromise && !host.client.hasActiveTask()) {
		await waitForPreviousTaskToSettle(session)
	}

	if (session.activeTaskPromise || host.client.hasActiveTask()) {
		session.emitControl({
			subtype: "error",
			requestId: command.requestId,
			command: "start",
			content: "cannot start a new task while another task is active",
			code: "task_busy",
			success: false,
		})
		return
	}

	session.activeRequestId = command.requestId
	session.activeTaskCommand = "start"
	session.setStreamRequestId(command.requestId)
	session.latestTaskId = command.taskId ?? randomUUID()
	session.cancelRequestedForActiveTask = false
	session.awaitingPostCancelRecovery = false

	session.emitControl({
		subtype: "ack",
		requestId: command.requestId,
		command: "start",
		content: "starting task",
		code: "accepted",
		success: true,
	})

	// In CLI stdin-stream mode, default to the execa terminal provider so
	// command output can be streamed deterministically. Explicit per-request
	// config still wins.
	const taskConfiguration = {
		terminalShellIntegrationDisabled: true,
		...(command.configuration ?? {}),
	}

	session.activeTaskPromise = host
		.runTask(command.prompt, session.latestTaskId, taskConfiguration, command.images)
		.catch((error) => {
			const message = error instanceof Error ? error.message : String(error)

			if (
				isExpectedControlFlowError(error, {
					stdinStreamMode: true,
					cancelRequested: session.cancelRequestedForActiveTask,
					shuttingDown: session.shouldShutdown,
					operation: "client",
				})
			) {
				session.endActiveTaskAfterControlFlowError(error, command.requestId)
				return
			}

			session.fatalStreamError = error instanceof Error ? error : new Error(message)
			session.activeTaskCommand = undefined
			session.activeRequestId = undefined
			session.setStreamRequestId(undefined)

			session.emitControl({
				subtype: "error",
				requestId: command.requestId,
				command: "start",
				content: message,
				code: "task_error",
				success: false,
			})
		})
		.finally(() => {
			session.activeTaskPromise = null
		})
}
