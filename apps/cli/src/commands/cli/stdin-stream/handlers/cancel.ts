import type { RooCliCancelCommand } from "@roo-code/types"

import { isExpectedControlFlowError, isNoActiveTaskLikeError } from "../../cancellation.js"
import type { StdinStreamSession } from "../session.js"

export function handleCancelCommand(session: StdinStreamSession, command: RooCliCancelCommand): void {
	const { host } = session

	session.setStreamRequestId(command.requestId)

	const hasTaskInFlight = Boolean(
		session.activeTaskPromise || session.activeTaskCommand === "start" || host.client.hasActiveTask(),
	)

	if (!hasTaskInFlight) {
		session.emitControl({
			subtype: "ack",
			requestId: command.requestId,
			command: "cancel",
			content: "no active task to cancel",
			code: "accepted",
			success: true,
		})

		session.emitControl({
			subtype: "done",
			requestId: command.requestId,
			command: "cancel",
			content: "cancel ignored (no active task)",
			code: "no_active_task",
			success: true,
		})
		return
	}

	session.cancelRequestedForActiveTask = true
	session.awaitingPostCancelRecovery = true

	session.emitControl({
		subtype: "ack",
		requestId: command.requestId,
		command: "cancel",
		content: host.client.hasActiveTask() ? "cancel requested" : "cancel requested (task starting)",
		code: "accepted",
		success: true,
	})

	try {
		host.client.cancelTask()

		session.emitControl({
			subtype: "done",
			requestId: command.requestId,
			command: "cancel",
			content: "cancel signal sent",
			code: "cancel_requested",
			success: true,
		})
	} catch (error) {
		if (
			isExpectedControlFlowError(error, {
				stdinStreamMode: true,
				cancelRequested: true,
				shuttingDown: session.shouldShutdown,
				operation: "cancel",
			})
		) {
			const noActiveTask = isNoActiveTaskLikeError(error)

			session.emitControl({
				subtype: "done",
				requestId: command.requestId,
				command: "cancel",
				content: noActiveTask ? "cancel ignored (task already settled)" : "cancel handled",
				code: noActiveTask ? "no_active_task" : "cancel_requested",
				success: true,
			})

			if (noActiveTask) {
				session.awaitingPostCancelRecovery = false
			}

			session.cancelRequestedForActiveTask = false
		} else {
			const message = error instanceof Error ? error.message : String(error)
			session.emitControl({
				subtype: "error",
				requestId: command.requestId,
				command: "cancel",
				content: message,
				code: "cancel_error",
				success: false,
			})
		}
	}
}
