/** What a subagent asks for when it wants to start. */
export interface SlotRequest {
	/**
	 * How many subagents may run at once in the whole provider: the user's
	 * `parallelTasksMaxConcurrency`, read when the fan-out started.
	 */
	globalLimit: number
}

interface Waiter {
	request: SlotRequest
	grant: (release: () => void) => void
}

/** The error an aborted {@link SubagentSlotPool.acquire} rejects with. */
export class SlotWaitAbortedError extends Error {
	constructor() {
		super("Stopped while waiting for a free subagent slot.")
		this.name = "SlotWaitAbortedError"
	}
}

/**
 * Bounds how many parallel subagents run at once across ALL fan-outs of a
 * provider, so two run_parallel_tasks calls (of one task or of two tasks) do
 * not each get the full cap. A subagent takes a slot before its worktree and
 * its task are created and gives it back when it ends.
 *
 * Waiters are served first in, first out. Each request carries its own
 * limits, so a later branch can add a per-profile limit to {@link SlotRequest}
 * without changing the callers' shape.
 */
export class SubagentSlotPool {
	private runningCount = 0
	private readonly queue: Waiter[] = []

	/** How many subagents hold a slot now. */
	get running(): number {
		return this.runningCount
	}

	/** How many subagents wait for a slot. */
	get waiting(): number {
		return this.queue.length
	}

	/**
	 * Wait for a free slot. Resolves with the function that gives the slot
	 * back (calling it twice is harmless). Rejects with
	 * {@link SlotWaitAbortedError} when `signal` aborts first; the waiter
	 * then leaves the queue.
	 */
	acquire(request: SlotRequest, signal?: AbortSignal): Promise<() => void> {
		if (signal?.aborted) {
			return Promise.reject(new SlotWaitAbortedError())
		}
		return new Promise((resolve, reject) => {
			const onAbort = () => {
				const index = this.queue.indexOf(waiter)
				if (index !== -1) {
					this.queue.splice(index, 1)
					reject(new SlotWaitAbortedError())
				}
			}
			const waiter: Waiter = {
				request,
				grant: (release) => {
					signal?.removeEventListener("abort", onAbort)
					resolve(release)
				},
			}
			signal?.addEventListener("abort", onAbort, { once: true })
			this.queue.push(waiter)
			this.grantFreeSlots()
		})
	}

	/** Hand free slots to the waiters at the head of the queue. */
	private grantFreeSlots(): void {
		while (this.queue.length > 0 && this.fits(this.queue[0].request)) {
			const waiter = this.queue.shift()!
			this.runningCount++
			let released = false
			waiter.grant(() => {
				if (released) return
				released = true
				this.runningCount--
				this.grantFreeSlots()
			})
		}
	}

	private fits(request: SlotRequest): boolean {
		return this.runningCount < Math.max(1, request.globalLimit)
	}
}
