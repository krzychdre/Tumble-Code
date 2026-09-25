import type { RooCliInputCommand } from "@roo-code/types"

import { handleCancelCommand } from "./handlers/cancel.js"
import { handleMessageCommand } from "./handlers/message.js"
import { handlePingCommand } from "./handlers/ping.js"
import { handleShutdownCommand } from "./handlers/shutdown.js"
import { handleStartCommand } from "./handlers/start.js"
import type { StdinStreamSession } from "./session.js"

/** Hand one parsed stdin command to its handler. */
export async function routeStdinStreamCommand(session: StdinStreamSession, command: RooCliInputCommand): Promise<void> {
	switch (command.command) {
		case "start":
			return handleStartCommand(session, command)
		case "message":
			return handleMessageCommand(session, command)
		case "cancel":
			return handleCancelCommand(session, command)
		case "ping":
			return handlePingCommand(session, command)
		case "shutdown":
			return handleShutdownCommand(session, command)
	}
}
