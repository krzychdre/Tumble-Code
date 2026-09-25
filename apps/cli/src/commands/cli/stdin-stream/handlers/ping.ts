import type { RooCliPingCommand } from "@roo-code/types"

import type { StdinStreamSession } from "../session.js"

export function handlePingCommand(session: StdinStreamSession, command: RooCliPingCommand): void {
	session.emitControl({
		subtype: "ack",
		requestId: command.requestId,
		command: "ping",
		content: "pong",
		code: "accepted",
		success: true,
	})
	session.emitControl({
		subtype: "done",
		requestId: command.requestId,
		command: "ping",
		content: "pong",
		code: "pong",
		success: true,
	})
}
