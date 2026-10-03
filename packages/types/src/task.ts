import { z } from "zod"

import { TumbleCodeEventName } from "./events.js"
import type { TumbleCodeSettings } from "./global-settings.js"
import type { ClineMessage, QueuedMessage, TokenUsage } from "./message.js"
import type { ToolUsage, ToolName } from "./tool.js"
import type { StaticAppProperties, GitProperties, TelemetryProperties } from "./telemetry.js"
import type { TodoItem } from "./todo.js"

/**
 * TaskProviderLike
 */

export interface TaskProviderLike {
	// Tasks
	getCurrentTask(): TaskLike | undefined
	createTask(
		text?: string,
		images?: string[],
		parentTask?: TaskLike,
		options?: CreateTaskOptions,
		configuration?: TumbleCodeSettings,
	): Promise<TaskLike>
	cancelTask(): Promise<void>
	clearTask(): Promise<void>
	resumeTask(taskId: string): void

	// Modes
	getModes(): Promise<{ slug: string; name: string }[]>
	getMode(): Promise<string>
	setMode(mode: string): Promise<void>

	// Provider Profiles
	getProviderProfiles(): Promise<{ name: string; provider?: string }[]>
	getProviderProfile(): Promise<string>
	setProviderProfile(providerProfile: string): Promise<void>

	// Telemetry
	readonly appProperties: StaticAppProperties
	readonly gitProperties: GitProperties | undefined
	getTelemetryProperties(taskId?: string): Promise<TelemetryProperties>
	readonly cwd: string

	// Event Emitter
	on<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this

	off<K extends keyof TaskProviderEvents>(
		event: K,
		listener: (...args: TaskProviderEvents[K]) => void | Promise<void>,
	): this

	// @TODO: Find a better way to do this.
	postStateToWebview(): Promise<void>
}

export type TaskProviderEvents = {
	[TumbleCodeEventName.TaskCreated]: [task: TaskLike]
	[TumbleCodeEventName.TaskStarted]: [taskId: string]
	[TumbleCodeEventName.TaskCompleted]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	[TumbleCodeEventName.TaskAborted]: [taskId: string]
	[TumbleCodeEventName.TaskFocused]: [taskId: string]
	[TumbleCodeEventName.TaskUnfocused]: [taskId: string]
	[TumbleCodeEventName.TaskActive]: [taskId: string]
	[TumbleCodeEventName.TaskInteractive]: [taskId: string]
	[TumbleCodeEventName.TaskResumable]: [taskId: string]
	[TumbleCodeEventName.TaskIdle]: [taskId: string]

	[TumbleCodeEventName.TaskPaused]: [taskId: string]
	[TumbleCodeEventName.TaskUnpaused]: [taskId: string]
	[TumbleCodeEventName.TaskSpawned]: [taskId: string]
	[TumbleCodeEventName.TaskDelegated]: [parentTaskId: string, childTaskId: string]
	[TumbleCodeEventName.TaskDelegationCompleted]: [parentTaskId: string, childTaskId: string, summary: string]
	[TumbleCodeEventName.TaskDelegationResumed]: [parentTaskId: string, childTaskId: string]

	[TumbleCodeEventName.TaskUserMessage]: [taskId: string]

	[TumbleCodeEventName.TaskTokenUsageUpdated]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]

	[TumbleCodeEventName.ModeChanged]: [mode: string]
	[TumbleCodeEventName.ProviderProfileChanged]: [config: { name: string; provider?: string }]
}

/**
 * TaskLike
 */

export interface CreateTaskOptions {
	taskId?: string
	enableCheckpoints?: boolean
	consecutiveMistakeLimit?: number
	experiments?: Record<string, boolean>
	initialTodos?: TodoItem[]
	/** Initial status for the task's history item (e.g., "active" for child tasks) */
	initialStatus?: "active" | "delegated" | "completed"
	/** Whether to start the task loop immediately (default: true).
	 *  When false, the caller must invoke `task.start()` manually. */
	startTask?: boolean
	/**
	 * Explicit working directory for the task (e.g. a git worktree). When set and
	 * no `parentTask` is supplied, the task runs against this directory instead of
	 * the opened workspace — the basis for headless background tasks / parallel
	 * subagents in isolated worktrees.
	 */
	workspacePath?: string
}

export enum TaskStatus {
	Running = "running",
	Interactive = "interactive",
	Resumable = "resumable",
	Idle = "idle",
	None = "none",
}

export const taskMetadataSchema = z.object({
	task: z.string().optional(),
	images: z.array(z.string()).optional(),
})

export type TaskMetadata = z.infer<typeof taskMetadataSchema>

export interface TaskLike {
	readonly taskId: string
	readonly rootTaskId?: string
	readonly parentTaskId?: string
	readonly childTaskId?: string
	readonly metadata: TaskMetadata
	readonly taskStatus: TaskStatus
	readonly taskAsk: ClineMessage | undefined
	readonly queuedMessages: QueuedMessage[]
	readonly tokenUsage: TokenUsage | undefined

	on<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this
	off<K extends keyof TaskEvents>(event: K, listener: (...args: TaskEvents[K]) => void | Promise<void>): this

	approveAsk(options?: { text?: string; images?: string[] }): void
	denyAsk(options?: { text?: string; images?: string[] }): void
	submitUserMessage(text: string, images?: string[], mode?: string, providerProfile?: string): Promise<void>
	abortTask(): void
}

export type TaskEvents = {
	// Task Lifecycle
	[TumbleCodeEventName.TaskStarted]: []
	[TumbleCodeEventName.TaskCompleted]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
	[TumbleCodeEventName.TaskAborted]: []
	[TumbleCodeEventName.TaskFocused]: []
	[TumbleCodeEventName.TaskUnfocused]: []
	[TumbleCodeEventName.TaskActive]: [taskId: string]
	[TumbleCodeEventName.TaskInteractive]: [taskId: string]
	[TumbleCodeEventName.TaskResumable]: [taskId: string]
	[TumbleCodeEventName.TaskIdle]: [taskId: string]

	// Subtask Lifecycle
	[TumbleCodeEventName.TaskPaused]: [taskId: string]
	[TumbleCodeEventName.TaskUnpaused]: [taskId: string]
	[TumbleCodeEventName.TaskSpawned]: [taskId: string]

	// Task Execution
	[TumbleCodeEventName.Message]: [{ action: "created" | "updated"; message: ClineMessage }]
	[TumbleCodeEventName.TaskModeSwitched]: [taskId: string, mode: string]
	[TumbleCodeEventName.TaskAskResponded]: []
	[TumbleCodeEventName.TaskUserMessage]: [taskId: string]
	[TumbleCodeEventName.QueuedMessagesUpdated]: [taskId: string, messages: QueuedMessage[]]

	// Task Analytics
	[TumbleCodeEventName.TaskToolFailed]: [taskId: string, tool: ToolName, error: string]
	[TumbleCodeEventName.TaskTokenUsageUpdated]: [taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage]
}
