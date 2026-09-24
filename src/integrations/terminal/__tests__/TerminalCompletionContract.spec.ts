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

const spawnedChildren = new Set<ChildProcess>()

function createVscodeTerminal(id: number, cwd: string): RooTerminal {
	let rooTerminal: Terminal | undefined
	let child: ChildProcess | undefined

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
					rooTerminal!.shellExecutionComplete(TerminalProcess.interpretExitCode(exitCode))
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

	rooTerminal = new Terminal(id, fake as unknown as vscode.Terminal, cwd)
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

describe.skipIf(process.platform === "win32").each(backends)("terminal completion contract: $name backend", (backend) => {
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
})
