import { z } from "zod"

import { providerNames } from "./provider-settings.js"
import { clineMessageSchema } from "./message.js"

/**
 * TelemetryEventName
 */

export enum TelemetryEventName {
	TASK_CREATED = "Task Created",
	TASK_RESTARTED = "Task Reopened",
	TASK_COMPLETED = "Task Completed",
	TASK_MESSAGE = "Task Message",
	TASK_CONVERSATION_MESSAGE = "Conversation Message",
	LLM_COMPLETION = "LLM Completion",
	EMBEDDING_USAGE = "Embedding Usage",
	MODE_SWITCH = "Mode Switched",
	MODE_SELECTOR_OPENED = "Mode Selector Opened",
	TOOL_USED = "Tool Used",

	CHECKPOINT_CREATED = "Checkpoint Created",
	CHECKPOINT_RESTORED = "Checkpoint Restored",
	CHECKPOINT_DIFFED = "Checkpoint Diffed",

	TAB_SHOWN = "Tab Shown",
	MODE_SETTINGS_CHANGED = "Mode Setting Changed",
	CUSTOM_MODE_CREATED = "Custom Mode Created",

	CONTEXT_CONDENSED = "Context Condensed",
	CONTEXT_MICROCOMPACTED = "Context Microcompacted",
	/**
	 * The deterministic tool-result pruner alone relieved the context pressure,
	 * so NO summary was requested. Deliberately a separate event from
	 * `CONTEXT_CONDENSED`: firing that one for a round where nothing was
	 * condensed would inflate every existing condense count and cost chart.
	 */
	CONTEXT_PRUNED = "Context Pruned",
	SLIDING_WINDOW_TRUNCATION = "Sliding Window Truncation",

	CODE_ACTION_USED = "Code Action Used",
	PROMPT_ENHANCED = "Prompt Enhanced",

	TITLE_BUTTON_CLICKED = "Title Button Clicked",

	AUTHENTICATION_INITIATED = "Authentication Initiated",

	MARKETPLACE_ITEM_INSTALLED = "Marketplace Item Installed",
	MARKETPLACE_ITEM_REMOVED = "Marketplace Item Removed",
	MARKETPLACE_TAB_VIEWED = "Marketplace Tab Viewed",
	MARKETPLACE_INSTALL_BUTTON_CLICKED = "Marketplace Install Button Clicked",

	SHARE_BUTTON_CLICKED = "Share Button Clicked",
	SHARE_ORGANIZATION_CLICKED = "Share Organization Clicked",
	SHARE_PUBLIC_CLICKED = "Share Public Clicked",
	SHARE_CONNECT_TO_CLOUD_CLICKED = "Share Connect To Cloud Clicked",

	ACCOUNT_CONNECT_CLICKED = "Account Connect Clicked",
	ACCOUNT_CONNECT_SUCCESS = "Account Connect Success",
	ACCOUNT_LOGOUT_CLICKED = "Account Logout Clicked",
	ACCOUNT_LOGOUT_SUCCESS = "Account Logout Success",

	SCHEMA_VALIDATION_ERROR = "Schema Validation Error",
	DIFF_APPLICATION_ERROR = "Diff Application Error",
	SHELL_INTEGRATION_ERROR = "Shell Integration Error",
	CONSECUTIVE_MISTAKE_ERROR = "Consecutive Mistake Error",
	CODE_INDEX_ERROR = "Code Index Error",
	MODEL_CACHE_EMPTY_RESPONSE = "Model Cache Empty Response",
	READ_FILE_LEGACY_FORMAT_USED = "Read File Legacy Format Used",
	/**
	 * An `Error` passed to `TelemetryService.captureException`: its name,
	 * message, a shortened stack and its own fields (provider, model, ...).
	 */
	EXCEPTION = "Exception",
}

/**
 * TelemetryProperties
 */

export const staticAppPropertiesSchema = z.object({
	appName: z.string(),
	appVersion: z.string(),
	vscodeVersion: z.string(),
	platform: z.string(),
	editorName: z.string(),
	hostname: z.string().optional(),
})

export type StaticAppProperties = z.infer<typeof staticAppPropertiesSchema>

export const dynamicAppPropertiesSchema = z.object({
	language: z.string(),
	mode: z.string(),
})

