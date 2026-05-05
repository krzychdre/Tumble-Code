import * as path from "path"

import {
	type TaskMetadata,
	type ProviderSettings,
	type ClineApiReqCancelReason,
	type ClineApiReqInfo,
	type ClineMessage,
	RooCodeEventName,
	MAX_MCP_TOOLS_THRESHOLD,
} from "@roo-code/types"

import { type ClineProvider } from "../webview/ClineProvider"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { OutputInterceptor } from "../../integrations/terminal/OutputInterceptor"
import { getTaskDirectoryPath } from "../../utils/storage"
import { formatResponse } from "../prompts/responses"
import { findLastIndex } from "../../shared/array"
import { type ApiMessage } from "../task-persistence"
import { type TaskHistory } from "./TaskHistory"
import { type TaskAskSay } from "./TaskAskSay"
import { type TaskContextManager } from "./TaskContextManager"
import { defaultModeSlug } from "../../shared/modes"

import Anthropic from "@anthropic-ai/sdk"

/**
 * Interface for Task access needed by TaskLifecycle.
 * This is a narrow interface to minimize coupling between modules.
 */
export interface TaskLifecycleAccess {
	// Core identifiers
	taskId: string
	rootTaskId?: string
	parentTaskId?: string
	instanceId: string
	metadata: TaskMetadata
	workspacePath: string
	cwd: string

	// Provider reference and storage
	providerRef: WeakRef<ClineProvider>
	globalStoragePath: string

	// API configuration
	apiConfiguration: ProviderSettings
	api: { cancelRequest: ((destroyClient: boolean) => void) | undefined }

	// Controllers and services
	rooIgnoreController?: { dispose: () => void }
	rooProtectedController?: { dispose: () => void }
	fileContextTracker: { dispose: () => void }
	diffViewProvider: { isEditing: boolean; revertChanges: () => Promise<void> }
	messageQueueService: { dispose: () => void; removeListener: (event: string, handler: () => void) => void }

	// Mutable state arrays (accessed directly for initialization/reset)
	clineMessages: ClineMessage[]
	apiConversationHistory: ApiMessage[]

	// Task state flags
	abort: boolean
	abandoned: boolean
	abortReason?: ClineApiReqCancelReason
	isInitialized: boolean
	isStreaming: boolean
	_started: boolean

	// Abort controller for current request
	currentRequestAbortController?: AbortController

	// Error counters
	consecutiveNoToolUseCount: number
	consecutiveNoAssistantMessagesCount: number

	// Mode/API config state
	_taskMode: string | undefined
	_taskApiConfigName: string | undefined
	taskModeReady: Promise<void>
	taskApiConfigReady: Promise<void>

	// Event listener
	providerProfileChangeListener?: (config: { name: string; provider?: string }) => void

	// Message queue handler
	messageQueueStateChangedHandler?: () => void

	// Delegated modules
	history: TaskHistory
	askSay: TaskAskSay
	contextManager: TaskContextManager

	// Methods needed
	emit: (event: RooCodeEventName, ...args: any[]) => boolean
	updateApiConfiguration: (newApiConfiguration: ProviderSettings) => void
	initiateTaskLoop: (userContent: Anthropic.Messages.ContentBlockParam[]) => Promise<void>
	emitFinalTokenUsageUpdate: () => void
	cancelCurrentRequest: (destroyClient?: boolean) => void
}

/**
 * TaskLifecycle handles task lifecycle management:
 * - Initialization (mode, API config)
 * - Starting tasks (new and from history)
 * - Abortion and disposal
 */
export class TaskLifecycle {
	constructor(private readonly access: TaskLifecycleAccess) {}

	// ======================
	// Initialization Methods
	// ======================

