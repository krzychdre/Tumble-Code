import { RooCodeEventName, type ClineMessage, type RooCodeAPI } from "@roo-code/types"

type WaitForOptions = {
	timeout?: number
	interval?: number
}

export const waitFor = (
	condition: (() => Promise<boolean>) | (() => boolean),
	{ timeout = 30_000, interval = 250 }: WaitForOptions = {},
) => {
	let timeoutId: NodeJS.Timeout | undefined = undefined

	return Promise.race([
		new Promise<void>((resolve) => {
			const check = async () => {
				const result = condition()
				const isSatisfied = result instanceof Promise ? await result : result

				if (isSatisfied) {
					if (timeoutId) {
						clearTimeout(timeoutId)
						timeoutId = undefined
					}

					resolve()
				} else {
					setTimeout(check, interval)
				}
			}

			check()
		}),
		new Promise((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(new Error(`Timeout after ${Math.floor(timeout / 1000)}s`))
			}, timeout)
		}),
	])
}

type WaitUntilAbortedOptions = WaitForOptions & {
	api: RooCodeAPI
	taskId: string
}

export const waitUntilAborted = async ({ api, taskId, ...options }: WaitUntilAbortedOptions) => {
	const set = new Set<string>()
	api.on(RooCodeEventName.TaskAborted, (taskId) => set.add(taskId))
	await waitFor(() => set.has(taskId), options)
}

type WaitUntilCompletedOptions = WaitForOptions & {
	api: RooCodeAPI
	taskId: string
}

/**
 * Resolves when the task has finished its work.
 *
 * A top-level task that calls attempt_completion does NOT emit `TaskCompleted`
 * by itself: it says the result, then waits on a `completion_result` ask, and
 * `TaskCompleted` fires only when that ask is answered with "yes" (the CLI does
 * that; the VS Code chat never does, its button starts a new task instead).
 * Nothing answers the ask in these tests, so the task's own
 * `completion_result` ask counts as completion too. A subtask handing its
 * result back to its parent still emits `TaskCompleted` directly.
 */
export const waitUntilCompleted = async ({ api, taskId, ...options }: WaitUntilCompletedOptions) => {
	const set = new Set<string>()
	const onCompleted = (id: string) => set.add(id)
	const onMessage = ({ taskId: id, message }: { taskId: string; message: ClineMessage }) => {
		if (message.type === "ask" && message.ask === "completion_result" && message.partial !== true) {
			set.add(id)
		}
	}

	api.on(RooCodeEventName.TaskCompleted, onCompleted)
	api.on(RooCodeEventName.Message, onMessage)

	try {
		await waitFor(() => set.has(taskId), options)
	} finally {
		api.off(RooCodeEventName.TaskCompleted, onCompleted)
		api.off(RooCodeEventName.Message, onMessage)
	}
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
