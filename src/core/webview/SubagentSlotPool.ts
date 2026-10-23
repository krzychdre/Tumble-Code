/** What a subagent asks for when it wants to start. */
export interface SlotRequest {
	/**
	 * How many subagents may run at once in the whole provider: the user's
	 * `parallelTasksMaxConcurrency`, read when the fan-out started.
	 */
	globalLimit: number
	/** The profile the subagent runs on, see {@link profileLimit}. */
	profileKey: string
	/**
	 * How many subagents may run at once on `profileKey`: the profile's
	 * `maxConcurrentRequests` less the parent's own request (see
	 * subagentSlotsForProfile). Unset = no per-profile cap.
	 */
	profileLimit?: number
	/** The run_parallel_tasks call the subagent belongs to, see {@link fanOutLimit}. */
	fanOutKey: string
	/** How many subagents of `fanOutKey` may run at once: the call's `maxConcurrency`. */
	fanOutLimit: number
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
 * A request also carries a per-profile limit (the profile's
 * `maxConcurrentRequests`), so subagents on a server that takes few requests
 * at once wait while subagents on other profiles still start, and the
 * per-call limit of its run_parallel_tasks call.
 *
 * Waiters are served first in, first out among those that fit: a waiter
 * blocked by its profile's limit does not hold up a waiter on another profile.
 */
export class SubagentSlotPool {
	private runningCount = 0
	private readonly runningByProfile = new Map<string, number>()
	private readonly runningByFanOut = new Map<string, number>()
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
		for (let i = 0; i < this.queue.length;) {
			const { request, grant } = this.queue[i]
			if (!this.fits(request)) {
				i++
				continue
			}
			this.queue.splice(i, 1)
			this.take(request, +1)
			let released = false
			grant(() => {
				if (released) return
				released = true
				this.take(request, -1)
				this.grantFreeSlots()
			})
		}
	}

	private take(request: SlotRequest, delta: 1 | -1): void {
		this.runningCount += delta
		addCount(this.runningByProfile, request.profileKey, delta)
		addCount(this.runningByFanOut, request.fanOutKey, delta)
	}

	private fits(request: SlotRequest): boolean {
		if (this.runningCount >= Math.max(1, request.globalLimit)) {
			return false
		}
		if ((this.runningByFanOut.get(request.fanOutKey) ?? 0) >= request.fanOutLimit) {
			return false
		}
		return (
			request.profileLimit === undefined ||
			(this.runningByProfile.get(request.profileKey) ?? 0) < request.profileLimit
		)
	}
}

/** Add `delta` to the count under `key`; a count that drops to 0 leaves the map. */
function addCount(counts: Map<string, number>, key: string, delta: number): void {
	const next = (counts.get(key) ?? 0) + delta
	if (next === 0) {
		counts.delete(key)
	} else {
		counts.set(key, next)
	}
}