	/**
	 * Initialize the task mode from the provider state.
	 * This method handles async initialization with proper error handling.
	 *
	 * ## Flow
	 * 1. Attempts to fetch the current mode from provider state
	 * 2. Sets `_taskMode` to the fetched mode or `defaultModeSlug` if unavailable
	 * 3. Handles errors gracefully by falling back to default mode
	 * 4. Logs any initialization errors for debugging
	 *
	 * ## Error handling
	 * - Network failures when fetching provider state
	 * - Provider not yet initialized
	 * - Invalid state structure
	 *
	 * All errors result in fallback to `defaultModeSlug` to ensure task can proceed.
	 *
	 * @param provider - The ClineProvider instance to fetch state from
	 * @returns Promise that resolves when initialization is complete
	 */
	async initializeTaskMode(provider: ClineProvider): Promise<void> {
		try {
			const state = await provider.getState()
			this.access._taskMode = state?.mode || defaultModeSlug
		} catch (error) {
			// If there's an error getting state, use the default mode
			this.access._taskMode = defaultModeSlug
			// Use the provider's log method for better error visibility
			const errorMessage = `Failed to initialize task mode: ${error instanceof Error ? error.message : String(error)}`
			provider.log(errorMessage)
		}
	}

	/**
	 * Initialize the task API config name from the provider state.
	 * This method handles async initialization with proper error handling.
	 *
	 * ## Flow
	 * 1. Attempts to fetch the current API config name from provider state
	 * 2. Sets `_taskApiConfigName` to the fetched name or "default" if unavailable
	 * 3. Handles errors gracefully by falling back to "default"
	 * 4. Logs any initialization errors for debugging
	 *
	 * ## Error handling
	 * - Network failures when fetching provider state
	 * - Provider not yet initialized
	 * - Invalid state structure
	 *
	 * All errors result in fallback to "default" to ensure task can proceed.
	 *
	 * @param provider - The ClineProvider instance to fetch state from
	 * @returns Promise that resolves when initialization is complete
	 */
	async initializeTaskApiConfigName(provider: ClineProvider): Promise<void> {
		try {
			const state = await provider.getState()

			// Avoid clobbering a newer value that may have been set while awaiting provider state
			// (e.g., user switches provider profile immediately after task creation).
			if (this.access._taskApiConfigName === undefined) {
				this.access._taskApiConfigName = state?.currentApiConfigName ?? "default"
			}
		} catch (error) {
			// If there's an error getting state, use the default profile (unless a newer value was set).
			if (this.access._taskApiConfigName === undefined) {
				this.access._taskApiConfigName = "default"
			}
			// Use the provider's log method for better error visibility
			const errorMessage = `Failed to initialize task API config name: ${error instanceof Error ? error.message : String(error)}`
			provider.log(errorMessage)
		}
	}

	/**
	 * Sets up a listener for provider profile changes.
	 *
	 * @param provider - The ClineProvider instance to listen to
	 */
	setupProviderProfileChangeListener(provider: ClineProvider): void {
		// Only set up listener if provider has the on method (may not exist in test mocks)
		if (typeof provider.on !== "function") {
			return
		}

		this.access.providerProfileChangeListener = async () => {
			try {
				const newState = await provider.getState()
				if (newState?.apiConfiguration) {
					this.access.updateApiConfiguration(newState.apiConfiguration)
				}
			} catch (error) {
				console.error(
					`[Task#${this.access.taskId}.${this.access.instanceId}] Failed to update API configuration on profile change:`,
					error,
				)
			}
		}

		provider.on(RooCodeEventName.ProviderProfileChanged, this.access.providerProfileChangeListener)
	}

	// ======================
	// Mode/API Config Access
	// ======================

	/**
	 * Wait for the task mode to be initialized before proceeding.
	 * This method ensures that any operations depending on the task mode
	 * will have access to the correct mode value.
	 *
	 * ## When to use
	 * - Before accessing mode-specific configurations
	 * - When switching between tasks with different modes
	 * - Before operations that depend on mode-based permissions
	 *
	 * ## Example usage
	 * ```typescript
	 * // Wait for mode initialization before mode-dependent operations
	 * await task.waitForModeInitialization();
	 * const mode = task.taskMode; // Now safe to access synchronously
	 *
	 * // Or use with getTaskMode() for a one-liner
	 * const mode = await task.getTaskMode(); // Internally waits for initialization
	 * ```
	 *
	 * @returns Promise that resolves when the task mode is initialized
	 */
	async waitForModeInitialization(): Promise<void> {
		return this.access.taskModeReady
	}

