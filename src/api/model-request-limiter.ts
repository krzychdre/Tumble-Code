import type { ProviderSettings } from "@tumble-code/types"

import type { ApiHandler, SingleCompletionHandler } from "./index"
import { defaultRuntimeProviderId } from "./runtime-provider-registry"

/** The error a request rejects with when it is stopped while it waits for a slot. */
export class ModelRequestWaitAbortedError extends Error {
	constructor() {
		super("Request stopped while waiting for a free slot of the model.")
		this.name = "ModelRequestWaitAbortedError"
	}
}

interface Waiter {
	limit: number | undefined
	grant: () => void
}

/**
 * Counts the requests in flight per model across the whole extension host
 * (every panel, task, subagent and side query of the process) and makes a
 * request wait while its model already runs `limit` of them.
 *
 * Every request is counted, also one whose profile sets no limit, so a
 * profile with a limit sees the requests other profiles send to the same
 * model. Waiters of a model are served first in, first out among those that
 * fit: a request with a higher limit may pass one with a lower limit.
 */
class ModelRequestLimiter {
	private readonly running = new Map<string, number>()
	private readonly queues = new Map<string, Waiter[]>()

	/**
	 * Wait until `model` runs fewer than `limit` requests (unset = no limit)
	 * and take a slot. Resolves with the function that gives it back (calling
	 * it twice is harmless). Rejects with {@link ModelRequestWaitAbortedError}
	 * when `signal` aborts first.
	 */
	acquire(model: string, limit: number | undefined, signal?: AbortSignal): Promise<() => void> {
		if (signal?.aborted) {
			return Promise.reject(new ModelRequestWaitAbortedError())
		}
		return new Promise((resolve, reject) => {
			const queue = this.queues.get(model) ?? []
			this.queues.set(model, queue)
			const onAbort = () => {
				const index = queue.indexOf(waiter)
				if (index !== -1) {
					queue.splice(index, 1)
					this.dropEmptyQueue(model)
					reject(new ModelRequestWaitAbortedError())
				}
			}
			const waiter: Waiter = {
				limit,
				grant: () => {
					signal?.removeEventListener("abort", onAbort)
					let released = false
					resolve(() => {
						if (released) return
						released = true
						this.running.set(model, this.runningFor(model) - 1)
						this.grantFreeSlots(model)
					})
				},
			}
			signal?.addEventListener("abort", onAbort, { once: true })
			queue.push(waiter)
			this.grantFreeSlots(model)
		})
	}

	private grantFreeSlots(model: string): void {
		const queue = this.queues.get(model) ?? []
		for (let i = 0; i < queue.length;) {
			const { limit, grant } = queue[i]
			if (limit !== undefined && this.runningFor(model) >= limit) {
				i++
				continue
			}
			queue.splice(i, 1)
			this.running.set(model, this.runningFor(model) + 1)
			grant()
		}
		this.dropEmptyQueue(model)
		if (this.runningFor(model) === 0) {
			this.running.delete(model)
		}
	}

	private runningFor(model: string): number {
		return this.running.get(model) ?? 0
	}

	private dropEmptyQueue(model: string): void {
		if (this.queues.get(model)?.length === 0) {
			this.queues.delete(model)
		}
	}
}

/** The one limiter of the process: buildApiHandler routes every handler through it. */
const modelRequestLimiter = new ModelRequestLimiter()

/** The model a profile's requests count against: provider and model id. */
function modelRequestKey(configuration: ProviderSettings, handler: ApiHandler): string {
	return `${configuration.apiProvider ?? defaultRuntimeProviderId}:${handler.getModel().id}`
}

/**
 * Make every request of `handler` take a slot of its model for as long as it runs, bounded by the profile's `maxConcurrentRequests`.
 *
 * `completePrompt` calls `completePromptWithUsage` in every provider that
 * has both, so only the latter is wrapped there: wrapping both would take
 * two slots for one request and, with a limit of 1, wait for itself.
 */
export function limitModelRequests(
	handler: ApiHandler & Partial<SingleCompletionHandler>,
	configuration: ProviderSettings,
): void {
	const limit = configuration.maxConcurrentRequests
	const acquire = (signal?: AbortSignal) =>
		modelRequestLimiter.acquire(modelRequestKey(configuration, handler), limit, signal)

	const createMessage = handler.createMessage.bind(handler)
	handler.createMessage = async function* (systemPrompt, messages, metadata) {
		const release = await acquire(metadata?.signal)
		try {
			yield* createMessage(systemPrompt, messages, metadata)
		} finally {
			release()
		}
	}

	const withSlot =
		<A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
		async (...args: A): Promise<R> => {
			const release = await acquire()
			try {
				return await call(...args)
			} finally {
				release()
			}
		}
	if (handler.completePromptWithUsage) {
		handler.completePromptWithUsage = withSlot(handler.completePromptWithUsage.bind(handler))
	} else if (handler.completePrompt) {
		handler.completePrompt = withSlot(handler.completePrompt.bind(handler))
	}
}
