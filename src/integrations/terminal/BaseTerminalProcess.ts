import { EventEmitter } from "events"

import type { RooTerminalProcess, RooTerminalProcessEvents, ExitCodeDetails } from "./types"

/**
 * How often a running command hands its new output to the "line" listener, for
 * every terminal backend. It matches the rate at which ExecuteCommandTool
 * publishes partial command_output messages (it imports this constant), so the
 * producer is neither faster than its consumer (work thrown away) nor slower
 * (added latency). The backends used to disagree: 100 ms for the VS Code
 * terminal and 500 ms for Execa, which made the CLI's live output visibly
 * choppier than the extension's.
 */
export const TERMINAL_OUTPUT_THROTTLE_MS = 150

/**
 * The part of a terminal process that must behave the same whatever runs the
 * command: the output buffer and what has been handed out of it, the throttled
 * "line" events, continue() and the end of a run. Subclasses feed output in
 * with appendOutput() and end a run with finishRun(); the contract spec
 * (__tests__/TerminalCompletionContract.spec.ts) runs one set of cases
 * against every backend.
 */
export abstract class BaseTerminalProcess extends EventEmitter<RooTerminalProcessEvents> implements RooTerminalProcess {
	public command: string = ""

	public isHot: boolean = false
	protected hotTimer: NodeJS.Timeout | null = null

	protected isListening: boolean = true
	protected lastEmitTime_ms: number = 0
	protected fullOutput: string = ""
	protected lastRetrievedIndex: number = 0
	// Trailing edge of the throttle: output that arrived inside the window is
	// handed out when the window closes, not when the command next prints.
	private pendingEmitTimer: NodeJS.Timeout | undefined

	static interpretExitCode(exitCode: number | undefined): ExitCodeDetails {
		if (exitCode === undefined) {
			return { exitCode }
		}

		if (exitCode <= 128) {
			return { exitCode }
		}

		const signal = exitCode - 128

		const signals: Record<number, string> = {
			// Standard signals
			1: "SIGHUP",
			2: "SIGINT",
			3: "SIGQUIT",
			4: "SIGILL",
			5: "SIGTRAP",
			6: "SIGABRT",
			7: "SIGBUS",
			8: "SIGFPE",
			9: "SIGKILL",
			10: "SIGUSR1",
			11: "SIGSEGV",
			12: "SIGUSR2",
			13: "SIGPIPE",
			14: "SIGALRM",
			15: "SIGTERM",
			16: "SIGSTKFLT",
			17: "SIGCHLD",
			18: "SIGCONT",
			19: "SIGSTOP",
			20: "SIGTSTP",
			21: "SIGTTIN",
			22: "SIGTTOU",
			23: "SIGURG",
			24: "SIGXCPU",
			25: "SIGXFSZ",
			26: "SIGVTALRM",
			27: "SIGPROF",
			28: "SIGWINCH",
			29: "SIGIO",
			30: "SIGPWR",
			31: "SIGSYS",

			// Real-time signals base
			34: "SIGRTMIN",

			// SIGRTMIN+n signals
			35: "SIGRTMIN+1",
			36: "SIGRTMIN+2",
			37: "SIGRTMIN+3",
			38: "SIGRTMIN+4",
			39: "SIGRTMIN+5",
			40: "SIGRTMIN+6",
			41: "SIGRTMIN+7",
			42: "SIGRTMIN+8",
			43: "SIGRTMIN+9",
			44: "SIGRTMIN+10",
			45: "SIGRTMIN+11",
			46: "SIGRTMIN+12",
			47: "SIGRTMIN+13",
			48: "SIGRTMIN+14",
			49: "SIGRTMIN+15",

			// SIGRTMAX-n signals
			50: "SIGRTMAX-14",
			51: "SIGRTMAX-13",
			52: "SIGRTMAX-12",
			53: "SIGRTMAX-11",
			54: "SIGRTMAX-10",
			55: "SIGRTMAX-9",
			56: "SIGRTMAX-8",
			57: "SIGRTMAX-7",
			58: "SIGRTMAX-6",
			59: "SIGRTMAX-5",
			60: "SIGRTMAX-4",
			61: "SIGRTMAX-3",
			62: "SIGRTMAX-2",
			63: "SIGRTMAX-1",
			64: "SIGRTMAX",
		}

		// These signals may produce core dumps:
		//   SIGQUIT, SIGILL, SIGABRT, SIGBUS, SIGFPE, SIGSEGV
		const coreDumpPossible = new Set([3, 4, 6, 7, 8, 11])

		return {
			exitCode,
			signal,
			signalName: signals[signal] || `Unknown Signal (${signal})`,
			coreDumpPossible: coreDumpPossible.has(signal),
		}
	}

	/**
	 * Runs a shell command.
	 * @param command The command to run
	 */
	abstract run(command: string): Promise<void>

	/**
	 * Stops the command: Ctrl+C for the VS Code terminal, a group kill for Execa.
	 * Must work after continue() too (the user timeout and task cancellation
	 * abort commands that were moved to the background).
	 */
	abstract abort(): void

	/**
	 * Whether the command's output is complete, so a trailing partial line can
	 * be handed out instead of being held back for the rest of the line.
	 */
	protected abstract isOutputEnded(): boolean

	/**
	 * Where, in output not handed out yet, the command's own output ends
	 * because a backend marker follows (-1 when there is none).
	 */
	protected findOutputEnd(_pending: string): number {
		return -1
	}

	/**
	 * Turns a slice of the raw buffer into what callers see.
	 */
	protected cleanOutput(output: string): string {
		return output
	}