	/**
	 * Get the task mode asynchronously, ensuring it's properly initialized.
	 * This is the recommended way to access the task mode as it guarantees
	 * the mode is available before returning.
	 *
	 * ## Async behavior
	 * - Internally waits for `taskModeReady` promise to resolve
	 * - Returns the initialized mode or `defaultModeSlug` as fallback
	 * - Safe to call multiple times - subsequent calls return immediately if already initialized
	 *
	 * ## Example usage
	 * ```typescript
	 * // Safe async access
	 * const mode = await task.getTaskMode();
	 * console.log(`Task is running in ${mode} mode`);
	 *
	 * // Use in conditional logic
	 * if (await task.getTaskMode() === 'architect') {
	 *   // Perform architect-specific operations
	 * }
	 * ```
	 *
	 * @returns Promise resolving to the task mode string
	 */
	async getTaskMode(): Promise<string> {
		await this.access.taskModeReady
		return this.access._taskMode || defaultModeSlug
	}

	/**
	 * Get the task mode synchronously. This should only be used when you're certain
	 * that the mode has already been initialized (e.g., after waitForModeInitialization).
	 *
	 * ## When to use
	 * - In synchronous contexts where async/await is not available
	 * - After explicitly waiting for initialization via `waitForModeInitialization()`
	 * - In event handlers or callbacks where mode is guaranteed to be initialized
	 *
	 * ## Example usage
	 * ```typescript
	 * // After ensuring initialization
	 * await task.waitForModeInitialization();
	 * const mode = task.taskMode; // Safe synchronous access
	 *
	 * // In an event handler after task is started
	 * task.on('taskStarted', () => {
	 *   console.log(`Task started in ${task.taskMode} mode`); // Safe here
	 * });
	 * ```
	 *
	 * @throws {Error} If the mode hasn't been initialized yet
	 * @returns The task mode string
	 */
	get taskMode(): string {
		if (this.access._taskMode === undefined) {
			throw new Error("Task mode accessed before initialization. Use getTaskMode() or wait for taskModeReady.")
		}

		return this.access._taskMode
	}

	/**
	 * Wait for the task API config name to be initialized before proceeding.
	 * This method ensures that any operations depending on the task's provider profile
	 * will have access to the correct value.
	 *
	 * ## When to use
	 * - Before accessing provider profile-specific configurations
	 * - When switching between tasks with different provider profiles
	 * - Before operations that depend on the provider profile
	 *
	 * @returns Promise that resolves when the task API config name is initialized
	 */
	async waitForApiConfigInitialization(): Promise<void> {
		return this.access.taskApiConfigReady
	}

	/**
	 * Get the task API config name asynchronously, ensuring it's properly initialized.
	 * This is the recommended way to access the task's provider profile as it guarantees
	 * the value is available before returning.
	 *
	 * ## Async behavior
	 * - Internally waits for `taskApiConfigReady` promise to resolve
	 * - Returns the initialized API config name or undefined as fallback
	 * - Safe to call multiple times - subsequent calls return immediately if already initialized
	 *
	 * @returns Promise resolving to the task API config name string or undefined
	 */
	async getTaskApiConfigName(): Promise<string | undefined> {
		await this.access.taskApiConfigReady
		return this.access._taskApiConfigName
	}

	/**
	 * Get the task API config name synchronously. This should only be used when you're certain
	 * that the value has already been initialized (e.g., after waitForApiConfigInitialization).
	 *
	 * ## When to use
	 * - In synchronous contexts where async/await is not available
	 * - After explicitly waiting for initialization via `waitForApiConfigInitialization()`
	 * - In event handlers or callbacks where API config name is guaranteed to be initialized
	 *
	 * Note: Unlike taskMode, this getter does not throw if uninitialized since the API config
	 * name can legitimately be undefined (backward compatibility with tasks created before
	 * this feature was added).
	 *
	 * @returns The task API config name string or undefined
	 */
	get taskApiConfigName(): string | undefined {
		return this.access._taskApiConfigName
	}

	/**
	 * Update the task's API config name. This is called when the user switches
	 * provider profiles while a task is active, allowing the task to remember
	 * its new provider profile.
	 *
	 * @param apiConfigName - The new API config name to set
	 */
	setTaskApiConfigName(apiConfigName: string | undefined): void {
		this.access._taskApiConfigName = apiConfigName
	}

	// ======================
	// Lifecycle Methods
	// ======================

