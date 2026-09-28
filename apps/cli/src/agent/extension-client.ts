/**
 * Tumble Code Client
 *
 * The CLI's reading of the extension's messages and its way back to the
 * extension:
 * - `handleMessage` feeds the extension's messages in;
 * - the agent loop state (`getAgentState`, `getCurrentAsk`, `hasActiveTask`)
 *   and the task's messages (`getMessages`) can be queried at any time;
 * - events (`stateChange`, `delivery`, `waitingForInput`, `taskCompleted`,
 *   `error`) report what changed;
 * - `approve`/`reject`/`respond`/`cancelTask` answer the extension.
 *
 * ```
 *                     ┌───────────────────────────────────────────────┐
 *                     │               ExtensionClient                 │
 *   Extension ──────▶ │  MessageProcessor ──▶ DeliveryReader          │
 *   Messages          │         │             (transcript, news)      │
 *                     │         ▼                                     │
 *                     │    TypedEventEmitter ──▶ your handlers        │
 *                     └───────────────────────────────────────────────┘
 * ```
 */

import type { ExtensionMessage, WebviewMessage, ClineAskResponse, ClineMessage, ClineAsk } from "@roo-code/types"

import { MessageProcessor } from "./message-processor.js"
import { TypedEventEmitter, type ClientEventMap } from "./events.js"
import { AgentLoopState, type AgentStateInfo } from "./agent-state.js"
import { TranscriptReader } from "./transcript-reader.js"

export interface ExtensionClientConfig {
	/** How the client sends messages back to the extension host. */
	sendMessage: (message: WebviewMessage) => void

	/** Write the processor's debug log lines. Default: false */
	debug?: boolean
}

export class ExtensionClient {
	/**
	 * Reads extension messages into transcript rows for the consumer that
	 * shows them (the TUI). It is fed by the extension host from construction
	 * on, not by `handleMessage`: see `ExtensionHost`'s constructor.
	 */
	readonly transcript = new TranscriptReader()

	private processor: MessageProcessor
	private emitter: TypedEventEmitter
	private sendMessage: (message: WebviewMessage) => void

	constructor(config: ExtensionClientConfig) {
		this.sendMessage = config.sendMessage
		this.emitter = new TypedEventEmitter()
		this.processor = new MessageProcessor(this.emitter, config.debug ?? false)
	}

	// ===========================================================================
	// Message Handling
	// ===========================================================================

	/** Handle an incoming message from the extension host. */
	handleMessage(message: ExtensionMessage): void {
		this.processor.processMessage(message)
	}

	// ===========================================================================
	// State Queries
	// ===========================================================================

	/**
	 * The agent loop state, read from the last message of the transcript: the
	 * high-level state (running, streaming, waiting, idle, ...), whether input
	 * is needed, the ask, the required action.
	 */
	getAgentState(): AgentStateInfo {
		return this.processor.getAgentState()
	}

	/** Check if there is an active task. */
	hasActiveTask(): boolean {
		return this.getAgentState().state !== AgentLoopState.NO_TASK
	}

	/** All messages of the current task, as the extension last sent them. */
	getMessages(): ClineMessage[] {
		return this.processor.getMessages()
	}

	/** The current ask type if the agent is waiting for input. */
	getCurrentAsk(): ClineAsk | undefined {
		return this.getAgentState().currentAsk
	}

	/** Check if the client has received a transcript from the extension. */
	isInitialized(): boolean {
		return this.processor.isInitialized()
	}

	// ===========================================================================
	// Event Subscriptions
	// ===========================================================================

	/** Subscribe to an event; returns the unsubscribe function. */
	on<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): () => void {
		return this.emitter.on(event, listener)
	}

	/** Subscribe to an event, triggered only once. */
	once<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): void {
		this.emitter.once(event, listener)
	}

	/** Unsubscribe from an event. */
	off<K extends keyof ClientEventMap>(event: K, listener: (payload: ClientEventMap[K]) => void): void {
		this.emitter.off(event, listener)
	}

	// ===========================================================================
	// Responses and Task Control
	// ===========================================================================

	/** Approve the current action (tool, command, browser, MCP). */
	approve(): void {
		this.sendResponse("yesButtonClicked")
	}

	/** Reject the current action. */
	reject(): void {
		this.sendResponse("noButtonClicked")
	}

	/** Send a text response (a follow-up answer, feedback on a completion). */
	respond(text: string, images?: string[]): void {
		this.sendResponse("messageResponse", text, images)
	}

	private sendResponse(response: ClineAskResponse, text?: string, images?: string[]): void {
		this.sendMessage({ type: "askResponse", askResponse: response, text, images })
	}

	/** Cancel a running task. */
	cancelTask(): void {
		this.sendMessage({ type: "cancelTask" })
	}

	/**
	 * A task is about to be opened again (showTaskWithId): its history, which
	 * arrives next, is marked as such in the `delivery` events up to and
	 * including the push that ends with its resume ask.
	 */
	beginHistoryReplay(): void {
		this.processor.beginHistoryReplay()
	}

	// ===========================================================================
	// Utility Methods
	// ===========================================================================

	/**
	 * Reset the client: forget the transcript, the agent state and every
	 * listener.
	 */
	reset(): void {
		this.processor.reset()
		this.transcript.reset()
		this.emitter.removeAllListeners()
	}

	/** Direct access to the event emitter (tests emit through it). */
	getEmitter(): TypedEventEmitter {
		return this.emitter
	}
}

/**
 * Create a client for testing: it captures every message it sends.
 */
export function createMockClient(): {
	client: ExtensionClient
	sentMessages: WebviewMessage[]
	clearMessages: () => void
} {
	const sentMessages: WebviewMessage[] = []

	const client = new ExtensionClient({
		sendMessage: (message) => sentMessages.push(message),
		debug: false,
	})

	return {
		client,
		sentMessages,
		clearMessages: () => {
			sentMessages.length = 0
		},
	}
}
