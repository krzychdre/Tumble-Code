import { execa, ExecaError } from "execa"
import psTree from "ps-tree"
import process from "process"

import type { ExitCodeDetails, RooTerminal } from "./types"
import { BaseTerminal } from "./BaseTerminal"
import { BaseTerminalProcess } from "./BaseTerminalProcess"
import { AskpassServer } from "./askpass/AskpassServer"
import { promptForSecret } from "./askpass/promptForSecret"
import { getUtf8LocaleEnv } from "./localeEnv"

// On POSIX the command gets its own session (setsid), so it has no controlling
// terminal. Without it, `git`, `ssh` and `sudo` open /dev/tty by path to ask for
// credentials, which bypasses `stdin: "ignore"` entirely: the prompt is printed
// over whatever the CLI has drawn and the command then blocks forever, while the
// keyboard is split between it and the CLI's own reader.
// Not on Windows, where `detached` means "open a new console window" instead.
const USE_OWN_SESSION = process.platform !== "win32"

// Group-kill every command still running when the process exits. Detached
// children no longer get SIGHUP when the user's terminal closes, so without this
// a long-running command would outlive the CLI.
const runningProcessGroups = new Set<number>()
let exitHandlerRegistered = false

function killProcessGroup(pgid: number, signal: NodeJS.Signals): boolean {
	try {
		process.kill(-pgid, signal)
		return true
	} catch (e) {
		// ESRCH simply means the group is already gone.
		return false
	}
}

function trackProcessGroup(pgid: number) {
	runningProcessGroups.add(pgid)

	if (!exitHandlerRegistered) {
		exitHandlerRegistered = true

		process.once("exit", () => {
			for (const group of runningProcessGroups) {
				killProcessGroup(group, "SIGKILL")
			}
		})
	}
}

export class ExecaTerminalProcess extends BaseTerminalProcess {
	private terminalRef: WeakRef<RooTerminal>
	private aborted = false
	// Set once the command's output stream has ended. From then on there is no
	// "rest of the line" still to come, so getUnretrievedOutput() hands out a
	// trailing partial line too instead of holding it back forever.
	private outputEnded = false
	private pid?: number
	// The shell's own pid, kept separately because `pid` above is later
	// overwritten with the first child. Negative-signalling this one reaches the
	// whole process group in a single call.
	private pgid?: number
	private subprocess?: ReturnType<typeof execa>
	private pidUpdatePromise?: Promise<void>
	private askpassServer?: AskpassServer

	constructor(terminal: RooTerminal) {
		super()

		this.terminalRef = new WeakRef(terminal)

		this.once("completed", () => {
			this.terminal.busy = false
		})
	}

	public get terminal(): RooTerminal {
		const terminal = this.terminalRef.deref()

		if (!terminal) {
			throw new Error("Unable to dereference terminal")
		}

		return terminal
	}

