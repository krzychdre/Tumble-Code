import type { RooCliShutdownCommand } from "@roo-code/types"

import type { StdinStreamSession } from "../session.js"

/** Acknowledge the shutdown; the stdin loop stops reading once it is set. */
export function handleShutdownCommand(session: StdinStreamSession, command: RooCliShutdownCommand): void {
	session.emitControl({
		subtype: "ack",
		requestId: command.requestId,
		command: "shutdown",
		content: "shutdown requested",
		code: "accepted",
		success: true,
	})
	session.emitControl({
		subtype: "done",
		requestId: command.requestId,
		command: "shutdown",
		content: "shutting down process",
		code: "shutdown_requested",
		success: true,
	})
	session.shouldShutdown = true
}
