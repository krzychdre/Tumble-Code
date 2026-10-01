import debounce from "lodash.debounce"
import EventEmitter from "events"

import { type ClineMessage, type TokenUsage, type ToolUsage, type ToolName, RooCodeEventName } from "@roo-code/types"

import { getApiMetrics, hasTokenUsageChanged, hasToolUsageChanged } from "../../shared/getApiMetrics"
import { combineApiRequests } from "../../shared/combineApiRequests"
import { combineCommandSequences } from "../../shared/combineCommandSequences"

/**
 * Interface for Task access needed by TaskTokenTracking.
 * This is a narrow interface to minimize coupling between modules.
 */
export interface TaskTokenTrackingAccess {
	// Core identifiers
	taskId: string

	// Mutable state arrays
	clineMessages: ClineMessage[]

	// Tool usage tracking
	toolUsage: ToolUsage

	// Event emitter
	emit: EventEmitter["emit"]
}

/**
 * TaskTokenTracking handles token usage tracking, cost calculation, tool usage recording, and metrics.
 * Extracted from Task.ts as part of the modularization refactoring.
 */
export class TaskTokenTracking {
	// Token Usage Cache
	private _tokenUsageSnapshot?: TokenUsage
	private tokenUsageSnapshotAt?: number

	// Tool Usage Cache
	private _toolUsageSnapshot?: ToolUsage

	// Expose snapshots for testing/debugging
	public get tokenUsageSnapshot(): TokenUsage | undefined {
		return this._tokenUsageSnapshot
	}

	public set tokenUsageSnapshot(value: TokenUsage | undefined) {
		this._tokenUsageSnapshot = value
	}

	public get toolUsageSnapshot(): ToolUsage | undefined {
		return this._toolUsageSnapshot
	}

	public set toolUsageSnapshot(value: ToolUsage | undefined) {
		this._toolUsageSnapshot = value
	}

	// Token Usage Throttling - Debounced emit function
	private readonly TOKEN_USAGE_EMIT_INTERVAL_MS = 2000 // 2 seconds
	private debouncedEmitTokenUsage: ReturnType<typeof debounce>

	constructor(private readonly access: TaskTokenTrackingAccess) {
		// Initialize debounced token usage emit function
		// Uses debounce with maxWait to achieve throttle-like behavior:
		// - leading: true  - Emit immediately on first call
		// - trailing: true - Emit final state when updates stop
		// - maxWait        - Ensures at most one emit per interval during rapid updates (throttle behavior)
		this.debouncedEmitTokenUsage = debounce(
			(tokenUsage: TokenUsage, toolUsage: ToolUsage) => {
				const tokenChanged = hasTokenUsageChanged(tokenUsage, this._tokenUsageSnapshot)
				const toolChanged = hasToolUsageChanged(toolUsage, this._toolUsageSnapshot)

				if (tokenChanged || toolChanged) {
					this.access.emit(RooCodeEventName.TaskTokenUsageUpdated, this.access.taskId, tokenUsage, toolUsage)
					this._tokenUsageSnapshot = tokenUsage
					this.tokenUsageSnapshotAt = this.access.clineMessages.at(-1)?.ts
					// Deep copy tool usage for snapshot
					this._toolUsageSnapshot = JSON.parse(JSON.stringify(toolUsage))
				}
			},
			this.TOKEN_USAGE_EMIT_INTERVAL_MS,
			{ leading: true, trailing: true, maxWait: this.TOKEN_USAGE_EMIT_INTERVAL_MS },
		)
	}

	// Metrics

	/**
	 * Combine messages by applying API request and command sequence combining.
	 */
	public combineMessages(messages: ClineMessage[]): ClineMessage[] {
		return combineApiRequests(combineCommandSequences(messages))
	}

	/**
	 * Get current token usage metrics from messages.
	 */
	public getTokenUsage(): TokenUsage {
		return getApiMetrics(this.combineMessages(this.access.clineMessages.slice(1)))
	}

	/**
	 * Record a tool usage attempt for metrics tracking.
	 */
	public recordToolUsage(toolName: ToolName): void {
		if (!this.access.toolUsage[toolName]) {
			this.access.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}

		this.access.toolUsage[toolName].attempts++
	}

	/**
	 * Record a tool error for metrics tracking.
	 */
	public recordToolError(toolName: ToolName, error?: string): void {
		if (!this.access.toolUsage[toolName]) {
			this.access.toolUsage[toolName] = { attempts: 0, failures: 0 }
		}

		this.access.toolUsage[toolName].failures++

		if (error) {
			this.access.emit(RooCodeEventName.TaskToolFailed, this.access.taskId, toolName, error)
		}
	}

	/**
	 * Force emit a final token usage update, ignoring throttle.
	 * Called before task completion or abort to ensure final stats are captured.
	 * Triggers the debounce with current values and immediately flushes to ensure emit.
	 */
	public emitFinalTokenUsageUpdate(): void {
		const tokenUsage = this.getTokenUsage()
		this.debouncedEmitTokenUsage(tokenUsage, this.access.toolUsage)
		this.debouncedEmitTokenUsage.flush()
	}

	/**
	 * Emit token usage update (called by external callers).
	 */
	public emitTokenUsageUpdate(tokenUsage: TokenUsage, toolUsage: ToolUsage): void {
		this.debouncedEmitTokenUsage(tokenUsage, toolUsage)
	}

	// Getters

	/**
	 * Get cached token usage with snapshot optimization.
	 */
	public get tokenUsage(): TokenUsage | undefined {
		if (this._tokenUsageSnapshot && this.tokenUsageSnapshotAt) {
			return this._tokenUsageSnapshot
		}

		this._tokenUsageSnapshot = this.getTokenUsage()
		this.tokenUsageSnapshotAt = this.access.clineMessages.at(-1)?.ts

		return this._tokenUsageSnapshot
	}
}