	/**
	 * Start the task manually (for delegation flow).
	 * This is used when a task is created with startTask: false.
	 * Only starts if not already started.
	 */
	start(): void {
		if (this.access._started) {
			return
		}
		this.access._started = true

		const { task, images } = this.access.metadata

		if (task || images) {
			this.startTask(task ?? undefined, images ?? undefined)
		}
	}

	/**
	 * Start a new task with the given task text and images.
	 * Initializes conversation history and begins the task loop.
	 *
	 * @param task - The task text
	 * @param images - Optional array of image paths
	 */
	async startTask(task?: string, images?: string[]): Promise<void> {
		try {
			// `conversationHistory` (for API) and `clineMessages` (for webview)
			// need to be in sync.
			// If the extension process were killed, then on restart the
			// `clineMessages` might not be empty, so we need to set it to [] when
			// we create a new Cline client (otherwise webview would show stale
			// messages from previous session).
			this.access.clineMessages = []
			this.access.apiConversationHistory = []

			// The todo list is already set in the constructor if initialTodos were provided
			// No need to add any messages - the todoList property is already set

			await this.access.providerRef.deref()?.postStateToWebviewWithoutTaskHistory()

			await this.access.askSay.say("text", task, images)

			// Check for too many MCP tools and warn the user
			const { enabledToolCount, enabledServerCount } = await this.access.contextManager.getEnabledMcpToolsCount()
			if (enabledToolCount > MAX_MCP_TOOLS_THRESHOLD) {
				await this.access.askSay.say(
					"too_many_tools_warning",
					JSON.stringify({
						toolCount: enabledToolCount,
						serverCount: enabledServerCount,
						threshold: MAX_MCP_TOOLS_THRESHOLD,
					}),
					undefined,
					undefined,
					undefined,
					undefined,
					{ isNonInteractive: true },
				)
			}
			this.access.isInitialized = true

			const imageBlocks: Anthropic.ImageBlockParam[] = formatResponse.imageBlocks(images)

			// Task starting
			await this.access
				.initiateTaskLoop([
					{
						type: "text",
						text: `<user_message>\n${task}\n</user_message>`,
					},
					...imageBlocks,
				])
				.catch((error) => {
					// Swallow loop rejection when the task was intentionally abandoned/aborted
					// during delegation or user cancellation to prevent unhandled rejections.
					if (this.access.abandoned === true || this.access.abortReason === "user_cancelled") {
						return
					}
					throw error
				})
		} catch (error) {
			// In tests and some UX flows, tasks can be aborted while `startTask` is still
			// initializing. Treat abort/abandon as expected and avoid unhandled rejections.
			if (
				this.access.abandoned === true ||
				this.access.abort === true ||
				this.access.abortReason === "user_cancelled"
			) {
				return
			}
			throw error
		}
	}

