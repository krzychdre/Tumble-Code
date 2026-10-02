import { TumbleCodeEventName, type TaskEvents, type TaskLike } from "@tumble-code/types"

import type { SubagentRegistry } from "./SubagentRegistry"

/** The task events a provider re-emits as its own (CORE-R6 f). */
type ForwardedTaskEvent =
	| TumbleCodeEventName.TaskStarted
	| TumbleCodeEventName.TaskCompleted
	| TumbleCodeEventName.TaskAborted
	| TumbleCodeEventName.TaskFocused
	| TumbleCodeEventName.TaskUnfocused
	| TumbleCodeEventName.TaskActive
	| TumbleCodeEventName.TaskInteractive
	| TumbleCodeEventName.TaskResumable
	| TumbleCodeEventName.TaskIdle
	| TumbleCodeEventName.TaskPaused
	| TumbleCodeEventName.TaskUnpaused
	| TumbleCodeEventName.TaskSpawned
	| TumbleCodeEventName.TaskUserMessage
	| TumbleCodeEventName.TaskTokenUsageUpdated

/** What the forwarding needs from a task: its id and its event emitter. */
export type TaskEventSource = Pick<TaskLike, "taskId" | "on" | "off">

/** What the forwarding needs from the provider. */
export interface TaskEventForwardingHost {
	emit(event: TumbleCodeEventName, ...args: unknown[]): void
	readonly subagentRegistry: Pick<SubagentRegistry, "markTerminal" | "setLiveStatus" | "has" | "update">
	/** Runs after an abort has been forwarded; the provider decides whether to rehydrate the task. */
	rehydrateAfterStreamingFailure(task: TaskEventSource): Promise<void>
}

type Listener<E extends ForwardedTaskEvent> = (...args: TaskEvents[E]) => void | Promise<void>
type MakeListener<E extends ForwardedTaskEvent> = (host: TaskEventForwardingHost, task: TaskEventSource) => Listener<E>

/** Re-emit an event that carries no arguments with the task's id. */
const withTaskId =
	(event: ForwardedTaskEvent): MakeListener<any> =>
	(host, task) =>
	() =>
		host.emit(event, task.taskId)

/** Re-emit an event with the arguments the task gave it. */
const passThrough =
	(event: ForwardedTaskEvent): MakeListener<any> =>
	(host) =>
	(...args: unknown[]) =>
		host.emit(event, ...args)

/**
 * One row per forwarded event: how to build the listener for one task. The
 * mapped type makes a missing or extra row a compile error, and
 * {@link forwardTaskEvents} attaches and detaches every row, so an event can
 * no longer be attached without its detach.
 */
export const TASK_EVENT_FORWARDING: { readonly [E in ForwardedTaskEvent]: MakeListener<E> } = {
	[TumbleCodeEventName.TaskStarted]: withTaskId(TumbleCodeEventName.TaskStarted),
	[TumbleCodeEventName.TaskCompleted]: (host) => (taskId, tokenUsage, toolUsage) => {
		host.subagentRegistry.markTerminal(taskId, "completed")
		host.emit(TumbleCodeEventName.TaskCompleted, taskId, tokenUsage, toolUsage)
	},
	[TumbleCodeEventName.TaskAborted]: (host, task) => async () => {
		// Generic "failed"; RunParallelTasksTool refines to "cancelled"
		// when the abort turns out to be a fan-out cancellation.
		host.subagentRegistry.markTerminal(task.taskId, "failed")
		host.emit(TumbleCodeEventName.TaskAborted, task.taskId)
		await host.rehydrateAfterStreamingFailure(task)
	},
	[TumbleCodeEventName.TaskFocused]: withTaskId(TumbleCodeEventName.TaskFocused),
	[TumbleCodeEventName.TaskUnfocused]: withTaskId(TumbleCodeEventName.TaskUnfocused),
	[TumbleCodeEventName.TaskActive]: (host) => (taskId) => {
		host.subagentRegistry.setLiveStatus(taskId, "running")
		host.emit(TumbleCodeEventName.TaskActive, taskId)
	},
	[TumbleCodeEventName.TaskInteractive]: (host) => (taskId) => {
		host.subagentRegistry.setLiveStatus(taskId, "awaiting_input")
		host.emit(TumbleCodeEventName.TaskInteractive, taskId)
	},
	[TumbleCodeEventName.TaskResumable]: passThrough(TumbleCodeEventName.TaskResumable),
	[TumbleCodeEventName.TaskIdle]: passThrough(TumbleCodeEventName.TaskIdle),
	[TumbleCodeEventName.TaskPaused]: passThrough(TumbleCodeEventName.TaskPaused),
	[TumbleCodeEventName.TaskUnpaused]: passThrough(TumbleCodeEventName.TaskUnpaused),
	[TumbleCodeEventName.TaskSpawned]: passThrough(TumbleCodeEventName.TaskSpawned),
	[TumbleCodeEventName.TaskUserMessage]: passThrough(TumbleCodeEventName.TaskUserMessage),
	[TumbleCodeEventName.TaskTokenUsageUpdated]: (host) => (taskId, tokenUsage, toolUsage) => {
		if (host.subagentRegistry.has(taskId)) {
			host.subagentRegistry.update(taskId, {
				tokensIn: tokenUsage.totalTokensIn,
				tokensOut: tokenUsage.totalTokensOut,
				totalCost: tokenUsage.totalCost,
			})
		}
		host.emit(TumbleCodeEventName.TaskTokenUsageUpdated, taskId, tokenUsage, toolUsage)
	},
}

/**
 * Attach one listener per row of {@link TASK_EVENT_FORWARDING} to the task.
 * Returns one cleanup per listener; running them all detaches everything.
 */
export function forwardTaskEvents(task: TaskEventSource, host: TaskEventForwardingHost): Array<() => void> {
	return (Object.keys(TASK_EVENT_FORWARDING) as ForwardedTaskEvent[]).map((event) => {
		const listener = (TASK_EVENT_FORWARDING[event] as MakeListener<any>)(host, task)
		task.on(event, listener)
		return () => task.off(event, listener)
	})
}
