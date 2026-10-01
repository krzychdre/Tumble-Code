// npx vitest run src/integrations/terminal/__tests__/ExecaTerminal.spec.ts

import { RooTerminalCallbacks } from "../types"
import { ExecaTerminal } from "../ExecaTerminal"
import { TerminalRegistry } from "../TerminalRegistry"

describe("ExecaTerminal", () => {
	it("should run terminal commands and collect output", async () => {
		// TODO: Run the equivalent test for Windows.
		if (process.platform === "win32") {
			return
		}

		const terminal = new ExecaTerminal(1, "/tmp")
		let result

		const callbacks: RooTerminalCallbacks = {
			onLine: vi.fn(),
			onCompleted: (output) => {
				result = output
			},
			onShellExecutionStarted: vi.fn(),
			onShellExecutionComplete: vi.fn(),
		}

		const subprocess = terminal.runCommand("ls -al", callbacks)
		await subprocess

		expect(callbacks.onLine).toHaveBeenCalled()
		expect(callbacks.onShellExecutionStarted).toHaveBeenCalled()
		expect(callbacks.onShellExecutionComplete).toHaveBeenCalled()

		expect(result).toBeTypeOf("string")
		expect(result).toContain("total")
	})

	it("Stop: releasing the task's terminals kills a running command and its await settles at once", async () => {
		if (process.platform === "win32") {
			return
		}

		// What Task.dispose does on Stop: TerminalRegistry.releaseTerminalsForTask.
		const terminal = TerminalRegistry.createTerminal("/tmp", "execa")
		terminal.taskId = "stop-task"
		let markStarted!: () => void
		const started = new Promise<void>((resolve) => (markStarted = resolve))
		const exits: any[] = []
		const callbacks: RooTerminalCallbacks = {
			onLine: vi.fn(),
			onCompleted: vi.fn(),
			onShellExecutionStarted: () => markStarted(),
			onShellExecutionComplete: (details) => exits.push(details),
		}

		const run = terminal.runCommand("sleep 30; echo finished", callbacks)
		await started

		const stoppedAt = Date.now()
		TerminalRegistry.releaseTerminalsForTask("stop-task")
		await run

		// ExecuteCommandTool awaits this same promise; it settles right away,
		// not after the 30 s the command would have taken.
		expect(Date.now() - stoppedAt).toBeLessThan(3000)
		expect(exits).toHaveLength(1)
		expect(exits[0].exitCode).not.toBe(0)
		expect(callbacks.onCompleted).toHaveBeenCalledWith(expect.not.stringContaining("finished"), expect.anything())
		expect(terminal.busy).toBe(false)
	})
})