export type DynamicAppProperties = z.infer<typeof dynamicAppPropertiesSchema>

export const cloudAppPropertiesSchema = z.object({
	cloudIsAuthenticated: z.boolean().optional(),
})

export type CloudAppProperties = z.infer<typeof cloudAppPropertiesSchema>

export const appPropertiesSchema = z.object({
	...staticAppPropertiesSchema.shape,
	...dynamicAppPropertiesSchema.shape,
	...cloudAppPropertiesSchema.shape,
})

export const taskPropertiesSchema = z.object({
	taskId: z.string().optional(),
	parentTaskId: z.string().optional(),
	apiProvider: z.enum(providerNames).optional(),
	modelId: z.string().optional(),
	diffStrategy: z.string().optional(),
	isSubtask: z.boolean().optional(),
	todos: z
		.object({
			total: z.number(),
			completed: z.number(),
			inProgress: z.number(),
			pending: z.number(),
		})
		.optional(),
})

export type TaskProperties = z.infer<typeof taskPropertiesSchema>

export const gitPropertiesSchema = z.object({
	repositoryUrl: z.string().optional(),
	repositoryName: z.string().optional(),
	defaultBranch: z.string().optional(),
})

export type GitProperties = z.infer<typeof gitPropertiesSchema>

export const telemetryPropertiesSchema = z.object({
	...appPropertiesSchema.shape,
	...taskPropertiesSchema.shape,
	...gitPropertiesSchema.shape,
})

/**
 * Which part of the extension made a completion.
 *
 * Only `task` calls are turns of the conversation. The rest is the machinery
 * around it — summarising the history, rewriting a prompt, ranking memories —
 * which costs real tokens on the same endpoint and used to be reported
 * nowhere. Absent on rows written before this existed, which are all `task`.
 */
export const completionKinds = ["task", "condense", "enhance", "memory"] as const

export const completionKindSchema = z.enum(completionKinds)

export type CompletionKind = z.infer<typeof completionKindSchema>

export type TelemetryProperties = z.infer<typeof telemetryPropertiesSchema>

/**
 * TelemetryEvent
 */

export type TelemetryEvent = {
	event: TelemetryEventName
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	properties?: Record<string, any>
}

/**
 * The properties `TelemetryService.capture` takes for each event with a known
 * shape. The payload is sent exactly as given (key order included), so call
 * sites build it in the order it should be serialized. Events not listed here
 * accept any property record.
 */
