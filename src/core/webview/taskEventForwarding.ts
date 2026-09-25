import { RooCodeEventName, type TaskEvents, type TaskLike } from "@roo-code/types"

import type { SubagentRegistry } from "./SubagentRegistry"

/** The task events a provider re-emits as its own (CORE-R6 f). */
type ForwardedTaskEvent =
	| RooCodeEventName.TaskStarted
	| RooCodeEventName.TaskCompleted
	| RooCodeEventName.TaskAborted
	| RooCodeEventName.TaskFocused
	| RooCodeEventName.TaskUnfocused
	| RooCodeEventName.TaskActive
	| RooCodeEventName.TaskInteractive
	| RooCodeEventName.TaskResumable
	| RooCodeEventName.TaskIdle
	| RooCodeEventName.TaskPaused
	| RooCodeEventName.TaskUnpaused
	| RooCodeEventName.TaskSpawned
	| RooCodeEventName.TaskUserMessage
	| RooCodeEventName.TaskTokenUsageUpdated

/** What the forwarding needs from a task: its id and its event emitter. */
export type TaskEventSource = Pick<TaskLike, "taskId" | "on" | "off">

/** What the forwarding needs from the provider. */
export interface TaskEventForwardingHost {
	emit(event: RooCodeEventName, ...args: unknown[]): void
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
	[RooCodeEventName.TaskStarted]: withTaskId(RooCodeEventName.TaskStarted),
	[RooCodeEventName.TaskCompleted]: (host) => (taskId, tokenUsage, toolUsage) => {
		host.subagentRegistry.markTerminal(taskId, "completed")
		host.emit(RooCodeEventName.TaskCompleted, taskId, tokenUsage, toolUsage)
	},
	[RooCodeEventName.TaskAborted]: (host, task) => async () => {
		// Generic "failed"; RunParallelTasksTool refines to "cancelled"
		// when the abort turns out to be a fan-out cancellation.
		host.subagentRegistry.markTerminal(task.taskId, "failed")
		host.emit(RooCodeEventName.TaskAborted, task.taskId)
		await host.rehydrateAfterStreamingFailure(task)
	},
	[RooCodeEventName.TaskFocused]: withTaskId(RooCodeEventName.TaskFocused),
	[RooCodeEventName.TaskUnfocused]: withTaskId(RooCodeEventName.TaskUnfocused),
	[RooCodeEventName.TaskActive]: (host) => (taskId) => {
		host.subagentRegistry.setLiveStatus(taskId, "running")
		host.emit(RooCodeEventName.TaskActive, taskId)
	},
	[RooCodeEventName.TaskInteractive]: (host) => (taskId) => {
		host.subagentRegistry.setLiveStatus(taskId, "awaiting_input")
		host.emit(RooCodeEventName.TaskInteractive, taskId)
	},
	[RooCodeEventName.TaskResumable]: passThrough(RooCodeEventName.TaskResumable),
	[RooCodeEventName.TaskIdle]: passThrough(RooCodeEventName.TaskIdle),
	[RooCodeEventName.TaskPaused]: passThrough(RooCodeEventName.TaskPaused),
	[RooCodeEventName.TaskUnpaused]: passThrough(RooCodeEventName.TaskUnpaused),
	[RooCodeEventName.TaskSpawned]: passThrough(RooCodeEventName.TaskSpawned),
	[RooCodeEventName.TaskUserMessage]: passThrough(RooCodeEventName.TaskUserMessage),
	[RooCodeEventName.TaskTokenUsageUpdated]: (host) => (taskId, tokenUsage, toolUsage) => {
		if (host.subagentRegistry.has(taskId)) {
			host.subagentRegistry.update(taskId, {
				tokensIn: tokenUsage.totalTokensIn,
				tokensOut: tokenUsage.totalTokensOut,
				totalCost: tokenUsage.totalCost,
			})
		}
		host.emit(RooCodeEventName.TaskTokenUsageUpdated, taskId, tokenUsage, toolUsage)
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
