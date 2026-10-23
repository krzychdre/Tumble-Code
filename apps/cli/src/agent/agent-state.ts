/**
 * Agent Loop State Detection
 *
 * This module provides the core logic for detecting the current state of the
 * Tumble Code agent loop. The state is determined by analyzing the clineMessages
 * array, specifically the last message's type and properties.
 *
 * Key insight: The agent loop stops whenever a message with `type: "ask"` arrives,
 * and the specific `ask` value determines what kind of response the agent is waiting for.
 */

import {
	ClineMessage,
	ClineAsk,
	isIdleAsk,
	isResumableAsk,
	isInteractiveAsk,
	isNonBlockingAsk,
} from "@tumble-code/types"

// =============================================================================
// Agent Loop State Enum
// =============================================================================

/**
 * The possible states of the agent loop.
 *
 * State Machine:
 * ```
 *                    ┌─────────────────┐
 *                    │   NO_TASK       │ (initial state)
 *                    └────────┬────────┘
 *                             │ newTask
 *                             ▼
 *              ┌─────────────────────────────┐
 *         ┌───▶│         RUNNING             │◀───┐
 *         │    └──────────┬──────────────────┘    │
 *         │               │                       │
 *         │    ┌──────────┼──────────────┐        │
 *         │    │          │              │        │
 *         │    ▼          ▼              ▼        │
 *         │ ┌──────┐  ┌─────────┐  ┌──────────┐   │
 *         │ │STREAM│  │INTERACT │  │  IDLE    │   │
 *         │ │ ING  │  │  IVE    │  │          │   │
 *         │ └──┬───┘  └────┬────┘  └────┬─────┘   │
 *         │    │           │            │         │
 *         │    │ done      │ approved   │ newTask │
 *         └────┴───────────┴────────────┘         │
 *                                                 │
 *         ┌──────────────┐                        │
 *         │  RESUMABLE   │────────────────────────┘
 *         └──────────────┘  resumed
 * ```
 */
export enum AgentLoopState {
	/**
	 * No active task. This is the initial state before any task is started,
	 * or after a task has been cleared.
	 */
	NO_TASK = "no_task",

	/**
	 * Agent is actively processing. This means:
	 * - The last message is a "say" type (informational), OR
	 * - The last message is a non-blocking ask (command_output)
	 *
	 * In this state, the agent may be:
	 * - Executing tools
	 * - Thinking/reasoning
	 * - Processing between API calls
	 */
	RUNNING = "running",

	/**
	 * Agent is streaming a response. This is detected when:
	 * - `partial === true` on the last message, OR
	 * - The last `api_req_started` message has no `cost` in its text field
	 *
	 * Do NOT consider the agent "waiting" while streaming.
	 */
	STREAMING = "streaming",

	/**
	 * Agent is waiting for user approval or input. This includes:
	 * - Tool approvals (file operations)
	 * - Command execution permission
	 * - Browser action permission
	 * - MCP server permission
	 * - Follow-up questions
	 *
	 * User must approve, reject, or provide input to continue.
	 */
	WAITING_FOR_INPUT = "waiting_for_input",

	/**
	 * Task is in an idle/terminal state. This includes:
	 * - Task completed successfully (completion_result)
	 * - API request failed (api_req_failed)
	 * - Too many errors (mistake_limit_reached)
	 * - Auto-approval limit reached
	 * - Completed task waiting to be resumed
	 *
	 * User can start a new task or retry.
	 */
	IDLE = "idle",

	/**
	 * Task is paused and can be resumed. This happens when:
	 * - User navigated away from a task
	 * - Extension was restarted mid-task
	 *
	 * User can resume or abandon the task.
	 */
	RESUMABLE = "resumable",
}

// =============================================================================
// Detailed State Info
// =============================================================================

/**
 * Detailed information about the current agent state.
 * Provides everything needed to render UI or make decisions.
 */
export interface AgentStateInfo {
	/** The high-level state of the agent loop */
	state: AgentLoopState

