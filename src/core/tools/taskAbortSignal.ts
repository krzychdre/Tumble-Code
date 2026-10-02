import { TumbleCodeEventName } from "@tumble-code/types"

import type { Task } from "../task/Task"

/**
 * Runs `run` with an AbortSignal that fires when the task aborts (the Stop
 * button, a task switch, closing the panel). Use it for a tool's long await
 * that has its own cancellation, such as an MCP request: the work is
 * cancelled at once instead of running on until its own timeout.
 *
 * Every abort sets `task.abort` and then emits `TaskAborted`
 * (`TaskLifecycle.prepareAbort`), so the listener covers an abort that
 * happens during the await, and the flag check covers one that already
 * happened before it started. The listener is removed when `run` settles.
 */
export async function runWithTaskAbortSignal<T>(task: Task, run: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
	const controller = new AbortController()
	const onAborted = () => controller.abort(new Error("Task aborted"))

	if (task.abort) {
		onAborted()
	} else {
		task.once(TumbleCodeEventName.TaskAborted, onAborted)
	}

	try {
		return await run(controller.signal)
	} finally {
		task.off(TumbleCodeEventName.TaskAborted, onAborted)
	}
}