	public override async run(command: string) {
		this.command = command
		let exitDetails: ExitCodeDetails

		try {
			this.isHot = true

			// The command has no terminal to prompt on, so give it somewhere else
			// to ask: git, ssh and sudo run this helper and take its answer, which
			// the host collects from the user.
			let askpassEnv: Record<string, string> = {}

			if (USE_OWN_SESSION) {
				this.askpassServer = new AskpassServer(command, promptForSecret)
				askpassEnv = await this.askpassServer.start()
			}

			this.subprocess = execa({
				shell: BaseTerminal.getExecaShellPath() || true,
				cwd: this.terminal.getCurrentWorkingDirectory(),
				all: true,
				// Closing stdin is not enough on its own: a command that wants
				// credentials reads /dev/tty, not fd 0. USE_OWN_SESSION is what
				// actually takes that door away.
				stdin: "ignore",
				detached: USE_OWN_SESSION,
				env: {
					...process.env,
					// Keep a UTF-8 host locale (e.g. pl_PL.UTF-8); only a non-UTF-8 host gets
					// en_US.UTF-8, so Ruby, CocoaPods, etc. still emit UTF-8.
					...getUtf8LocaleEnv(process.env),
					// Fail with a sentence the model can act on instead of the
					// bare ENXIO that opening a missing /dev/tty produces.
					GIT_TERMINAL_PROMPT: "0",
					// Without this, ssh falls back to an X11 askpass dialog when
					// DISPLAY is set, and the command waits on a window the user
					// may never see. The bridge below replaces it with "force",
					// pointing at a helper we control.
					SSH_ASKPASS_REQUIRE: "never",
					// A pager would block on the terminal that is now gone.
					PAGER: "cat",
					GIT_PAGER: "cat",
					...askpassEnv,
				},
			})`${command}`

			this.pid = this.subprocess.pid
			this.pgid = this.subprocess.pid

			if (USE_OWN_SESSION && this.pgid) {
				trackProcessGroup(this.pgid)
			}

			// When using shell: true, the PID is for the shell, not the actual command
			// Find the actual command PID after a small delay
			if (this.pid) {
				this.pidUpdatePromise = new Promise<void>((resolve) => {
					setTimeout(() => {
						psTree(this.pid!, (err, children) => {
							if (!err && children.length > 0) {
								// Update PID to the first child (the actual command)
								const actualPid = parseInt(children[0].PID)
								if (!isNaN(actualPid)) {
									this.pid = actualPid
								}
							}
							resolve()
						})
					}, 100)
				})
			}

			const rawStream = this.subprocess.iterable({ from: "all", preserveNewlines: true })

			// Wrap the stream to ensure all chunks are strings (execa can return Uint8Array)
			const stream = (async function* () {
				for await (const chunk of rawStream) {
					yield typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
				}
			})()

			this.terminal.setActiveStream(stream, this.pid)

			for await (const line of stream) {
				if (this.aborted) {
					break
				}

				this.fullOutput += line

				const now = Date.now()

				if (this.isListening && (now - this.lastEmitTime_ms > 500 || this.lastEmitTime_ms === 0)) {
					this.emitRemainingBufferIfListening()
					this.lastEmitTime_ms = now
				}

				this.startHotTimer(line)
			}

			if (this.aborted) {
				let timeoutId: NodeJS.Timeout | undefined

				const kill = new Promise<void>((resolve) => {
					console.log(`[ExecaTerminalProcess#run] SIGKILL -> ${this.pid}`)

					timeoutId = setTimeout(() => {
						try {
							this.subprocess?.kill("SIGKILL")
						} catch (e) {}

						resolve()
					}, 5_000)
				})

				try {
					await Promise.race([this.subprocess, kill])
				} catch (error) {
					console.log(
						`[ExecaTerminalProcess#run] subprocess termination error: ${error instanceof Error ? error.message : String(error)}`,
					)
				}

				if (timeoutId) {
					clearTimeout(timeoutId)
				}
			}

			exitDetails = { exitCode: 0 }
		} catch (error) {
			if (error instanceof ExecaError) {
				console.error(`[ExecaTerminalProcess#run] shell execution error: ${error.message}`)
				exitDetails = { exitCode: error.exitCode ?? 0, signalName: error.signal }
			} else {
				console.error(
					`[ExecaTerminalProcess#run] shell execution error: ${error instanceof Error ? error.message : String(error)}`,
				)

				exitDetails = { exitCode: 1 }
			}
			this.subprocess = undefined
		}

		if (this.pgid) {
			runningProcessGroups.delete(this.pgid)
		}

		// Takes the socket and the helper with it, so the token that was in the
		// command's environment stops being usable the moment the command ends.
		if (this.askpassServer) {
			const server = this.askpassServer
			this.askpassServer = undefined
			await server.dispose()
		}

		this.terminal.setActiveStream(undefined)
		this.outputEnded = true
		// Hand a foreground caller everything first, so only output nobody has
		// seen yet (a command moved to the background) is left to be queued.
		this.emitRemainingBufferIfListening()
		this.stopHotTimer()
		this.completeShellExecution(exitDetails)
		this.emit("completed", this.fullOutput)
		this.emit("continue")
		this.subprocess = undefined
	}