export type TelemetryEventPayloads = {
	[TelemetryEventName.TASK_CREATED]: { taskId: string }
	[TelemetryEventName.TASK_RESTARTED]: { taskId: string }
	/**
	 * Extra task-scoped properties may ride along; they override the provider's
	 * ambient ones when the task is no longer current at capture time.
	 */
	[TelemetryEventName.TASK_COMPLETED]: { taskId: string; [key: string]: unknown }
	[TelemetryEventName.TASK_CONVERSATION_MESSAGE]: { taskId: string; source: "user" | "assistant" }
	[TelemetryEventName.LLM_COMPLETION]: {
		/** Absent when no task is open (a prompt enhancement can run without one). */
		taskId?: string
		inputTokens: number
		outputTokens: number
		cacheWriteTokens: number
		cacheReadTokens: number
		cost?: number
		ttftMs?: number
		reasoningChars?: number
		toolCount?: number
		/** Which part of the extension made the call; absent means a task turn. */
		completionKind?: CompletionKind
		/** False when the provider returned no usage block for this call. */
		usageReported?: boolean
		/**
		 * The model that actually answered. Normally filled from the provider's
		 * current task, which is wrong for condensing and prompt enhancement (they
		 * run on their own profile); event properties win over the provider's.
		 */
		modelId?: string
		apiProvider?: string
		/** The mode of the task that made the call, which the provider's current task may not be. */
		mode?: string
	}
	/**
	 * Tokens spent turning code into vectors. Its own event rather than an
	 * LLM completion: indexing is huge input with no output and no cost, and
	 * would bury the conversation totals.
	 */
	[TelemetryEventName.EMBEDDING_USAGE]: {
		promptTokens: number
		totalTokens: number
		modelId?: string
		apiProvider?: string
		source?: string
	}
	[TelemetryEventName.MODE_SWITCH]: { taskId: string; newMode: string }
	[TelemetryEventName.TOOL_USED]: { taskId: string; tool: string }
	[TelemetryEventName.CHECKPOINT_CREATED]: { taskId: string }
	[TelemetryEventName.CHECKPOINT_DIFFED]: { taskId: string }
	[TelemetryEventName.CHECKPOINT_RESTORED]: { taskId: string }
	/**
	 * A condense round that DID call the summarizer. The prune fields describe
	 * the deterministic pre-pass that ran first and was not enough; they are
	 * omitted when no pruning happened, so the event keeps its historical shape.
	 * Rounds the pruner resolved alone are `CONTEXT_PRUNED` instead.
	 */
	[TelemetryEventName.CONTEXT_CONDENSED]: {
		taskId: string
		isAutomaticTrigger: boolean
		usedCustomPrompt?: boolean
		prunedCount?: number
		bytesSaved?: number
		summarySkipped?: boolean
	}
	/** The deterministic pruner alone relieved the context pressure; no summary was requested. */
	[TelemetryEventName.CONTEXT_PRUNED]: { taskId: string; prunedCount: number; bytesSaved: number }
	[TelemetryEventName.SLIDING_WINDOW_TRUNCATION]: { taskId: string }
	/**
	 * A microcompaction pass. `reclaimRatio` is the share of the pre-pass
	 * context it gave back, the primary signal for the selection policy.
	 */
	[TelemetryEventName.CONTEXT_MICROCOMPACTED]: {
		taskId: string
		candidates: number
		cleared: number
		protectedResults: number
		releasedProtected: number
		tokensCleared: number
		prevContextTokens: number
		reclaimRatio: number
	}
	[TelemetryEventName.CODE_ACTION_USED]: { actionType: string }
	[TelemetryEventName.PROMPT_ENHANCED]: { taskId?: string }
	/** `error` is the formatted zod error (`ZodError.format()`). */
	[TelemetryEventName.SCHEMA_VALIDATION_ERROR]: { schemaName: string; error: unknown }
	[TelemetryEventName.DIFF_APPLICATION_ERROR]: { taskId: string; consecutiveMistakeCount: number }
	[TelemetryEventName.SHELL_INTEGRATION_ERROR]: { taskId: string }
	[TelemetryEventName.CONSECUTIVE_MISTAKE_ERROR]: { taskId: string }
	[TelemetryEventName.TAB_SHOWN]: { tab: string }
	[TelemetryEventName.MODE_SETTINGS_CHANGED]: { settingName: string }
	[TelemetryEventName.CUSTOM_MODE_CREATED]: { modeSlug: string; modeName: string }
	/** Extra properties such as hasParameters or installationMethodName may follow. */
	[TelemetryEventName.MARKETPLACE_ITEM_INSTALLED]: {
		itemId: string
		itemType: string
		itemName: string
		target: string
		[key: string]: unknown
	}
	[TelemetryEventName.MARKETPLACE_ITEM_REMOVED]: {
		itemId: string
		itemType: string
		itemName: string
		target: string
	}
	[TelemetryEventName.TITLE_BUTTON_CLICKED]: { button: string }
}

/**
 * The argument list after the event name in `TelemetryService.capture`:
 * required typed properties for events in `TelemetryEventPayloads`, an
 * optional free-form record for the rest.
 */
export type TelemetryCaptureArgs<E extends TelemetryEventName> = E extends keyof TelemetryEventPayloads
	? [properties: TelemetryEventPayloads[E]]
	: [properties?: Record<string, unknown>]

/**
 * TumbleCodeTelemetryEvent
 */

/**
 * The events whose properties have a dedicated schema below. Every other
 * `TelemetryEventName` member is validated with the generic property schema,
 * so adding an event to the enum is enough for it to be accepted.
 */
const eventsWithDedicatedSchema = [
	TelemetryEventName.TASK_MESSAGE,
	TelemetryEventName.LLM_COMPLETION,
	TelemetryEventName.EMBEDDING_USAGE,
] as const

type GenericTelemetryEventName = Exclude<TelemetryEventName, (typeof eventsWithDedicatedSchema)[number]>

