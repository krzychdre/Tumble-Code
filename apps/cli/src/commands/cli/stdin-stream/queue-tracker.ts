import { isRecord } from "@/lib/utils/guards.js"

import type { JsonEventEmitter } from "@/agent/json-event-emitter.js"

// ---------------------------------------------------------------------------
// Queue snapshot helpers
// ---------------------------------------------------------------------------

interface StreamQueueItem {
	id: string
	text?: string
	imageCount: number
	timestamp?: number
}

function normalizeQueueText(text: string | undefined): string | undefined {
	if (!text) {
		return undefined
	}

	const compact = text.replace(/\s+/g, " ").trim()
	if (!compact) {
		return undefined
	}

	return compact.length <= 180 ? compact : `${compact.slice(0, 177)}...`
}

export function parseQueueSnapshot(rawQueue: unknown): StreamQueueItem[] | undefined {
	if (!Array.isArray(rawQueue)) {
		return undefined
	}

	const snapshot: StreamQueueItem[] = []

	for (const entry of rawQueue) {
		if (!isRecord(entry)) {
			continue
		}

		const idRaw = entry.id
		if (typeof idRaw !== "string" || idRaw.trim().length === 0) {
			continue
		}

		const imagesRaw = entry.images
		const timestampRaw = entry.timestamp
		const imageCount = Array.isArray(imagesRaw) ? imagesRaw.length : 0

		snapshot.push({
			id: idRaw,
			text: normalizeQueueText(typeof entry.text === "string" ? entry.text : undefined),
			imageCount,
			timestamp: typeof timestampRaw === "number" ? timestampRaw : undefined,
		})
	}

	return snapshot
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) {
		return false
	}

	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return false
		}
	}

	return true
}

// ---------------------------------------------------------------------------
// Queue tracker
// ---------------------------------------------------------------------------

/**
 * Follows the extension's message queue through state messages: emits queue
 * events and ties each queued message to the request id of the "message"
 * command that queued it, so later output is attributed to that request.
 */
export class QueueTracker {
	private hasSeenQueueState = false
	private lastQueueDepth = 0
	private lastQueueMessageIds: string[] = []
	private readonly pendingQueuedMessageRequestIds: string[] = []
	private readonly queueMessageRequestIdByMessageId = new Map<string, string>()

	constructor(
		private readonly jsonEmitter: JsonEventEmitter,
		private readonly setStreamRequestId: (id: string | undefined) => void,
	) {}

	/** Remember the request id of a message sent to the extension's queue. */
	addPendingRequestId(requestId: string): void {
		this.pendingQueuedMessageRequestIds.push(requestId)
	}

	/** The request id of the oldest message still waiting in the queue. */
	nextQueuedRequestId(): string | undefined {
		const oldestQueuedMessageId = this.lastQueueMessageIds[0]
		return (
			this.pendingQueuedMessageRequestIds[0] ??
			(oldestQueuedMessageId ? this.queueMessageRequestIdByMessageId.get(oldestQueuedMessageId) : undefined)
		)
	}

	getEofState(): { hasSeenQueueState: boolean; queueDepth: number } {
		return { hasSeenQueueState: this.hasSeenQueueState, queueDepth: this.lastQueueDepth }
	}

	handleSnapshot(queueSnapshot: StreamQueueItem[], taskId: string | undefined): void {
		const queueDepth = queueSnapshot.length
		const queueMessageIds = queueSnapshot.map((item) => item.id)

		if (!this.hasSeenQueueState) {
			this.assignRequestIdsToNewQueueMessages(queueMessageIds)
			this.hasSeenQueueState = true
			this.lastQueueDepth = queueDepth
			this.lastQueueMessageIds = queueMessageIds

			if (queueDepth === 0) {
				return
			}

			this.jsonEmitter.emitQueue({
				subtype: "snapshot",
				taskId,
				content: `queue snapshot (${queueDepth} item${queueDepth === 1 ? "" : "s"})`,
				queueDepth,
				queue: queueSnapshot,
			})
			return
		}

		const depthChanged = queueDepth !== this.lastQueueDepth
		const idsChanged = !areStringArraysEqual(queueMessageIds, this.lastQueueMessageIds)

		if (!depthChanged && !idsChanged) {
			return
		}

		this.promoteRequestIdForDequeuedMessages(queueMessageIds)
		this.assignRequestIdsToNewQueueMessages(queueMessageIds)

		const subtype: "enqueued" | "dequeued" | "drained" | "updated" = depthChanged
			? queueDepth > this.lastQueueDepth
				? "enqueued"
				: queueDepth === 0
					? "drained"
					: "dequeued"
			: "updated"

		const content =
			subtype === "drained"
				? "queue drained"
				: `queue ${subtype} (${queueDepth} item${queueDepth === 1 ? "" : "s"})`

		this.jsonEmitter.emitQueue({
			subtype,
			taskId,
			content,
			queueDepth,
			queue: queueSnapshot,
		})

		this.lastQueueDepth = queueDepth
		this.lastQueueMessageIds = queueMessageIds
	}

	private assignRequestIdsToNewQueueMessages(queueMessageIds: string[]): void {
		for (const messageId of queueMessageIds) {
			if (this.queueMessageRequestIdByMessageId.has(messageId)) {
				continue
			}

			const requestId = this.pendingQueuedMessageRequestIds.shift()
			if (!requestId) {
				continue
			}

			this.queueMessageRequestIdByMessageId.set(messageId, requestId)
		}
	}

	private promoteRequestIdForDequeuedMessages(queueMessageIds: string[]): void {
		if (this.lastQueueMessageIds.length === 0) {
			return
		}

		const remainingIds = new Set(queueMessageIds)

		for (const dequeuedMessageId of this.lastQueueMessageIds) {
			if (remainingIds.has(dequeuedMessageId)) {
				continue
			}

			const requestId = this.queueMessageRequestIdByMessageId.get(dequeuedMessageId)
			if (requestId) {
				this.setStreamRequestId(requestId)
			}
			this.queueMessageRequestIdByMessageId.delete(dequeuedMessageId)
		}
	}
}
