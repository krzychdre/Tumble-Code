import * as childProcess from "child_process"

/**
 * One place that spawns ripgrep for every caller (search_files, list_files and
 * the @-mention file search), so they share the same limit, timeout, abort and
 * error rules.
 *
 * Error rules follow ripgrep's exit codes: 0 = matches, 1 = no matches,
 * 2 = an error happened. ripgrep also exits 2 when it merely skipped an
 * unreadable file, so exit 2 is only fatal when nothing was printed on stdout.
 * Text on stderr alone (warnings about broken links and the like) never fails a
 * run that exited 0.
 */

/** Default time limit for one ripgrep run. */
export const RIPGREP_DEFAULT_TIMEOUT_MS = 30_000

/** Upper bound on the stderr text kept for error messages. */
const MAX_STDERR_LENGTH = 8_192

export interface RunRipgrepOptions {
	rgPath: string
	args: string[]
	/** Keep at most this many non-empty stdout lines; ripgrep is killed once more arrive. */
	limit?: number
	/** Kill ripgrep and return what it printed so far after this many ms. 0 disables the timer. */
	timeoutMs?: number
	/** Kill ripgrep and return what it printed so far when this signal aborts. */
	signal?: AbortSignal
}

export interface RunRipgrepResult {
	/** Non-empty stdout lines, without line terminators. */
	lines: string[]
	/** ripgrep's exit code, or null when it was killed (limit, timeout, abort). */
	exitCode: number | null
	stderr: string
	limitReached: boolean
	timedOut: boolean
	aborted: boolean
}

export class RipgrepError extends Error {
	constructor(
		message: string,
		readonly exitCode: number | null,
		readonly stderr: string,
	) {
		super(message)
		this.name = "RipgrepError"
	}
}

export function runRipgrep({
	rgPath,
	args,
	limit = Infinity,
	timeoutMs = RIPGREP_DEFAULT_TIMEOUT_MS,
	signal,
}: RunRipgrepOptions): Promise<RunRipgrepResult> {
	return new Promise((resolve, reject) => {
		const lines: string[] = []
		let pending = ""
		let stderr = ""
		let settled = false
		let stopReason: "limit" | "timeout" | "abort" | undefined
		let timer: ReturnType<typeof setTimeout> | undefined

		const result = (exitCode: number | null): RunRipgrepResult => ({
			lines,
			exitCode,
			stderr,
			limitReached: stopReason === "limit",
			timedOut: stopReason === "timeout",
			aborted: stopReason === "abort",
		})

		if (signal?.aborted) {
			stopReason = "abort"
			resolve(result(null))
			return
		}

		const rgProcess = childProcess.spawn(rgPath, args)

		const cleanup = () => {
			if (timer) clearTimeout(timer)
			signal?.removeEventListener("abort", onAbort)
		}

		const addLine = (raw: string): boolean => {
			const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
			if (!line.trim()) return true
			if (lines.length >= limit) {
				stop("limit")
				return false
			}
			lines.push(line)
			return true
		}

		const finish = (exitCode: number | null) => {
			if (settled) return
			if (!stopReason && pending) {
				addLine(pending)
			}
			pending = ""
			settled = true
			cleanup()

			const failed = !stopReason && exitCode !== 0 && exitCode !== 1 && lines.length === 0
			if (failed) {
				const detail = stderr.trim() || "no error output"
				reject(new RipgrepError(`ripgrep exited with code ${exitCode}: ${detail}`, exitCode, stderr))
				return
			}
			resolve(result(exitCode))
		}

		// Stopping on our own terms (limit, timeout, abort) resolves right away with
		// what arrived so far instead of waiting for the killed process to close.
		function stop(reason: "limit" | "timeout" | "abort") {
			if (settled || stopReason) return
			stopReason = reason
			rgProcess.kill()
			finish(null)
		}

		function onAbort() {
			stop("abort")
		}

		// Timer and abort listener go first: the process may already emit
		// (and even finish) while its listeners are being attached.
		if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
			timer = setTimeout(() => stop("timeout"), timeoutMs)
		}
		signal?.addEventListener("abort", onAbort)

		rgProcess.stdout.on("data", (data: Buffer | string) => {
			if (settled) return
			pending += data.toString()
			const parts = pending.split("\n")
			pending = parts.pop() ?? ""
			for (const part of parts) {
				if (!addLine(part)) return
			}
		})

		rgProcess.stderr.on("data", (data: Buffer | string) => {
			if (stderr.length < MAX_STDERR_LENGTH) {
				stderr = (stderr + data.toString()).slice(0, MAX_STDERR_LENGTH)
			}
		})

		rgProcess.on("close", (code: number | null) => finish(code))

		rgProcess.on("error", (error: Error) => {
			if (settled) return
			settled = true
			cleanup()
			reject(new RipgrepError(`ripgrep process error: ${error.message}`, null, stderr))
		})
	})
}
