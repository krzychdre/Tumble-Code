// cd src && ./node_modules/.bin/vitest run integrations/terminal/__tests__/TerminalCompletionContract.spec.ts
//
// One contract, two terminal backends. The model learns about commands that
// were moved to the background ("Proceed while running", or the agent timeout)
// only through the terminal bookkeeping read by getEnvironmentDetails:
// `busy`, `process`, and the completed-process queue behind
// `getProcessesWithOutput()`. Both backends must keep that bookkeeping the same
// way, and both must actually stop a command when it is aborted after it was
// moved to the background.
//
// The Execa backend runs real shell commands. The VS Code backend runs the same
// commands through a fake vscode.Terminal whose shell integration spawns the
// command for real, streams its stdout, turns Ctrl+C into SIGINT for the
// command's process group (what a real pty does), and reports the end of the
// execution the way TerminalRegistry's onDidEndTerminalShellExecution handler
// does: by calling terminal.shellExecutionComplete().

import { spawn, type ChildProcess } from "child_process"
import * as os from "os"

import type * as vscode from "vscode"

import type { ExitCodeDetails, RooTerminal, RooTerminalCallbacks, RooTerminalProcessResultPromise } from "../types"
import { ExecaTerminal } from "../ExecaTerminal"
import { Terminal } from "../Terminal"
import { TerminalProcess } from "../TerminalProcess"

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

function deferred<T = void>(): Deferred<T> {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((r) => (resolve = r))
	return { promise, resolve }
}

