import { Anthropic } from "@anthropic-ai/sdk"

import { type TodoItem, type ClineMessage, type ClineApiReqCancelReason, RooCodeEventName } from "@roo-code/types"

import { type ApiMessage } from "../task-persistence"
import { getEnvironmentDetails } from "../environment/getEnvironmentDetails"
import { type TaskHistory } from "./TaskHistory"
import { type ClineProvider } from "../webview/ClineProvider"

/**
 * Interface for Task access needed by TaskSubtasks.
 * This is a narrow interface to minimize coupling between modules.
 */
export interface TaskSubtasksAccess {
	// Core identifiers
	taskId: string
	instanceId: string

	// Provider reference for delegation
	providerRef: WeakRef<ClineProvider>

	// Mutable state flags (all need to be settable)
	abort: boolean
	abandoned: boolean
	abortReason?: ClineApiReqCancelReason
	didFinishAbortingStream: boolean
	isStreaming: boolean
	isWaitingForFirstChunk: boolean
	isInitialized: boolean
	skipPrevResponseIdOnce: boolean

	// Ask state (need to be settable to undefined)
	idleAsk?: ClineMessage
	resumableAsk?: ClineMessage
	interactiveAsk?: ClineMessage

	// Conversation history (mutable array)
	apiConversationHistory: ApiMessage[]

	// Delegated modules
	history: TaskHistory

	// Event emission
	emit: (event: RooCodeEventName.TaskActive, taskId: string) => void

	// Callback to initiate task loop (private method on Task)
	initiateTaskLoop: (userContent: Anthropic.Messages.ContentBlockParam[]) => Promise<void>
}

/**
 * Handles subtask delegation and resumption logic.
 * Extracted from Task.ts to improve modularity and maintainability.
 */
export class TaskSubtasks {
	constructor(private readonly access: TaskSubtasksAccess) {}

	/**
	 * Start a subtask by delegating to the provider.
	 * Spawns a child task via provider delegation.
	 *
	 * @param message - The message to send to the child task
	 * @param initialTodos - Initial todo items for the child task
	 * @param mode - The mode to use for the child task
	 * @returns Promise resolving to the child task
	 */
	public async startSubtask(message: string, initialTodos: TodoItem[], mode: string) {
		const provider = this.access.providerRef.deref()

		if (!provider) {
			throw new Error("Provider not available")
		}

		const child = await (provider as any).delegateParentAndOpenChild({
			parentTaskId: this.access.taskId,
			message,
			initialTodos,
			mode,
		})
		return child
	}

	/**
	 * Resume parent task after delegation completion without showing resume ask.
	 * Used in metadata-driven subtask flow.
	 *
	 * This method:
	 * - Clears any pending ask states
	 * - Resets abort and streaming flags
	 * - Ensures next API call includes full context
	 * - Immediately continues task loop without user interaction
	 */
	public async resumeAfterDelegation(): Promise<void> {
		// Clear any ask states that might have been set during history load
		this.access.idleAsk = undefined
		this.access.resumableAsk = undefined
		this.access.interactiveAsk = undefined

		// Reset abort and streaming state to ensure clean continuation
		this.access.abort = false
		this.access.abandoned = false
		this.access.abortReason = undefined
		this.access.didFinishAbortingStream = false
		this.access.isStreaming = false
		this.access.isWaitingForFirstChunk = false

		// Ensure next API call includes full context after delegation
		this.access.skipPrevResponseIdOnce = true

		// Mark as initialized and active
		this.access.isInitialized = true
		this.access.emit(RooCodeEventName.TaskActive, this.access.taskId)

		// Load conversation history if not already loaded
		if (this.access.apiConversationHistory.length === 0) {
			this.access.apiConversationHistory = await this.access.history.getSavedApiConversationHistory()
		}

		// Add environment details to the existing last user message (which contains the tool_result)
		// This avoids creating a new user message which would cause consecutive user messages
		const environmentDetails = await this.getEnvironmentDetails(true)
		let lastUserMsgIndex = -1
		for (let i = this.access.apiConversationHistory.length - 1; i >= 0; i--) {
			if (this.access.apiConversationHistory[i].role === "user") {
				lastUserMsgIndex = i
				break
			}
		}
		if (lastUserMsgIndex >= 0) {
			const lastUserMsg = this.access.apiConversationHistory[lastUserMsgIndex]
			if (Array.isArray(lastUserMsg.content)) {
				// Remove any existing environment_details blocks before adding fresh ones
				const contentWithoutEnvDetails = lastUserMsg.content.filter(
					(block: Anthropic.Messages.ContentBlockParam) => {
						if (block.type === "text" && typeof block.text === "string") {
							const isEnvironmentDetailsBlock =
								block.text.trim().startsWith("<environment_details>") &&
								block.text.trim().endsWith("</environment_details>")
							return !isEnvironmentDetailsBlock
						}
						return true
					},
				)
				// Add fresh environment details
				lastUserMsg.content = [...contentWithoutEnvDetails, { type: "text" as const, text: environmentDetails }]
			}
		}

		// Save the updated history
		await this.access.history.saveApiConversationHistory()

		// Continue task loop - pass empty array to signal no new user content needed
		// The initiateTaskLoop will handle this by skipping user message addition
		await this.access.initiateTaskLoop([])
	}

	/**
	 * Get environment details for the task.
	 * This is a helper method that wraps the module-level getEnvironmentDetails function.
	 * The function requires access to the full Task object, so we need to pass through the access interface.
	 *
	 * @param includeFileDetails - Whether to include file details
	 * @returns Promise resolving to environment details string
	 */
	private async getEnvironmentDetails(includeFileDetails: boolean): Promise<string> {
		// The getEnvironmentDetails function requires a Task instance.
		// Since we only have the narrow access interface, we need to cast to get the full Task.
		// This is a temporary solution until getEnvironmentDetails is refactored to accept a narrower interface.
		const task = this.access as unknown as import("./Task").Task
		return getEnvironmentDetails(task, includeFileDetails)
	}
}
