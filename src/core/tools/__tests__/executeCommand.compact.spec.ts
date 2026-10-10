// npx vitest run core/tools/__tests__/executeCommand.compact.spec.ts

// Under the compact profile execute_command does not persist large output to a
// command-output artifact: the result would point at read_artifact, which compact does not
// offer. The output stays inline and the push cuts it to the compact cap.

import * as fs from "fs/promises"

import { executeCommandInTerminal } from "../ExecuteCommandTool"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"
import { OutputInterceptor } from "../../../integrations/terminal/OutputInterceptor"
import type { RooTerminalCallbacks } from "../../../integrations/terminal/types"

vi.mock("fs/promises")
vi.mock("../../../integrations/terminal/TerminalRegistry")
vi.mock("../../../integrations/terminal/Terminal")
vi.mock("../../../integrations/terminal/ExecaTerminal")
vi.mock("../../../utils/storage", () => ({ getTaskDirectoryPath: vi.fn().mockResolvedValue("/storage/tasks/t") }))
vi.mock("../../../integrations/terminal/OutputInterceptor", () => ({
	OutputInterceptor: vi.fn().mockImplementation(function () {
		return {
			write: vi.fn(),
			finalize: vi.fn().mockResolvedValue({
				truncated: true,
				totalBytes: 50_000,
				preview: "preview",
				artifactPath: "/storage/tasks/t/command-output/cmd-1.txt",
			}),
		}
	}),
}))

function setup(apiConfiguration: Record<string, unknown>) {
	vi.mocked(fs.access).mockResolvedValue(undefined)
	const provider = {
		postMessageToWebview: vi.fn(),
		getState: vi.fn().mockResolvedValue({}),
		context: { globalStorageUri: { fsPath: "/storage" } },
	}
	const process: any = Promise.resolve()
	process.continue = vi.fn()
	const terminal = {
		provider: "execa",
		id: 1,
		getCurrentWorkingDirectory: vi.fn().mockReturnValue("/project"),
		runCommand: vi.fn().mockImplementation((_command: string, callbacks: RooTerminalCallbacks) => {
			setTimeout(() => {
				callbacks.onCompleted("lots of output", process)
				callbacks.onShellExecutionComplete({ exitCode: 0 }, process)
			}, 0)
			return process
		}),
	}
	vi.mocked(TerminalRegistry.getOrCreateTerminal).mockResolvedValue(terminal as any)
	const task: any = {
		cwd: "/project",
		taskId: "t",
		apiConfiguration,
		providerRef: { deref: vi.fn().mockResolvedValue(provider) },
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockReturnValue(new Promise(() => {})),
		terminalProcess: undefined,
	}
	return task
}

describe("executeCommandInTerminal under the compact profile", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("does not persist the output to an artifact and returns it inline", async () => {
		const task = setup({ compactProfile: true })

		const [, result] = await executeCommandInTerminal(task, { executionId: "1", command: "npm test" })

		expect(OutputInterceptor).not.toHaveBeenCalled()
		expect(result).toContain("Exit code: 0")
		expect(result).not.toContain("read_artifact")
	})

	it.each([
		["absent", {}],
		["false", { compactProfile: false }],
	])("flag %s: persists large output and cites the artifact as today", async (_label, flag) => {
		const task = setup(flag)

		const [, result] = await executeCommandInTerminal(task, { executionId: "1", command: "npm test" })

		expect(OutputInterceptor).toHaveBeenCalledTimes(1)
		expect(result).toContain("Artifact ID: cmd-1.txt")
		expect(result).toContain("Use read_artifact tool to view full output if needed.")
	})
})