	/**
	 * Resume a task from history, reconstructing conversation state.
	 * This handles the complex logic of:
	 * - Removing stale resume messages
	 * - Handling interrupted tool calls
	 * - Preserving summary messages
	 * - Building proper user content for resumption
	 */
	async resumeTaskFromHistory(): Promise<void> {
		try {
			const modifiedClineMessages = await this.access.history.getSavedClineMessages()

			// Remove any resume messages that may have been added before.
			const lastRelevantMessageIndex = findLastIndex(
				modifiedClineMessages,
				(m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"),
			)

			if (lastRelevantMessageIndex !== -1) {
				modifiedClineMessages.splice(lastRelevantMessageIndex + 1)
			}

			// Remove any trailing reasoning-only UI messages that were not part of the persisted API conversation
			while (modifiedClineMessages.length > 0) {
				const last = modifiedClineMessages[modifiedClineMessages.length - 1]
				if (last.type === "say" && last.say === "reasoning") {
					modifiedClineMessages.pop()
				} else {
					break
				}
			}

			// Since we don't use `api_req_finished` anymore, we need to check if the
			// last `api_req_started` has a cost value, if it doesn't and no
			// cancellation reason to present, then we remove it since it indicates
			// an api request without any partial content streamed.
			const lastApiReqStartedIndex = findLastIndex(
				modifiedClineMessages,
				(m) => m.type === "say" && m.say === "api_req_started",
			)

			if (lastApiReqStartedIndex !== -1) {
				const lastApiReqStarted = modifiedClineMessages[lastApiReqStartedIndex]
				const { cost, cancelReason }: ClineApiReqInfo = JSON.parse(lastApiReqStarted.text || "{}")

				if (cost === undefined && cancelReason === undefined) {
					modifiedClineMessages.splice(lastApiReqStartedIndex, 1)
				}
			}

			await this.access.history.overwriteClineMessages(modifiedClineMessages)
			this.access.clineMessages = await this.access.history.getSavedClineMessages()

			// Now present the cline messages to the user and ask if they want to
			// resume (NOTE: we ran into a bug before where the
			// apiConversationHistory wouldn't be initialized when opening a old
			// task, and it was because we were waiting for resume).
			// This is important in case the user deletes messages without resuming
			// the task first.
			this.access.apiConversationHistory = await this.access.history.getSavedApiConversationHistory()

			const lastClineMessage = this.access.clineMessages
				.slice()
				.reverse()
				.find((m: ClineMessage) => !(m.ask === "resume_task" || m.ask === "resume_completed_task")) // Could be multiple resume tasks.

			let askType: "resume_task" | "resume_completed_task"
			if (lastClineMessage?.ask === "completion_result") {
				askType = "resume_completed_task"
			} else {
				askType = "resume_task"
			}

			this.access.isInitialized = true

			const { response, text, images } = await this.access.askSay.ask(askType) // Calls `postStateToWebview`.

			let responseText: string | undefined
			let responseImages: string[] | undefined

			if (response === "messageResponse") {
				await this.access.askSay.say("user_feedback", text, images)
				responseText = text
				responseImages = images
			}

			// Make sure that the api conversation history can be resumed by the API,
			// even if it goes out of sync with cline messages.
			let existingApiConversationHistory: ApiMessage[] =
				await this.access.history.getSavedApiConversationHistory()

			// Tool blocks are always preserved; native tool calling only.

			// if the last message is an assistant message, we need to check if there's tool use since every tool use has to have a tool response
			// if there's no tool use and only a text block, then we can just add a user message
			// (note this isn't relevant anymore since we use custom tool prompts instead of tool use blocks, but this is here for legacy purposes in case users resume old tasks)

			// if the last message is a user message, we can need to get the assistant message before it to see if it made tool calls, and if so, fill in the remaining tool responses with 'interrupted'

			let modifiedOldUserContent: Anthropic.Messages.ContentBlockParam[] // either the last message if its user message, or the user message before the last (assistant) message
			let modifiedApiConversationHistory: ApiMessage[] // need to remove the last user message to replace with new modified user message
			if (existingApiConversationHistory.length > 0) {
				const lastMessage = existingApiConversationHistory[existingApiConversationHistory.length - 1]

				if (lastMessage.isSummary) {
					// IMPORTANT: If the last message is a condensation summary, we must preserve it
					// intact. The summary message carries critical metadata (isSummary, condenseId)
					// that getEffectiveApiHistory() uses to filter out condensed messages.
					// Removing or merging it would destroy this metadata, causing all condensed
					// messages to become "orphaned" and restored to active status — effectively
					// undoing the condensation and sending the full history to the API.
					// See: https://github.com/RooCodeInc/Roo-Code/issues/11487
					modifiedApiConversationHistory = [...existingApiConversationHistory]
					modifiedOldUserContent = []
				} else if (lastMessage.role === "assistant") {
					const content = Array.isArray(lastMessage.content)
						? lastMessage.content
						: [{ type: "text", text: lastMessage.content }]
					const hasToolUse = content.some((block) => block.type === "tool_use")

					if (hasToolUse) {
						const toolUseBlocks = content.filter(
							(block) => block.type === "tool_use",
						) as Anthropic.Messages.ToolUseBlock[]
						const toolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks.map((block) => ({
							type: "tool_result",
							tool_use_id: block.id,
							content: "Task was interrupted before this tool call could be completed.",
						}))
						modifiedApiConversationHistory = [...existingApiConversationHistory] // no changes
						modifiedOldUserContent = [...toolResponses]
					} else {
						modifiedApiConversationHistory = [...existingApiConversationHistory]
						modifiedOldUserContent = []
					}
				} else if (lastMessage.role === "user") {
					const previousAssistantMessage: ApiMessage | undefined =
						existingApiConversationHistory[existingApiConversationHistory.length - 2]

					const existingUserContent: Anthropic.Messages.ContentBlockParam[] = Array.isArray(
						lastMessage.content,
					)
						? lastMessage.content
						: [{ type: "text", text: lastMessage.content }]
					if (previousAssistantMessage && previousAssistantMessage.role === "assistant") {
						const assistantContent = Array.isArray(previousAssistantMessage.content)
							? previousAssistantMessage.content
							: [{ type: "text", text: previousAssistantMessage.content }]

						const toolUseBlocks = assistantContent.filter(
							(block) => block.type === "tool_use",
						) as Anthropic.Messages.ToolUseBlock[]

						if (toolUseBlocks.length > 0) {
							const existingToolResults = existingUserContent.filter(
								(block) => block.type === "tool_result",
							) as Anthropic.ToolResultBlockParam[]

							const missingToolResponses: Anthropic.ToolResultBlockParam[] = toolUseBlocks
								.filter(
									(toolUse) =>
										!existingToolResults.some((result) => result.tool_use_id === toolUse.id),
								)
								.map((toolUse) => ({
									type: "tool_result",
									tool_use_id: toolUse.id,
									content: "Task was interrupted before this tool call could be completed.",
								}))

							modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1) // removes the last user message
							modifiedOldUserContent = [...existingUserContent, ...missingToolResponses]
						} else {
							modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
							modifiedOldUserContent = [...existingUserContent]
						}
					} else {
						modifiedApiConversationHistory = existingApiConversationHistory.slice(0, -1)
						modifiedOldUserContent = [...existingUserContent]
					}
				} else {
					throw new Error("Unexpected: Last message is not a user or assistant message")
				}
			} else {
				throw new Error("Unexpected: No existing API conversation history")
			}

			let newUserContent: Anthropic.Messages.ContentBlockParam[] = [...modifiedOldUserContent]

			const agoText = ((): string => {
				const timestamp = lastClineMessage?.ts ?? Date.now()
				const now = Date.now()
				const diff = now - timestamp
				const minutes = Math.floor(diff / 60000)
				const hours = Math.floor(minutes / 60)
				const days = Math.floor(hours / 24)

				if (days > 0) {
					return `${days} day${days > 1 ? "s" : ""} ago`
				}
				if (hours > 0) {
					return `${hours} hour${hours > 1 ? "s" : ""} ago`
				}
				if (minutes > 0) {
					return `${minutes} minute${minutes > 1 ? "s" : ""} ago`
				}
				return "just now"
			})()

			if (responseText) {
				newUserContent.push({
					type: "text",
					text: `<user_message>\n${responseText}\n</user_message>`,
				})
			}

			if (responseImages && responseImages.length > 0) {
				newUserContent.push(...formatResponse.imageBlocks(responseImages))
			}

			// Ensure we have at least some content to send to the API.
			// If newUserContent is empty, add a minimal resumption message.
			if (newUserContent.length === 0) {
				newUserContent.push({
					type: "text",
					text: "[TASK RESUMPTION] Resuming task...",
				})
			}

			await this.access.history.overwriteApiConversationHistory(modifiedApiConversationHistory)

			// Task resuming from history item.
			await this.access.initiateTaskLoop(newUserContent)
		} catch (error) {
			// Resume and cancellation can race when users issue repeated cancels.
			// Treat intentional abort/abandon flows as expected and avoid process-level crashes.
			if (
				this.access.abandoned === true ||
				this.access.abort === true ||
				this.access.abortReason === "user_cancelled"
			) {
				return
			}
			throw error
		}
	}