async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	let timer: NodeJS.Timeout | undefined

	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${what}`)), ms)
	})

	try {
		return await Promise.race([promise, timeout])
	} finally {
		clearTimeout(timer)
	}
}

/** Resolves once `condition` holds, checking every 5 ms; rejects after `ms`. */
async function until(condition: () => boolean, ms: number, what: string): Promise<void> {
	const deadline = Date.now() + ms

	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error(`timed out after ${ms} ms waiting for ${what}`)
		}

		await new Promise((resolve) => setTimeout(resolve, 5))
	}
}

const spawnedChildren = new Set<ChildProcess>()

function createVscodeTerminal(id: number, cwd: string): RooTerminal {
	let child: ChildProcess | undefined

	// The fake below must exist before the Terminal it wraps, but its close
	// handler needs the Terminal; a const holder breaks that cycle.
	const terminalRef: { instance?: Terminal } = {}

	const fake = {
		name: "Roo Code",
		processId: Promise.resolve(1),
		creationOptions: {},
		exitStatus: undefined,
		state: { isInteractedWith: true },
		dispose: () => {},
		hide: () => {},
		show: () => {},
		sendText: (text: string) => {
			// A pty turns Ctrl+C into SIGINT for the foreground process group.
			if (text === "\x03" && child?.pid && child.exitCode === null && child.signalCode === null) {
				try {
					process.kill(-child.pid, "SIGINT")
				} catch {
					// Already gone.
				}
			}
		},
		shellIntegration: {
			cwd: undefined,
			executeCommand: (commandLine: string) => {
				const spawned = spawn("/bin/sh", ["-c", commandLine], {
					cwd,
					detached: true,
					stdio: ["ignore", "pipe", "ignore"],
				})

				child = spawned
				spawnedChildren.add(spawned)

				spawned.once("close", (code, signal) => {
					spawnedChildren.delete(spawned)
					const exitCode = code ?? 128 + (signal ? os.constants.signals[signal] : 0)
					// What TerminalRegistry does on onDidEndTerminalShellExecution.
					terminalRef.instance?.shellExecutionComplete(TerminalProcess.interpretExitCode(exitCode))
				})

				const stdout = spawned.stdout!

				return {
					commandLine: { value: commandLine },
					read: () =>
						(async function* () {
							for await (const chunk of stdout) {
								yield chunk.toString()
							}
						})(),
				}
			},
		},
	}

	const rooTerminal = new Terminal(id, fake as unknown as vscode.Terminal, cwd)
	terminalRef.instance = rooTerminal
	return rooTerminal
}

// Real processes: allow for a slow CI machine.
vi.setConfig({ testTimeout: 15_000 })

let nextId = 1000

const backends = [
	{ name: "execa", create: (cwd: string): RooTerminal => new ExecaTerminal(nextId++, cwd) },
	{ name: "vscode", create: (cwd: string): RooTerminal => createVscodeTerminal(nextId++, cwd) },
]

function startCommand(terminal: RooTerminal, command: string, firstLineMarker?: string) {
	const firstLine = deferred()
	const completed = deferred<string | undefined>()
	const shellComplete = deferred<ExitCodeDetails>()
	let seen = ""

	const callbacks: RooTerminalCallbacks = {
		onLine: (line) => {
			seen += line

			if (firstLineMarker && seen.includes(firstLineMarker)) {
				firstLine.resolve()
			}
		},
		onCompleted: (output) => completed.resolve(output),
		onShellExecutionStarted: () => {},
		onShellExecutionComplete: (details) => shellComplete.resolve(details),
	}

	const proc: RooTerminalProcessResultPromise = terminal.runCommand(command, callbacks)

	return { proc, firstLine: firstLine.promise, completed: completed.promise, shellComplete: shellComplete.promise }
}

describe.skipIf(process.platform === "win32").each(backends)(
	"terminal completion contract: $name backend",
	(backend) => {
		afterEach(() => {
			for (const child of spawnedChildren) {
				try {
					process.kill(-child.pid!, "SIGKILL")
				} catch {
					// Already gone.
				}
			}

			spawnedChildren.clear()
		})

		it("a command moved to the background lands in the completed-process queue with its late output", async () => {
			const terminal = backend.create(os.tmpdir())
			const command = "echo early; sleep 0.5; echo late"
			const { proc, firstLine, completed, shellComplete } = startCommand(terminal, command, "early")

			await within(firstLine, 5_000, "the first line")

			// "Proceed while running": the tool call returns, the command keeps going.
			proc.continue()
			await within(proc, 1_000, "continue() to release the caller")

			expect(terminal.busy).toBe(true)

			await within(shellComplete, 5_000, "the shell execution to complete")
			await within(completed, 5_000, "the completed event")

			// The finished process, with the output the model has not seen yet, is
			// where getEnvironmentDetails looks for it ("Inactive Terminals with
			// Completed Process Output")...
			const queued = terminal.getProcessesWithOutput()
			expect(queued).toHaveLength(1)
			expect(queued[0]).toBe(proc)
			expect(queued[0].command).toBe(command)
			expect(terminal.getLastCommand()).toBe(command)

			const unseen = queued[0].getUnretrievedOutput()
			expect(unseen).toContain("late")
			expect(unseen).not.toContain("early")

			// Once read, it drops out of the queue.
			expect(terminal.getProcessesWithOutput()).toHaveLength(0)

			// ...and the terminal is idle and no longer points at the finished process.
			expect(terminal.busy).toBe(false)
			expect(terminal.process).toBeUndefined()
		})

		it("a foreground command whose output has no trailing newline leaves nothing behind in the queue", async () => {
			const terminal = backend.create(os.tmpdir())
			const { proc, completed, shellComplete } = startCommand(terminal, "printf 'no newline at the end'")

			await within(proc, 5_000, "the command to finish")
			await within(shellComplete, 5_000, "the shell execution to complete")
			expect(await within(completed, 5_000, "the completed event")).toContain("no newline at the end")

			expect(terminal.busy).toBe(false)
			expect(terminal.process).toBeUndefined()
			expect(terminal.getProcessesWithOutput()).toHaveLength(0)
		})

		it("a foreground command hands out every line exactly once, adding up to the completed output", async () => {
			const terminal = backend.create(os.tmpdir())
			let seen = ""
			const completed = deferred<string | undefined>()

			const proc = terminal.runCommand("echo one; sleep 0.05; echo two; sleep 0.05; printf three", {
				onLine: (line) => {
					seen += line
				},
				onCompleted: (output) => completed.resolve(output),
				onShellExecutionStarted: () => {},
				onShellExecutionComplete: () => {},
			})

			await within(proc, 5_000, "the command to finish")
			const output = await within(completed.promise, 5_000, "the completed event")

			expect(seen).toBe(output)
			expect(seen).toBe("one\ntwo\nthree")
			expect(proc.hasUnretrievedOutput()).toBe(false)
		})

		it("a line that arrives inside the throttle window reaches the caller without waiting for more output", async () => {
			const terminal = backend.create(os.tmpdir())
			// The second line comes 50 ms after the first, well inside the throttle
			// window, and then the command stays silent. Before the shared throttle
			// had a trailing flush, "second" sat in the buffer until the command
			// printed something else or ended, 30 s later.
			const { proc, firstLine, shellComplete } = startCommand(
				terminal,
				"echo first; sleep 0.05; echo second; sleep 30",
				"first",
			)
			let seenSecond = false
			proc.on("line", (line) => {
				if (line.includes("second")) {
					seenSecond = true
				}
			})

			try {
				await within(firstLine, 5_000, "the first line")
				await until(() => seenSecond, 2_000, "the second line to be handed out")
			} finally {
				proc.abort()
				await within(shellComplete, 5_000, "the aborted command to exit")
			}
		})

		it("continue() hands the caller every complete line received so far before it stops listening", async () => {
			const terminal = backend.create(os.tmpdir())
			let seen = ""
			const shellComplete = deferred<ExitCodeDetails>()

			const proc = terminal.runCommand("echo first; sleep 0.05; echo second; sleep 30", {
				onLine: (line) => {
					seen += line
				},
				onCompleted: () => {},
				onShellExecutionStarted: () => {},
				onShellExecutionComplete: (details) => shellComplete.resolve(details),
			})

			try {
				await until(() => seen.includes("first"), 5_000, "the first line")
				// "second" is in the process buffer but has not been handed out yet
				// (it arrived inside the throttle window). Moving the command to the
				// background now must not strand it there: the caller builds the
				// "output so far" it reports to the model from these lines.
				await until(
					() => seen.includes("second") || proc.hasUnretrievedOutput(),
					5_000,
					"the second line to reach the process",
				)
				proc.continue()

				expect(seen).toContain("second")
			} finally {
				proc.abort()
				await within(shellComplete.promise, 5_000, "the aborted command to exit")
			}
		})

		it("an aborted command is reported as terminated by a signal, never as exit code 0", async () => {
			const terminal = backend.create(os.tmpdir())
			const { proc, firstLine, shellComplete } = startCommand(terminal, "echo started; sleep 30", "started")

			await within(firstLine, 5_000, "the first line")
			proc.abort()

			const details = await within(shellComplete, 5_000, "the aborted command to exit")

			// The model reads "Exit code: 0" as success and the CLI's JSON stream
			// reports it as such; a killed command has not succeeded.
			expect(details.exitCode).not.toBe(0)
			expect(details.signalName).toBeDefined()
		})

		it("abort() after continue() actually stops the command", async () => {
			const terminal = backend.create(os.tmpdir())
			const { proc, firstLine, shellComplete } = startCommand(terminal, "echo started; sleep 30", "started")

			await within(firstLine, 5_000, "the first line")

			proc.continue()
			await within(proc, 1_000, "continue() to release the caller")

			// The command is in the background now; the user timeout or the task
			// being cancelled aborts it.
			proc.abort()

			await within(shellComplete, 5_000, "the aborted command to exit (it would otherwise run for 30 s)")
			expect(terminal.busy).toBe(false)
		})
	},
)