	/**
	 * Goes through the terminal, like the VS Code backend does from
	 * TerminalRegistry, so the terminal's bookkeeping is updated: busy and
	 * running cleared, the process detached, and a process with output the model
	 * has not seen yet queued for getEnvironmentDetails. Emitting
	 * shell_execution_complete directly skipped all of that, so a command moved
	 * to the background never reported its remaining output or its end.
	 */
	private completeShellExecution(exitDetails: ExitCodeDetails) {
		const terminal = this.terminalRef.deref()

		if (terminal && terminal.process === this) {
			terminal.shellExecutionComplete(exitDetails)
		} else {
			this.emit("shell_execution_complete", exitDetails)
		}
	}

	public override continue() {
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	public override abort() {
		this.aborted = true

		// With its own session the shell is a process group leader, so one
		// negative signal reaches the shell and every descendant, including the
		// ones psTree would miss because they were spawned after its walk
		// started. This needs no pid lookup, so it runs now rather than behind
		// the pidUpdatePromise delay below.
		if (USE_OWN_SESSION && this.pgid) {
			killProcessGroup(this.pgid, "SIGKILL")
			runningProcessGroups.delete(this.pgid)
		}

		// Function to perform the kill operations
		const performKill = () => {
			// Try to kill using the subprocess object
			if (this.subprocess) {
				try {
					this.subprocess.kill("SIGKILL")
				} catch (e) {
					console.warn(
						`[ExecaTerminalProcess#abort] Failed to kill subprocess: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			}

			// Kill the stored PID (which should be the actual command after our update)
			if (this.pid) {
				try {
					process.kill(this.pid, "SIGKILL")
				} catch (e) {
					console.warn(
						`[ExecaTerminalProcess#abort] Failed to kill process ${this.pid}: ${e instanceof Error ? e.message : String(e)}`,
					)
				}
			}
		}

		// If PID update is in progress, wait for it before killing
		if (this.pidUpdatePromise) {
			this.pidUpdatePromise.then(performKill).catch(() => performKill())
		} else {
			performKill()
		}

		// Continue with the rest of the abort logic
		if (this.pid) {
			// Also check for any child processes
			psTree(this.pid, async (err, children) => {
				if (!err) {
					const pids = children.map((p) => parseInt(p.PID))

					for (const pid of pids) {
						try {
							process.kill(pid, "SIGKILL")
						} catch (e) {
							console.warn(
								`[ExecaTerminalProcess#abort] Failed to send SIGKILL to child PID ${pid}: ${e instanceof Error ? e.message : String(e)}`,
							)
						}
					}
				} else {
					console.error(
						`[ExecaTerminalProcess#abort] Failed to get process tree for PID ${this.pid}: ${err.message}`,
					)
				}
			})
		}
	}

	public override hasUnretrievedOutput() {
		return this.lastRetrievedIndex < this.fullOutput.length
	}

	public override getUnretrievedOutput() {
		let output = this.fullOutput.slice(this.lastRetrievedIndex)

		if (this.outputEnded) {
			this.lastRetrievedIndex = this.fullOutput.length
			return output
		}

		let index = output.lastIndexOf("\n")

		if (index === -1) {
			return ""
		}

		index++
		this.lastRetrievedIndex += index

		// console.log(
		// 	`[ExecaTerminalProcess#getUnretrievedOutput] fullOutput.length=${this.fullOutput.length} lastRetrievedIndex=${this.lastRetrievedIndex}`,
		// 	output.slice(0, index),
		// )

		return output.slice(0, index)
	}

	private emitRemainingBufferIfListening() {
		if (!this.isListening) {
			return
		}

		const output = this.getUnretrievedOutput()

		if (output !== "") {
			this.emit("line", output)
		}
	}
}
