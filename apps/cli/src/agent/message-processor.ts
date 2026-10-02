/**
 * Message Processor
 *
 * Reads the extension's "state" pushes and "messageUpdated" posts into the
 * client's events. Every other message type is not relevant here.
 *
 * ```
 * Extension Host ──▶ MessageProcessor ──▶ DeliveryReader (transcript, news)
 *                          │
 *                          ▼
 *        agent loop state (detectAgentState on the transcript) ──▶ Events
 * ```
 *
 * The transcript is kept by the deliveries stage (transcript-deliveries.ts),
 * which already follows what each push and update does to it; the agent loop
 * state is derived from it after every change (D11 step 4: there is no
 * separate state store any more).
 */

import type { ExtensionMessage, ClineMessage } from "@tumble-code/types"
import { debugLog } from "@tumble-code/core/cli"

import type { TypedEventEmitter, WaitingForInputEvent, TaskCompletedEvent } from "./events.js"
import { transitionedToWaiting, taskCompleted } from "./events.js"
import { detectAgentState, type AgentStateInfo } from "./agent-state.js"
import { DeliveryReader, type MessageDelivery } from "./transcript-deliveries.js"

export class MessageProcessor {
	/** The transcript and the news in each message, published as `delivery` events (D11). */
	private deliveries = new DeliveryReader()
	private agentState: AgentStateInfo = detectAgentState([])

	constructor(
		private readonly emitter: TypedEventEmitter,
		private readonly debug = false,
	) {}

	/** The current transcript (the task's messages as the extension last sent them). */
	getMessages(): ClineMessage[] {
		return this.deliveries.transcript
	}

	getAgentState(): AgentStateInfo {
		return this.agentState
	}

	/** Whether a transcript has arrived (a push or an update). */
	isInitialized(): boolean {
		return this.deliveries.hasTranscript
	}

	/**
	 * Process an incoming message from the extension host.
	 */
	processMessage(message: ExtensionMessage): void {
		if (this.debug) {
			debugLog("[MessageProcessor] Received message", { type: message.type })
		}

		try {
			switch (message.type) {
				case "state":
					this.handleStateMessage(message)
					break

				case "messageUpdated":
					this.handleMessageUpdated(message)
					break

				default:
					// Other message types are not relevant to state detection.
					if (this.debug) {
						debugLog("[MessageProcessor] Ignoring message", { type: message.type })
					}
			}
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error))
			debugLog("[MessageProcessor] Error processing message", { error: err.message })
			this.emitter.emit("error", err)
		}
	}

	/**
	 * A "state" push carries the whole transcript. Its state change events
	 * come first, then every message of the push that is new or changed.
	 */
	private handleStateMessage(message: ExtensionMessage): void {
		const clineMessages = message.state?.clineMessages

		if (!clineMessages) {
			if (this.debug) {
				debugLog("[MessageProcessor] State message missing clineMessages")
			}
			return
		}

		const previousState = this.agentState
		const news = this.deliveries.read(message)
		const currentState = this.refreshAgentState()

		if (this.debug) {
			const lastMsg = clineMessages[clineMessages.length - 1]
			const lastMsgInfo = lastMsg
				? {
						msgType: lastMsg.type === "ask" ? `ask:${lastMsg.ask}` : `say:${lastMsg.say}`,
						partial: lastMsg.partial,
						textPreview: lastMsg.text?.substring(0, 50),
					}
				: null
			debugLog("[MessageProcessor] State update", {
				messageCount: clineMessages.length,
				lastMessage: lastMsgInfo,
				stateTransition: `${previousState.state} → ${currentState.state}`,
				currentAsk: currentState.currentAsk,
				isWaitingForInput: currentState.isWaitingForInput,
				isStreaming: currentState.isStreaming,
				isRunning: currentState.isRunning,
			})
		}

		this.emitStateChangeEvents(previousState, currentState)
		this.emitDeliveries(news)
	}

	/**
	 * A "messageUpdated" changes one message (a partial growing or finalized,
	 * a price written): the change itself first, then what it does to the
	 * agent state.
	 */
	private handleMessageUpdated(message: ExtensionMessage): void {
		if (!message.clineMessage) {
			if (this.debug) {
				debugLog("[MessageProcessor] messageUpdated missing clineMessage")
			}
			return
		}

		const previousState = this.agentState
		const news = this.deliveries.read(message)
		const currentState = this.refreshAgentState()

		this.emitDeliveries(news)
		this.emitStateChangeEvents(previousState, currentState)
	}

	private refreshAgentState(): AgentStateInfo {
		this.agentState = detectAgentState(this.deliveries.transcript)
		return this.agentState
	}

	private emitStateChangeEvents(previousState: AgentStateInfo, currentState: AgentStateInfo): void {
		this.emitter.emit("stateChange", { previousState, currentState })

		if (transitionedToWaiting(previousState, currentState)) {
			if (currentState.currentAsk && currentState.lastMessage) {
				if (this.debug) {
					debugLog("[MessageProcessor] EMIT waitingForInput", {
						ask: currentState.currentAsk,
						action: currentState.requiredAction,
					})
				}
				const waitingEvent: WaitingForInputEvent = {
					ask: currentState.currentAsk,
					stateInfo: currentState,
					message: currentState.lastMessage,
				}
				this.emitter.emit("waitingForInput", waitingEvent)
			}
		}

		if (taskCompleted(previousState, currentState)) {
			const completedSuccessfully =
				currentState.currentAsk === "completion_result" || currentState.currentAsk === "resume_completed_task"

			if (this.debug) {
				debugLog("[MessageProcessor] EMIT taskCompleted", { success: completedSuccessfully })
			}
			const completedEvent: TaskCompletedEvent = {
				success: completedSuccessfully,
				stateInfo: currentState,
				message: currentState.lastMessage,
			}
			this.emitter.emit("taskCompleted", completedEvent)
		}
	}

	/**
	 * Publish the news in a state push or a messageUpdated: every message that
	 * is new or changed since it was last delivered, not only the last one of
	 * a push (see transcript-deliveries.ts).
	 */
	private emitDeliveries(news: MessageDelivery[]): void {
		for (const delivery of news) {
			this.emitter.emit("delivery", delivery)
		}
	}

	/**
	 * A task is being resumed: mark its history in the deliveries that follow.
	 */
	beginHistoryReplay(): void {
		this.deliveries.beginHistoryReplay()
	}

	/** Forget the transcript and what was delivered (the client starts from scratch). */
	reset(): void {
		this.deliveries.reset()
		this.agentState = detectAgentState([])
	}
}
