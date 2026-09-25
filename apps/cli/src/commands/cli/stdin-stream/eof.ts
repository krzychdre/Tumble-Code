import type { ExtensionHost } from "@/agent/index.js"

// ---------------------------------------------------------------------------
// The end of stdin: wait for the active task, or fail when it cannot go on.
// ---------------------------------------------------------------------------

const STDIN_EOF_RESUME_WAIT_TIMEOUT_MS = 2_000
const STDIN_EOF_POLL_INTERVAL_MS = 100
// The idle asks of a finished task. The other idle asks (a failed request,
// the mistake or request limit) wait for a decision, so EOF does not end on them.
const STDIN_EOF_IDLE_ASKS: ReadonlySet<string> = new Set(["completion_result", "resume_completed_task"])
const STDIN_EOF_IDLE_STABLE_POLLS = 2
// Asks a started task can rest on that runTask never settles on (it settles
// on completion_result or resume_completed_task). Once stdin is gone nobody
// answers them unless the CLI's own ask dispatcher does so right away.
const STDIN_EOF_STUCK_ASKS: ReadonlySet<string> = new Set([
	"api_req_failed",
	"mistake_limit_reached",
	"auto_approval_max_req_reached",
])

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function getStuckAsk(host: ExtensionHost): string | undefined {
	if (!host.client.hasActiveTask() || !host.isWaitingForInput()) {
		return undefined
	}

	const currentAsk = host.client.getCurrentAsk()
	return typeof currentAsk === "string" && STDIN_EOF_STUCK_ASKS.has(currentAsk) ? currentAsk : undefined
}

/**
 * Wait for the task started in this stream after stdin closed. Fails when the
 * task rests on an ask nobody will answer, the way the no-run-promise path
 * does, instead of waiting forever.
 */
export async function waitForStartedTaskAfterStdinClosed(
	host: ExtensionHost,
	taskPromise: Promise<void>,
): Promise<void> {
	let settled = false
	const settledPromise = taskPromise.finally(() => {
		settled = true
	})

	const watchForStuckAsk = async (): Promise<void> => {
		while (!settled) {
			await sleep(STDIN_EOF_POLL_INTERVAL_MS)
			const stuckAsk = getStuckAsk(host)

			if (!stuckAsk) {
				continue
			}

			const deadline = Date.now() + STDIN_EOF_RESUME_WAIT_TIMEOUT_MS

			while (!settled && Date.now() < deadline && getStuckAsk(host) === stuckAsk) {
				await sleep(STDIN_EOF_POLL_INTERVAL_MS)
			}

			if (!settled && getStuckAsk(host) === stuckAsk) {
				throw new Error(`stdin ended while task was waiting for input (${stuckAsk})`)
			}
		}
	}

	await Promise.race([settledPromise, watchForStuckAsk()])
}

export async function waitForTaskProgressAfterStdinClosed(
	host: ExtensionHost,
	getQueueState: () => { hasSeenQueueState: boolean; queueDepth: number },
): Promise<void> {
	while (host.client.hasActiveTask()) {
		if (!host.isWaitingForInput()) {
			await new Promise((resolve) => setTimeout(resolve, STDIN_EOF_POLL_INTERVAL_MS))
			continue
		}

		const deadline = Date.now() + STDIN_EOF_RESUME_WAIT_TIMEOUT_MS

		while (Date.now() < deadline) {
			if (!host.client.hasActiveTask() || !host.isWaitingForInput()) {
				break
			}

			await new Promise((resolve) => setTimeout(resolve, STDIN_EOF_POLL_INTERVAL_MS))
		}

		if (host.client.hasActiveTask() && host.isWaitingForInput()) {
			const currentAsk = host.client.getCurrentAsk()
			const { hasSeenQueueState, queueDepth } = getQueueState()

			// EOF is allowed when the task has reached an idle completion boundary and
			// there is no queued user input waiting to be processed.
			if (
				hasSeenQueueState &&
				queueDepth === 0 &&
				typeof currentAsk === "string" &&
				STDIN_EOF_IDLE_ASKS.has(currentAsk)
			) {
				let isStable = true
				for (let i = 1; i < STDIN_EOF_IDLE_STABLE_POLLS; i++) {
					await new Promise((resolve) => setTimeout(resolve, STDIN_EOF_POLL_INTERVAL_MS))

					if (!host.client.hasActiveTask() || !host.isWaitingForInput()) {
						isStable = false
						break
					}

					const nextAsk = host.client.getCurrentAsk()
					const nextQueueState = getQueueState()
					if (
						nextAsk !== currentAsk ||
						!nextQueueState.hasSeenQueueState ||
						nextQueueState.queueDepth !== 0
					) {
						isStable = false
						break
					}
				}

				if (isStable) {
					return
				}
			}

			throw new Error(`stdin ended while task was waiting for input (${currentAsk ?? "unknown"})`)
		}
	}
}