	/**
	 * Cancels the current HTTP request if one is in progress.
	 * This immediately aborts the underlying stream rather than waiting for the next chunk.
	 *
	 * @param destroyClient - If true, tells the provider to destroy its client to sever connections.
	 *                        This is useful for local models that may continue inference even after abort.
	 */
	cancelCurrentRequest(destroyClient: boolean = false): void {
		if (this.access.currentRequestAbortController) {
			console.log(`[Task#${this.access.taskId}.${this.access.instanceId}] Aborting current HTTP request`)
			this.access.currentRequestAbortController.abort()
			this.access.currentRequestAbortController = undefined
		}

		// Tell the API provider to cancel its request and optionally destroy its client
		if (this.access.api.cancelRequest) {
			this.access.api.cancelRequest(destroyClient)
		}
	}

	/**
	 * Abort the task, stopping any running operations and cleaning up.
	 *
	 * @param isAbandoned - If true, marks the task as abandoned (different from user-cancelled)
	 */
	async abortTask(isAbandoned = false): Promise<void> {
		// Aborting task

		// Will stop any autonomously running promises.
		if (isAbandoned) {
			this.access.abandoned = true
		}

		this.access.abort = true

		// Reset consecutive error counters on abort (manual intervention)
		this.access.consecutiveNoToolUseCount = 0
		this.access.consecutiveNoAssistantMessagesCount = 0

		// Force final token usage update before abort event
		this.access.emitFinalTokenUsageUpdate()

		this.access.emit(RooCodeEventName.TaskAborted)

		try {
			this.dispose() // Call the centralized dispose method
		} catch (error) {
			console.error(`Error during task ${this.access.taskId}.${this.access.instanceId} disposal:`, error)
			// Don't rethrow - we want abort to always succeed
		}
		// Save the countdown message in the automatic retry or other content.
		try {
			// Save the countdown message in the automatic retry or other content.
			await this.access.history.saveClineMessages()
		} catch (error) {
			console.error(
				`Error saving messages during abort for task ${this.access.taskId}.${this.access.instanceId}:`,
				error,
			)
		}
	}

