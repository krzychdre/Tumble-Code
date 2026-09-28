/**
 * Background start of the cloud layer during extension activation (P9).
 *
 * Activation used to await `CloudService.createInstance` before it registered
 * the sidebar webview and the commands, so a slow cloud start (the OS keyring
 * read in the auth service) delayed every command. Activation now hands the
 * start to {@link startCloudInBackground} and goes on; the few places that
 * really need a started cloud ask this module whether it has settled.
 *
 * The timeout does not cancel anything (a cloud start cannot be cancelled):
 * it logs that the start is slow and releases {@link waitForCloudStart}
 * callers, who then see the cloud as unavailable. When the start finishes
 * later, its own continuation still wires the cloud up.
 */

/** How long a background cloud start counts as "starting" before callers stop waiting for it. */
export const CLOUD_START_TIMEOUT_MS = 10_000

interface CloudStart {
	settled: boolean
	timedOut: boolean
	/** Resolves when the start settles (success or failure); never rejects. */
	done: Promise<void>
	/** Resolves when the start settles or the timeout passes, whichever is first. */
	settledOrTimedOut: Promise<void>
}

let current: CloudStart | undefined

/**
 * Runs `start` without blocking the caller. A rejection is logged, never
 * rethrown. Returns a promise that resolves once `start` has settled.
 */
export function startCloudInBackground(
	start: () => Promise<void>,
	log: (message: string) => void,
	timeoutMs: number = CLOUD_START_TIMEOUT_MS,
): Promise<void> {
	let releaseWaiters: () => void = () => {}
	const timeoutReached = new Promise<void>((resolve) => {
		releaseWaiters = resolve
	})

	const state: CloudStart = {
		settled: false,
		timedOut: false,
		done: Promise.resolve(),
		settledOrTimedOut: timeoutReached,
	}

	const timer = setTimeout(() => {
		if (state.settled) {
			return
		}
		state.timedOut = true
		log(
			`[CloudService] still starting after ${Math.round(timeoutMs / 1000)} s; ` +
				"continuing without it, cloud features attach when it finishes",
		)
		releaseWaiters()
	}, timeoutMs)
	// A pending timer must not keep a CLI process alive.
	timer.unref?.()

	state.done = (async () => {
		try {
			await start()
		} catch (error) {
			log(`[CloudService] background start failed: ${error instanceof Error ? error.message : String(error)}`)
		} finally {
			state.settled = true
			clearTimeout(timer)
			releaseWaiters()
		}
	})()

	current = state
	return state.done
}

/** True while a background cloud start has neither settled nor passed its timeout. */
export function isCloudStartPending(): boolean {
	return !!current && !current.settled && !current.timedOut
}

/**
 * Resolves once the background cloud start has settled or passed its timeout;
 * at once when no start is running.
 */
export function waitForCloudStart(): Promise<void> {
	return current ? current.settledOrTimedOut : Promise.resolve()
}
