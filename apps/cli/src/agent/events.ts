/**
 * Event System for Agent State Changes
 *
 * This module provides a strongly-typed event emitter specifically designed
 * for tracking agent state changes. It uses Node.js EventEmitter under the hood
 * but provides type safety for all events.
 */

import { EventEmitter } from "events"

import { ClineMessage, ClineAsk } from "@tumble-code/types"

import type { AgentStateInfo } from "./agent-state.js"
import type { MessageDelivery } from "./transcript-deliveries.js"

// =============================================================================
// Event Types
// =============================================================================

/**
 * All events that can be emitted by the client.
 *
 * Design note: We use a string literal union type for event names to ensure
 * type safety when subscribing to events. The payload type is determined by
 * the event name.
 */
export interface ClientEventMap {
	/**
	 * Emitted whenever the agent state changes.
	 * This is the primary event for tracking state.
	 */
	stateChange: AgentStateChangeEvent

	/**
	 * Emitted for every message that is new or changed, once per change: each
	 * message of a state push that was not delivered before in this form, and
	 * each messageUpdated that changes something (see transcript-deliveries.ts).
	 */
	delivery: MessageDelivery

	/**
	 * Emitted when the agent starts waiting for user input.
	 * Convenience event - you can also use stateChange.
	 */
	waitingForInput: WaitingForInputEvent

	/**
	 * Emitted when a task completes (either successfully or with error).
	 */
	taskCompleted: TaskCompletedEvent

	/**
	 * Emitted on any error during message processing.
	 */
	error: Error
}

/**
 * Event payload for state changes.
 */
export interface AgentStateChangeEvent {
	/** The previous state info */
	previousState: AgentStateInfo
	/** The new/current state info */
	currentState: AgentStateInfo
}

/**
 * Event payload when agent starts waiting for input.
 */
export interface WaitingForInputEvent {
	/** The specific ask type */
	ask: ClineAsk
	/** Full state info for context */
	stateInfo: AgentStateInfo
	/** The message that triggered this wait */
	message: ClineMessage
}

/**
 * Event payload when a task completes.
 */
export interface TaskCompletedEvent {
	/** Whether the task completed successfully */
	success: boolean
	/** The final state info */
	stateInfo: AgentStateInfo
	/** The completion message if available */
	message?: ClineMessage
}

// =============================================================================
// Typed Event Emitter
// =============================================================================

/**
 * Type-safe event emitter for client events.
 *
 * Usage:
 * ```typescript
 * const emitter = new TypedEventEmitter()
 *
 * // Type-safe subscription
 * emitter.on('stateChange', (event) => {
 *   console.log(event.currentState) // TypeScript knows this is AgentStateChangeEvent
 * })
 *
 * // Type-safe emission
 * emitter.emit('stateChange', { previousState, currentState })
 * ```
 */
export class TypedEventEmitter {
	private emitter = new EventEmitter()

	/**
	 * Subscribe to an event.
	 *
	 * @param event - The event name
	 * @param listener - The callback function
	 * @returns Function to unsubscribe
	 */
	on<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): () => void {
		this.emitter.on(event, listener)
		return () => this.emitter.off(event, listener)
	}

	/**
	 * Subscribe to an event, but only once.
	 *
	 * @param event - The event name
	 * @param listener - The callback function
	 */
	once<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): void {
		this.emitter.once(event, listener)
	}

	/**
	 * Unsubscribe from an event.
	 *
	 * @param event - The event name
	 * @param listener - The callback function to remove
	 */
	off<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): void {
		this.emitter.off(event, listener)
	}

	/**
	 * Emit an event.
	 *
	 * @param event - The event name
	 * @param payload - The event payload
	 */
	emit<K extends keyof ClientEventMap>(event: K, payload: ClientEventMap[K]): void {
		this.emitter.emit(event, payload)
	}

	/** Remove every listener of every event. */
	removeAllListeners(): void {
		this.emitter.removeAllListeners()
	}
}

// =============================================================================
// State Change Detector
// =============================================================================

/**
 * Helper to determine if we transitioned to waiting for input.
 */
export function transitionedToWaiting(previous: AgentStateInfo, current: AgentStateInfo): boolean {
	return !previous.isWaitingForInput && current.isWaitingForInput
}

/**
 * Helper to determine if task completed.
 */
export function taskCompleted(previous: AgentStateInfo, current: AgentStateInfo): boolean {
	const completionAsks = ["completion_result", "resume_completed_task"]
	const wasNotComplete = !previous.currentAsk || !completionAsks.includes(previous.currentAsk)
	const isNowComplete = current.currentAsk !== undefined && completionAsks.includes(current.currentAsk)
	return wasNotComplete && isNowComplete
}