	/**
	 * Dispose of all task resources, cleaning up terminals, listeners, and controllers.
	 * This is the centralized cleanup method called on abort and task completion.
	 */
	dispose(): void {
		console.log(`[Task#dispose] disposing task ${this.access.taskId}.${this.access.instanceId}`)

		// Cancel any in-progress HTTP request
		try {
			this.access.cancelCurrentRequest()
		} catch (error) {
			console.error("Error cancelling current request:", error)
		}

		// Remove provider profile change listener
		try {
			if (this.access.providerProfileChangeListener) {
				const provider = this.access.providerRef.deref()
				if (provider) {
					provider.off(RooCodeEventName.ProviderProfileChanged, this.access.providerProfileChangeListener)
				}
				this.access.providerProfileChangeListener = undefined
			}
		} catch (error) {
			console.error("Error removing provider profile change listener:", error)
		}

		// Dispose message queue and remove event listeners.
		try {
			if (this.access.messageQueueStateChangedHandler) {
				this.access.messageQueueService.removeListener(
					"stateChanged",
					this.access.messageQueueStateChangedHandler,
				)
				this.access.messageQueueStateChangedHandler = undefined
			}

			this.access.messageQueueService.dispose()
		} catch (error) {
			console.error("Error disposing message queue:", error)
		}

		// Remove all event listeners to prevent memory leaks.
		try {
			// Note: We cannot call removeAllListeners directly through the access interface
			// The Task itself handles this via its EventEmitter inheritance
		} catch (error) {
			console.error("Error removing event listeners:", error)
		}

		// Release any terminals associated with this task.
		try {
			// Release any terminals associated with this task.
			TerminalRegistry.releaseTerminalsForTask(this.access.taskId)
		} catch (error) {
			console.error("Error releasing terminals:", error)
		}

		// Cleanup command output artifacts
		getTaskDirectoryPath(this.access.globalStoragePath, this.access.taskId)
			.then((taskDir) => {
				const outputDir = path.join(taskDir, "command-output")
				return OutputInterceptor.cleanup(outputDir)
			})
			.catch((error) => {
				console.error("Error cleaning up command output artifacts:", error)
			})

		try {
			if (this.access.rooIgnoreController) {
				this.access.rooIgnoreController.dispose()
				this.access.rooIgnoreController = undefined
			}
		} catch (error) {
			console.error("Error disposing RooIgnoreController:", error)
			// This is the critical one for the leak fix.
		}

		try {
			this.access.fileContextTracker.dispose()
		} catch (error) {
			console.error("Error disposing file context tracker:", error)
		}

		try {
			// If we're not streaming then `abortStream` won't be called.
			if (this.access.isStreaming && this.access.diffViewProvider.isEditing) {
				this.access.diffViewProvider.revertChanges().catch(console.error)
			}
		} catch (error) {
			console.error("Error reverting diff changes:", error)
		}
	}
}