	/** Whether the agent is waiting for user input/action */
	isWaitingForInput: boolean

	/** Whether the agent loop is actively processing */
	isRunning: boolean

	/** Whether content is being streamed */
	isStreaming: boolean

	/** The specific ask type if waiting on an ask, undefined otherwise */
	currentAsk?: ClineAsk

	/** The full last message for advanced usage */
	lastMessage?: ClineMessage
}

// =============================================================================
// State Detection Functions
// =============================================================================

/**
 * Structure of the text field in api_req_started messages.
 * Used to determine if the API request has completed (cost is defined).
 */
export interface ApiReqStartedText {
	cost?: number // Undefined while streaming, defined when complete.
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
}

/**
 * Check if an API request is still in progress (streaming).
 *
 * API requests are considered in-progress when:
 * - An api_req_started message exists
 * - Its text field, when parsed, has `cost: undefined`
 *
 * Once the request completes, the cost field will be populated.
 */
function isApiRequestInProgress(messages: ClineMessage[]): boolean {
	// Find the last api_req_started message.
	// Using reverse iteration for efficiency (most recent first).
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]

		if (!message) {
			continue
		}

		if (message.say === "api_req_started") {
			if (!message.text) {
				// No text yet means still in progress.
				return true
			}

			try {
				const data: ApiReqStartedText = JSON.parse(message.text)
				// cost is undefined while streaming, defined when complete.
				return data.cost === undefined
			} catch {
				// Parse error - assume not in progress.
				return false
			}
		}
	}
	return false
}

/** The state info of `state`; the three flags follow from the state. */
function make(state: AgentLoopState, lastMessage?: ClineMessage, currentAsk?: ClineAsk): AgentStateInfo {
	return {
		state,
		isWaitingForInput:
			state === AgentLoopState.WAITING_FOR_INPUT ||
			state === AgentLoopState.IDLE ||
			state === AgentLoopState.RESUMABLE,
		isRunning: state === AgentLoopState.RUNNING || state === AgentLoopState.STREAMING,
		isStreaming: state === AgentLoopState.STREAMING,
		currentAsk,
		lastMessage,
	}
}

/**
 * Detect the current state of the agent loop from the clineMessages array.
 *
 * This is the main state detection function. It analyzes the messages array
 * and returns detailed information about the current agent state.
 *
 * @param messages - The clineMessages array from extension state
 * @returns Detailed state information
 */
export function detectAgentState(messages: ClineMessage[]): AgentStateInfo {
	const lastMessage = messages.at(-1)

	// No messages means no task
	if (!lastMessage) {
		return make(AgentLoopState.NO_TASK)
	}

	// Check if the message is still streaming (partial)
	// This is the PRIMARY indicator of streaming
	if (lastMessage.partial === true) {
		return make(AgentLoopState.STREAMING, lastMessage, lastMessage.ask)
	}

	// Handle "ask" type messages
	if (lastMessage.type === "ask" && lastMessage.ask) {
		const ask = lastMessage.ask

		// Non-blocking asks (command_output) - agent is running but can be interrupted
		if (isNonBlockingAsk(ask)) {
			return make(AgentLoopState.RUNNING, lastMessage, ask)
		}

		// Idle asks - task has stopped, the user decides what to do next
		if (isIdleAsk(ask)) {
			return make(AgentLoopState.IDLE, lastMessage, ask)
		}

		// Resumable asks - task is paused
		if (isResumableAsk(ask)) {
			return make(AgentLoopState.RESUMABLE, lastMessage, ask)
		}

		// Interactive asks - waiting for approval/input
		if (isInteractiveAsk(ask)) {
			return make(AgentLoopState.WAITING_FOR_INPUT, lastMessage, ask)
		}
	}

	// For "say" type messages, check if API request is in progress
	if (isApiRequestInProgress(messages)) {
		return make(AgentLoopState.STREAMING, lastMessage)
	}

	// Default: agent is running
	return make(AgentLoopState.RUNNING, lastMessage)
}
