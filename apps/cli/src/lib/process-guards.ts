/**
 * Process guards: the one SIGINT/SIGTERM/uncaughtException/unhandledRejection
 * shutdown path for both CLI modes (plan: R6, ai_plans/2026-09-27).
 *
 * Print mode used to install its own four handlers inline in run.ts; the Ink
 * mode installed none, so a crash or `kill` left the terminal in raw mode (no
 * `.unmount()`) and the `--ephemeral` temp storage leaked. Both modes now call
 * `installProcessGuards`, which differs only in the cleanup it passes:
 *
 * - print: dispose the extension host, flush the JSON emitter and stdout;
 * - Ink: unmount the renderer (which restores the terminal), then dispose the
 *   host.
 *
 * The runCleanup callback is idempotent: it runs at most once even when
 * several guards fire together (SIGINT while an uncaughtException shutdown is
 * already in flight), and again on the explicit `dispose()` that ends a normal
 * run — the caller-supplied cleanup must tolerate being called twice.
 */

export interface ProcessGuardsOptions {
	/**
	 * One async cleanup pass per cause: dispose the host, restore the terminal,
	 * flush pending output. The `cause` lets the caller log or branch; guards
	 * never assume the process lives on afterwards.
	 */
	onCleanup: (cause: GuardCause) => void | Promise<unknown>

	/** Optional error sink. In guards, errors must never escape into the handler. */
	onError?: (error: unknown, source: GuardSource) => void

	/**
	 * How long cleanup may take before the process is force-exited, so a hung
	 * `dispose()` cannot keep a crashing process (and a raw-mode terminal)
	 * alive forever. Default 10s; 0 disables the timer (tests).
	 */
	exitTimeoutMs?: number

	/**
	 * Called when a guard has finished cleanup. Default `process.exit(code)`.
	 * Overridden in tests so handlers can be exercised without killing vitest.
	 */
	onExit?: (code: number) => void

	/** Process-like object to install on. Default: the real `process`. */
	target?: ProcessLike
}

export interface ProcessLike {
	on(event: string, listener: (...args: unknown[]) => void): unknown
	off(event: string, listener: (...args: unknown[]) => void): unknown
}

export type GuardCause = GuardSource | "dispose"
export type GuardSource = "SIGINT" | "SIGTERM" | "uncaughtException" | "unhandledRejection"

const SIGNAL_EXIT_CODES: Record<"SIGINT" | "SIGTERM", number> = {
	SIGINT: 130,
	SIGTERM: 143,
}

export const GUARD_EXIT_TIMEOUT_MS = 10_000

/**
 * Install the four process guards. Returns a `dispose` that removes them and
 * runs the cleanup pass one last time — call it on every normal exit path
 * (completion and failure) so cleanup is a shared primitive, not a
 * crash-only path.
 */
export function installProcessGuards({
	onCleanup,
	onError,
	exitTimeoutMs = GUARD_EXIT_TIMEOUT_MS,
	onExit = (code) => process.exit(code),
	target = process,
}: ProcessGuardsOptions): () => Promise<void> {
	let cleanupDone = false
	let exited = false
	let timeoutHandle: NodeJS.Timeout | undefined

	const finish = (code: number) => {
		if (exited) {
			return
		}

		exited = true
		onExit(code)
	}

	const runCleanup = async (cause: GuardCause): Promise<void> => {
		if (cleanupDone) {
			return
		}

		cleanupDone = true

		try {
			await onCleanup(cause)
		} catch (error) {
			// Cleanup must never throw out of a signal or error handler.
			onError?.(error, cause === "dispose" ? "uncaughtException" : cause)
		}
	}

	const exitAfterCleanup = (code: number, cause: GuardCause): void => {
		if (exitTimeoutMs > 0) {
			// Force exit even if cleanup hangs, so a crashing process never
			// keeps the terminal in raw mode forever.
			timeoutHandle = setTimeout(() => finish(code), exitTimeoutMs)
		}

		void runCleanup(cause).finally(() => {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle)
			}

			finish(code)
		})
	}

	const onSigint = () => exitAfterCleanup(SIGNAL_EXIT_CODES.SIGINT, "SIGINT")
	const onSigterm = () => exitAfterCleanup(SIGNAL_EXIT_CODES.SIGTERM, "SIGTERM")

	const onUncaughtException = (error: unknown) => {
		onError?.(error, "uncaughtException")
		exitAfterCleanup(1, "uncaughtException")
	}

	const onUnhandledRejection = (reason: unknown) => {
		onError?.(reason, "unhandledRejection")
		exitAfterCleanup(1, "unhandledRejection")
	}

	target.on("SIGINT", onSigint)
	target.on("SIGTERM", onSigterm)
	target.on("uncaughtException", onUncaughtException)
	target.on("unhandledRejection", onUnhandledRejection)

	return async function dispose(): Promise<void> {
		target.off("SIGINT", onSigint)
		target.off("SIGTERM", onSigterm)
		target.off("uncaughtException", onUncaughtException)
		target.off("unhandledRejection", onUnhandledRejection)
		await runCleanup("dispose")
	}
}
