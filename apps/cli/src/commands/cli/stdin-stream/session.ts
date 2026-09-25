import { isCancellationLikeError } from "../cancellation.js"
import { QueueTracker } from "./queue-tracker.js"

import type { ExtensionHost } from "@/agent/index.js"
import type { JsonEventEmitter } from "@/agent/json-event-emitter.js"

export interface StdinStreamModeOptions {
	host: ExtensionHost
	jsonEmitter: JsonEventEmitter
	setStreamRequestId: (id: string | undefined) => void
}

type ControlEvent = Parameters<JsonEventEmitter["emitControl"]>[0]

/**
 * The state one stdin stream shares between its command handlers, the
 * listeners on the extension host and the end-of-stdin wait.
 */
export class StdinStreamSession {
	readonly host: ExtensionHost
	readonly jsonEmitter: JsonEventEmitter
	readonly setStreamRequestId: (id: string | undefined) => void
	readonly queue: QueueTracker

	shouldShutdown = false
	activeTaskPromise: Promise<void> | null = null
	fatalStreamError: Error | null = null
	activeRequestId: string | undefined
	activeTaskCommand: "start" | undefined
	latestTaskId: string | undefined
	cancelRequestedForActiveTask = false
	awaitingPostCancelRecovery = false

	constructor({ host, jsonEmitter, setStreamRequestId }: StdinStreamModeOptions) {
		this.host = host
		this.jsonEmitter = jsonEmitter
		this.setStreamRequestId = setStreamRequestId
		this.queue = new QueueTracker(jsonEmitter, setStreamRequestId)
	}

	/** Emit a control event about the latest task. */
	emitControl(event: Omit<ControlEvent, "taskId">): void {
		this.jsonEmitter.emitControl({ ...event, taskId: this.latestTaskId })
	}

	/**
	 * The started task ended through an expected control flow error (a cancel,
	 * an abort, a task that was already gone): report a cancelled start and
	 * forget the active task.
	 */
	endActiveTaskAfterControlFlowError(error: unknown, requestId: string | undefined): void {
		if (
			this.activeTaskCommand === "start" &&
			(this.cancelRequestedForActiveTask || isCancellationLikeError(error))
		) {
			this.emitControl({
				subtype: "done",
				requestId,
				command: "start",
				content: "task cancelled",
				code: "task_aborted",
				success: false,
			})
		}

		this.activeTaskCommand = undefined
		this.activeRequestId = undefined
		this.setStreamRequestId(undefined)
		this.cancelRequestedForActiveTask = false
		this.awaitingPostCancelRecovery = false
	}
}
