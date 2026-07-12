import { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"
import { BaseTool, ToolCallbacks } from "../BaseTool"

vi.mock("vscode", () => ({
	window: {
		showWarningMessage: vi.fn().mockResolvedValue(undefined),
	},
	env: {
		openExternal: vi.fn(),
	},
	Uri: {
		parse: vi.fn(),
	},
}))

describe("BaseTool partial error handling (TL-4)", () => {
	class TestTool extends BaseTool<"write_to_file"> {
		readonly name = "write_to_file" as const

		private shouldThrow: boolean

		constructor(shouldThrow: boolean) {
			super()
			this.shouldThrow = shouldThrow
		}

		async execute(): Promise<void> {
			// Not used in these tests
		}

		override async handlePartial(task: Task): Promise<void> {
			// Simulate opening the diff editor then optionally throwing during update
			if (!this.shouldThrow) {
				await task.diffViewProvider.open("test/file.txt")
				return
			}

			await task.diffViewProvider.open("test/file.txt")
			throw new Error("update failed during partial")
		}
	}

	function makeMockTask(): any {
		return {
			diffViewProvider: {
				open: vi.fn().mockResolvedValue(undefined),
				reset: vi.fn().mockResolvedValue(undefined),
				isEditing: false,
				editType: undefined,
			},
		}
	}

	function makeCallbacks(): ToolCallbacks {
		return {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn().mockResolvedValue(undefined),
			pushToolResult: vi.fn(),
		}
	}

	function makePartialBlock(): ToolUse<"write_to_file"> {
		return {
			type: "tool_use",
			name: "write_to_file",
			params: { path: "test/file.txt", content: "test" },
			nativeArgs: { path: "test/file.txt", content: "test" } as any,
			partial: true,
		}
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("resets diffViewProvider when handlePartial throws", async () => {
		const tool = new TestTool(true)
		const task = makeMockTask()
		const callbacks = makeCallbacks()

		await tool.handle(task, makePartialBlock(), callbacks)

		expect(task.diffViewProvider.open).toHaveBeenCalledWith("test/file.txt")
		expect(callbacks.handleError).toHaveBeenCalledWith("handling partial write_to_file", expect.any(Error))
		expect(task.diffViewProvider.reset).toHaveBeenCalled()
	})

	it("does not reset diffViewProvider when handlePartial succeeds", async () => {
		const tool = new TestTool(false)
		const task = makeMockTask()
		const callbacks = makeCallbacks()

		await tool.handle(task, makePartialBlock(), callbacks)

		expect(task.diffViewProvider.open).toHaveBeenCalledWith("test/file.txt")
		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect(task.diffViewProvider.reset).not.toHaveBeenCalled()
	})
})
