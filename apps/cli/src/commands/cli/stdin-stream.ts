import { waitForStartedTaskAfterStdinClosed, waitForTaskProgressAfterStdinClosed } from "./stdin-stream/eof.js"
import { readCommandsFromStdinNdjson } from "./stdin-stream/parse.js"
import { routeStdinStreamCommand } from "./stdin-stream/router.js"
import { attachSessionListeners } from "./stdin-stream/session-events.js"
import { StdinStreamSession, type StdinStreamModeOptions } from "./stdin-stream/session.js"

export {
	parseStdinStreamCommand,
	VALID_STDIN_COMMANDS,
	type StdinStreamCommand,
	type StdinStreamCommandName,
} from "./stdin-stream/parse.js"
export { shouldSendMessageAsAskResponse } from "./stdin-stream/handlers/message.js"
export type { StdinStreamModeOptions } from "./stdin-stream/session.js"

/**
 * Read NDJSON commands from stdin and route each to its handler until stdin
 * closes or a shutdown command arrives, then wait for the active task.
 */
export async function runStdinStreamMode(options: StdinStreamModeOptions) {
	const session = new StdinStreamSession(options)
	const { host } = session
	const detachListeners = attachSessionListeners(session)
	let hasReceivedStdinCommand = false

	try {
		for await (const stdinCommand of readCommandsFromStdinNdjson()) {
			hasReceivedStdinCommand = true

			if (session.fatalStreamError) {
				throw session.fatalStreamError
			}

			await routeStdinStreamCommand(session, stdinCommand)

			if (session.shouldShutdown) {
				break
			}
		}

		if (!hasReceivedStdinCommand) {
			throw new Error("no stdin command provided")
		}

		if (session.shouldShutdown && host.client.hasActiveTask()) {
			host.client.cancelTask()
		}

		if (!session.shouldShutdown) {
			if (session.activeTaskPromise) {
				await waitForStartedTaskAfterStdinClosed(host, session.activeTaskPromise)
			} else if (host.client.hasActiveTask()) {
				await waitForTaskProgressAfterStdinClosed(host, () => session.queue.getEofState())
			}

			// A task or client failure already went out as a control error
			// event; end non-zero like a print mode run does, instead of
			// exiting 0 because stdin closed before the next command.
			if (session.fatalStreamError) {
				throw session.fatalStreamError
			}
		}
	} finally {
		detachListeners()
	}
}
