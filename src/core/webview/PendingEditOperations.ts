import { logger } from "../../utils/logging"

/**
 * A chat-message edit waiting for the user to confirm a checkpoint restore.
 * Written when the user confirms an edit with "restore checkpoint" (see
 * checkpointRestoreHandler) and consumed when the restored task is
 * rehydrated; each entry clears itself after
 * {@link PendingEditOperations.TIMEOUT_MS} so a confirm that never
 * completes cannot leak.
 */
export interface PendingEditOperation {
	messageTs: number
	editedContent: string
	images?: string[]
	messageIndex: number
	apiConversationHistoryIndex: number
	timeoutId: NodeJS.Timeout
	createdAt: number
}

/**
 * The pending-edit bookkeeping of the provider (R3-12 cluster 1; was inline
 * in ClineProvider). Keyed by operation ID (`task-<taskId>`), one entry per
 * task at most: a second confirm for the same task replaces the first.
 *
 * The provider keeps thin delegating members
 * (setPendingEditOperation/getPendingEditOperation/clearPendingEditOperation)
 * so external callers (checkpointRestoreHandler, tests) are unchanged.
 */
export class PendingEditOperations {
	private static readonly TIMEOUT_MS = 30000 // 30 seconds

	private readonly operations = new Map<string, PendingEditOperation>()

	/** Sets a pending edit operation with automatic timeout cleanup. */
	set(operationId: string, editData: Omit<PendingEditOperation, "timeoutId" | "createdAt">): void {
		// Clear any existing operation with the same ID
		this.clear(operationId)

		// Create timeout for automatic cleanup
		const timeoutId = setTimeout(() => {
			this.clear(operationId)
			logger.warn(`[setPendingEditOperation] Automatically cleared stale pending operation: ${operationId}`)
		}, PendingEditOperations.TIMEOUT_MS)

		// Store the operation
		this.operations.set(operationId, {
			...editData,
			timeoutId,
			createdAt: Date.now(),
		})

		logger.debug(`[setPendingEditOperation] Set pending operation: ${operationId}`)
	}

	/** Gets a pending edit operation by ID. */
	get(operationId: string): PendingEditOperation | undefined {
		return this.operations.get(operationId)
	}

	/** Clears a specific pending edit operation. */
	clear(operationId: string): boolean {
		const operation = this.operations.get(operationId)
		if (operation) {
			clearTimeout(operation.timeoutId)
			this.operations.delete(operationId)
			logger.debug(`[clearPendingEditOperation] Cleared pending operation: ${operationId}`)
			return true
		}
		return false
	}

	/** Clears all pending edit operations (dispose path). */
	clearAll(): void {
		for (const [, operation] of this.operations) {
			clearTimeout(operation.timeoutId)
		}
		this.operations.clear()
		logger.debug(`[clearAllPendingEditOperations] Cleared all pending operations`)
	}
}
