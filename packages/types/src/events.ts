import { z } from "zod"

import { clineMessageSchema, queuedMessageSchema, tokenUsageSchema } from "./message.js"
import { toolNamesSchema, toolUsageSchema } from "./tool.js"

/**
 * TumbleCodeEventName
 */

export enum TumbleCodeEventName {
	// Task Provider Lifecycle
	TaskCreated = "taskCreated",

	// Task Lifecycle
	TaskStarted = "taskStarted",
	TaskCompleted = "taskCompleted",
	TaskAborted = "taskAborted",
	TaskFocused = "taskFocused",
	TaskUnfocused = "taskUnfocused",
	TaskActive = "taskActive",
	TaskInteractive = "taskInteractive",
	TaskResumable = "taskResumable",
	TaskIdle = "taskIdle",

	// Subtask Lifecycle
	TaskPaused = "taskPaused",
	TaskUnpaused = "taskUnpaused",
	TaskSpawned = "taskSpawned",
	TaskDelegated = "taskDelegated",
	TaskDelegationCompleted = "taskDelegationCompleted",
	TaskDelegationResumed = "taskDelegationResumed",

	// Task Execution
	Message = "message",
	TaskModeSwitched = "taskModeSwitched",
	TaskAskResponded = "taskAskResponded",
	TaskUserMessage = "taskUserMessage",
	QueuedMessagesUpdated = "queuedMessagesUpdated",

	// Task Analytics
	TaskTokenUsageUpdated = "taskTokenUsageUpdated",
	TaskToolFailed = "taskToolFailed",

	// Configuration Changes
	ModeChanged = "modeChanged",
	ProviderProfileChanged = "providerProfileChanged",

	// Evals
	EvalPass = "evalPass",
	EvalFail = "evalFail",
}

/**
 * TumbleCodeEvents
 */

export const tumbleCodeEventsSchema = z.object({
	[TumbleCodeEventName.TaskCreated]: z.tuple([z.string()]),

	[TumbleCodeEventName.TaskStarted]: z.tuple([z.string()]),
	[TumbleCodeEventName.TaskCompleted]: z.tuple([
		z.string(),
		tokenUsageSchema,
		toolUsageSchema,
		z.object({
			isSubtask: z.boolean(),
		}),
	]),
	[TumbleCodeEventName.TaskAborted]: z.tuple([z.string()]),
	[TumbleCodeEventName.TaskFocused]: z.tuple([z.string()]),
	[TumbleCodeEventName.TaskUnfocused]: z.tuple([z.string()]),
	[TumbleCodeEventName.TaskActive]: z.tuple([z.string()]),
	[TumbleCodeEventName.TaskInteractive]: z.tuple([z.string()]),
	[TumbleCodeEventName.TaskResumable]: z.tuple([z.string()]),
	[TumbleCodeEventName.TaskIdle]: z.tuple([z.string()]),

	[TumbleCodeEventName.TaskPaused]: z.tuple([z.string()]),
	[TumbleCodeEventName.TaskUnpaused]: z.tuple([z.string()]),
	[TumbleCodeEventName.TaskSpawned]: z.tuple([z.string(), z.string()]),
	[TumbleCodeEventName.TaskDelegated]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),
	[TumbleCodeEventName.TaskDelegationCompleted]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
		z.string(), // completionResultSummary
	]),
	[TumbleCodeEventName.TaskDelegationResumed]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),

	[TumbleCodeEventName.Message]: z.tuple([
		z.object({
			taskId: z.string(),
			action: z.union([z.literal("created"), z.literal("updated")]),
			message: clineMessageSchema,
		}),
	]),
	[TumbleCodeEventName.TaskModeSwitched]: z.tuple([z.string(), z.string()]),
	[TumbleCodeEventName.TaskAskResponded]: z.tuple([z.string()]),
	[TumbleCodeEventName.TaskUserMessage]: z.tuple([z.string()]),
	[TumbleCodeEventName.QueuedMessagesUpdated]: z.tuple([z.string(), z.array(queuedMessageSchema)]),

	[TumbleCodeEventName.TaskToolFailed]: z.tuple([z.string(), toolNamesSchema, z.string()]),
	[TumbleCodeEventName.TaskTokenUsageUpdated]: z.tuple([z.string(), tokenUsageSchema, toolUsageSchema]),

	[TumbleCodeEventName.ModeChanged]: z.tuple([z.string()]),
	[TumbleCodeEventName.ProviderProfileChanged]: z.tuple([z.object({ name: z.string(), provider: z.string() })]),
})

export type TumbleCodeEvents = z.infer<typeof tumbleCodeEventsSchema>

/**
 * TaskEvent
 */

export const taskEventSchema = z.discriminatedUnion("eventName", [
	// Task Provider Lifecycle
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskCreated),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskCreated],
		taskId: z.number().optional(),
	}),

	// Task Lifecycle
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskStarted),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskStarted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskCompleted),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskAborted),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskAborted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskFocused),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskFocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskUnfocused),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskUnfocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskActive),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskActive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskInteractive),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskInteractive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskResumable),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskResumable],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskIdle),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskIdle],
		taskId: z.number().optional(),
	}),

	// Subtask Lifecycle
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskPaused),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskPaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskUnpaused),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskUnpaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskSpawned),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskSpawned],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskDelegated),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskDelegated],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskDelegationCompleted),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskDelegationCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskDelegationResumed),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskDelegationResumed],
		taskId: z.number().optional(),
	}),

	// Task Execution
	z.object({
		eventName: z.literal(TumbleCodeEventName.Message),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.Message],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskModeSwitched),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskModeSwitched],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskAskResponded),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskAskResponded],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.QueuedMessagesUpdated),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.QueuedMessagesUpdated],
		taskId: z.number().optional(),
	}),

	// Task Analytics
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskToolFailed),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskToolFailed],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.TaskTokenUsageUpdated),
		payload: tumbleCodeEventsSchema.shape[TumbleCodeEventName.TaskTokenUsageUpdated],
		taskId: z.number().optional(),
	}),

	// Evals
	z.object({
		eventName: z.literal(TumbleCodeEventName.EvalPass),
		payload: z.undefined(),
		taskId: z.number(),
	}),
	z.object({
		eventName: z.literal(TumbleCodeEventName.EvalFail),
		payload: z.undefined(),
		taskId: z.number(),
	}),
])