const genericTelemetryEventNames = Object.values(TelemetryEventName).filter(
	(event): event is GenericTelemetryEventName =>
		!(eventsWithDedicatedSchema as readonly TelemetryEventName[]).includes(event),
) as [GenericTelemetryEventName, ...GenericTelemetryEventName[]]

export const tumbleCodeTelemetryEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.enum(genericTelemetryEventNames),
		// The event's own properties (the tool name, where an error happened)
		// ride along: without them a "Tool Used" or "Code Index Error" row in
		// the cloud is only a count.
		properties: telemetryPropertiesSchema.passthrough(),
	}),
	z.object({
		type: z.literal(TelemetryEventName.TASK_MESSAGE),
		properties: z.object({
			...telemetryPropertiesSchema.shape,
			taskId: z.string(),
			message: clineMessageSchema,
		}),
	}),
	z.object({
		type: z.literal(TelemetryEventName.LLM_COMPLETION),
		properties: z.object({
			...telemetryPropertiesSchema.shape,
			inputTokens: z.number(),
			outputTokens: z.number(),
			cacheReadTokens: z.number().optional(),
			cacheWriteTokens: z.number().optional(),
			cost: z.number().optional(),
			ttftMs: z.number().optional(),
			reasoningChars: z.number().optional(),
			toolCount: z.number().optional(),
			completionKind: completionKindSchema.optional(),
			usageReported: z.boolean().optional(),
		}),
	}),
	z.object({
		type: z.literal(TelemetryEventName.EMBEDDING_USAGE),
		properties: z.object({
			...telemetryPropertiesSchema.shape,
			promptTokens: z.number(),
			totalTokens: z.number(),
			// The embedder's name ("openai-compatible", "ollama", ...), not a chat
			// provider: the shared enum rejected every event from those embedders.
			apiProvider: z.string().optional(),
			source: z.string().optional(),
		}),
	}),
])

/**
 * TelemetryEventSubscription
 */

export type TelemetryEventSubscription =
	| { type: "include"; events: TelemetryEventName[] }
	| { type: "exclude"; events: TelemetryEventName[] }

/**
 * TelemetryPropertiesProvider
 */

export interface TelemetryPropertiesProvider {
	/**
	 * @param taskId The task the event is about, when it names one. It can be
	 *   another task than the current one (a parallel subagent runs in the
	 *   background), and the task's lineage (`parentTaskId`, `isSubtask`) must
	 *   then be that task's, not the current task's.
	 */
	getTelemetryProperties(taskId?: string): Promise<TelemetryProperties>
	/**
	 * Absolute path of the active workspace folder (worktree root). Sent
	 * explicitly with backfill uploads so the cloud web view can attribute an
	 * offline task to its project/worktree. Optional: not every provider exposes
	 * a workspace.
	 */
	getTelemetryWorkspacePath?(): string | undefined
}

/**
 * TelemetryClient
 */

export interface TelemetryClient {
	subscription?: TelemetryEventSubscription

	setProvider(provider: TelemetryPropertiesProvider): void
	capture(options: TelemetryEvent): Promise<void>
	captureException(error: Error, additionalProperties?: Record<string, unknown>): Promise<void>
	isTelemetryEnabled(): boolean
	shutdown(): Promise<void>
}

/**
 * Generic API provider error class for structured error tracking.
 * Can be reused by any API provider.
 */
export class ApiProviderError extends Error {
	constructor(
		message: string,
		public readonly provider: string,
		public readonly modelId: string,
		public readonly operation: string,
		public readonly errorCode?: number,
	) {
		super(message)
		this.name = "ApiProviderError"
	}
}

/**
 * Reason why the consecutive mistake limit was reached.
 */
export type ConsecutiveMistakeReason = "no_tools_used" | "tool_repetition" | "unknown"

/**
 * Error class for "Roo is having trouble" consecutive mistake scenarios.
 * Triggered when the task reaches the configured consecutive mistake limit.
 * Used for structured exception tracking.
 */
export class ConsecutiveMistakeError extends Error {
	constructor(
		message: string,
		public readonly taskId: string,
		public readonly consecutiveMistakeCount: number,
		public readonly consecutiveMistakeLimit: number,
		public readonly reason: ConsecutiveMistakeReason = "unknown",
		public readonly provider?: string,
		public readonly modelId?: string,
	) {
		super(message)
		this.name = "ConsecutiveMistakeError"
	}
}
