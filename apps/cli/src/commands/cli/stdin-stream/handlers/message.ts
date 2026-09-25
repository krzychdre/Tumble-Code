import { isTextResponseAsk, resumableAsks, type RooCliMessageCommand } from "@roo-code/types"

import type { ExtensionHost } from "@/agent/index.js"

import type { StdinStreamSession } from "../session.js"

// After a cancel the task is reloaded and waits on resume_task, or on
// resume_completed_task when it had finished. isResumableAsk counts only the
// first (the second is an idle ask), but both mean the reload is done.
const RESUME_ASKS: ReadonlySet<string> = new Set([...resumableAsks, "resume_completed_task"])
const CANCEL_RECOVERY_WAIT_TIMEOUT_MS = 8_000
const CANCEL_RECOVERY_POLL_INTERVAL_MS = 100

/** Match webview behavior: a message answers the pending ask when the chat box would send it as the answer. */
export function shouldSendMessageAsAskResponse(waitingForInput: boolean, currentAsk: string | undefined): boolean {
	return waitingForInput && typeof currentAsk === "string" && isTextResponseAsk(currentAsk)
}

function isResumableState(host: ExtensionHost): boolean {
	const agentState = host.client.getAgentState()
	return (
		agentState.isWaitingForInput &&
		typeof agentState.currentAsk === "string" &&
		RESUME_ASKS.has(agentState.currentAsk)
	)
}

async function waitForPostCancelRecovery(host: ExtensionHost): Promise<void> {
	const deadline = Date.now() + CANCEL_RECOVERY_WAIT_TIMEOUT_MS

	while (Date.now() < deadline) {
		if (isResumableState(host)) {
			return
		}

		await new Promise((resolve) => setTimeout(resolve, CANCEL_RECOVERY_POLL_INTERVAL_MS))
	}
}

export async function handleMessageCommand(session: StdinStreamSession, command: RooCliMessageCommand): Promise<void> {
	const { host } = session

	// If cancel was requested, wait briefly for the task to be rehydrated
	// so message prompts don't race into the pre-cancel task instance.
	if (session.awaitingPostCancelRecovery) {
		await waitForPostCancelRecovery(host)
	}

	const wasResumable = isResumableState(host)
	const currentAsk = host.client.getCurrentAsk()
	const shouldSendAsAskResponse = shouldSendMessageAsAskResponse(host.isWaitingForInput(), currentAsk)

	if (!host.client.hasActiveTask()) {
		session.emitControl({
			subtype: "error",
			requestId: command.requestId,
			command: "message",
			content: "no active task; send a start command first",
			code: "no_active_task",
			success: false,
		})
		return
	}

	session.emitControl({
		subtype: "ack",
		requestId: command.requestId,
		command: "message",
		content: "message accepted",
		code: "accepted",
		success: true,
	})

	if (shouldSendAsAskResponse) {
		// Match webview behavior: if there is an active ask, route message directly as an ask response.
		host.sendToExtension({
			type: "askResponse",
			askResponse: "messageResponse",
			text: command.prompt,
			images: command.images,
		})

		session.setStreamRequestId(command.requestId)
		session.emitControl({
			subtype: "done",
			requestId: command.requestId,
			command: "message",
			content: "message sent to current ask",
			code: "responded",
			success: true,
		})
		session.awaitingPostCancelRecovery = false
		return
	}

	host.sendToExtension({
		type: "queueMessage",
		text: command.prompt,
		images: command.images,
	})
	session.queue.addPendingRequestId(command.requestId)
	if (host.isWaitingForInput()) {
		session.setStreamRequestId(command.requestId)
	}

	session.emitControl({
		subtype: "done",
		requestId: command.requestId,
		command: "message",
		content: wasResumable ? "resume message queued" : "message queued",
		code: wasResumable ? "resumed" : "queued",
		success: true,
	})

	session.awaitingPostCancelRecovery = false
}