	/**
	 * Moves the command to the background: the caller is released, the
	 * command keeps running, and output it prints from now on is left for
	 * getEnvironmentDetails. Complete lines already received are handed to the
	 * caller first, because it reports them as "output so far".
	 */
	public continue(): void {
		this.emitRemainingBufferIfListening()
		this.cancelPendingEmit()
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	/**
	 * Checks if this process has unretrieved output.
	 * @returns true if there is output that hasn't been fully retrieved yet
	 */
	public hasUnretrievedOutput(): boolean {
		return this.lastRetrievedIndex < this.fullOutput.length
	}

	/**
	 * Returns complete lines with their carriage returns.
	 * The final line may lack a carriage return if the program didn't send one;
	 * it is only handed out once the output has ended (or a backend end marker
	 * follows it).
	 * @returns The unretrieved output
	 */
	public getUnretrievedOutput(): string {
		const pending = this.fullOutput.slice(this.lastRetrievedIndex)
		let endIndex = this.findOutputEnd(pending)

		if (endIndex === -1) {
			if (this.isOutputEnded()) {
				endIndex = pending.length
			} else {
				endIndex = pending.lastIndexOf("\n")

				if (endIndex === -1) {
					return ""
				}

				// Include the line feed.
				endIndex++
			}
		}

		this.lastRetrievedIndex += endIndex
		return this.cleanOutput(pending.slice(0, endIndex))
	}

	/**
	 * Clears the internal output buffer when all content has been retrieved.
	 *
	 * This prevents unbounded memory growth when processing large
	 * command outputs by discarding data that has already been
	 * consumed by callers of `getUnretrievedOutput`.
	 *
	 * Called after command completion when `lastRetrievedIndex` has been
	 * set to `fullOutput.length` to indicate all output has been processed.
	 */
	public trimRetrievedOutput(): void {
		if (this.lastRetrievedIndex >= this.fullOutput.length && this.fullOutput.length > 0) {
			this.fullOutput = ""
			this.lastRetrievedIndex = 0
		}
	}

	/**
	 * Adds a chunk of the command's output to the buffer and hands new complete
	 * lines to the "line" listener, at most once per TERMINAL_OUTPUT_THROTTLE_MS.
	 */
	protected appendOutput(data: string): void {
		this.fullOutput += data
		this.scheduleEmit()
		this.startHotTimer(data)
	}

	protected scheduleEmit(): void {
		if (!this.isListening) {
			return
		}

		const now = Date.now()
		const elapsed = now - this.lastEmitTime_ms

		if (this.lastEmitTime_ms === 0 || elapsed >= TERMINAL_OUTPUT_THROTTLE_MS) {
			this.cancelPendingEmit()
			this.emitRemainingBufferIfListening()
			this.lastEmitTime_ms = now
			return
		}

		if (!this.pendingEmitTimer) {
			this.pendingEmitTimer = setTimeout(() => {
				this.pendingEmitTimer = undefined
				this.lastEmitTime_ms = Date.now()

				try {
					this.emitRemainingBufferIfListening()
				} catch (error) {
					// A timer callback has no caller to throw to.
					console.error("[BaseTerminalProcess] failed to emit buffered output:", error)
				}
			}, TERMINAL_OUTPUT_THROTTLE_MS - elapsed)
		}
	}

	private cancelPendingEmit(): void {
		if (this.pendingEmitTimer) {
			clearTimeout(this.pendingEmitTimer)
			this.pendingEmitTimer = undefined
		}
	}

	protected emitRemainingBufferIfListening(): void {
		if (!this.isListening) {
			return
		}

		const output = this.getUnretrievedOutput()

		if (output !== "") {
			this.emit("line", output)
		}
	}

	/**
	 * Hands a foreground caller everything it has not seen yet and stops the
	 * throttle and the hot timer. The first half of ending a run; call it once
	 * the output has ended, before reporting the exit.
	 */
	protected flushOutput(): void {
		this.cancelPendingEmit()
		this.emitRemainingBufferIfListening()
		this.stopHotTimer()
	}

	/**
	 * The second half of ending a run: report the output and release the
	 * caller. Every backend ends a run with flushOutput(), then its exit
	 * report, then this.
	 */
	protected finishRun(output: string | undefined): void {
		this.emit("completed", output)
		this.emit("continue")
	}

	protected startHotTimer(data: string) {
		this.isHot = true

		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}

		this.hotTimer = setTimeout(() => (this.isHot = false), BaseTerminalProcess.isCompiling(data) ? 15_000 : 2_000)
	}

	protected stopHotTimer() {
		if (this.hotTimer) {
			clearTimeout(this.hotTimer)
		}

		this.isHot = false
	}

	// These markers indicate the command is some kind of local dev
	// server recompiling the app, which we want to wait for output
	// of before sending request to Roo Code.
	private static compilingMarkers = ["compiling", "building", "bundling", "transpiling", "generating", "starting"]

	private static compilingMarkerNullifiers = [
		"compiled",
		"success",
		"finish",
		"complete",
		"succeed",
		"done",
		"end",
		"stop",
		"exit",
		"terminate",
		"error",
		"fail",
	]

	private static isCompiling(data: string): boolean {
		return (
			BaseTerminalProcess.compilingMarkers.some((marker) => data.toLowerCase().includes(marker.toLowerCase())) &&
			!BaseTerminalProcess.compilingMarkerNullifiers.some((nullifier) =>
				data.toLowerCase().includes(nullifier.toLowerCase()),
			)
		)
	}
}
