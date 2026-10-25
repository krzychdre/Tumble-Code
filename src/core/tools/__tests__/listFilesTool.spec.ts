// ListFilesTool with the real response formatting and path helpers; only the file listing (the
// file system boundary) and the task are replaced.

import * as path from "path"
import * as vscode from "vscode"

import type { Task } from "../../task/Task"
import type { ToolUse } from "../../../shared/tools"
import type { ToolCallbacks } from "../BaseTool"
import { ListFilesTool } from "../ListFilesTool"
import { listFiles } from "../../../services/glob/list-files"

vi.mock("../../../services/glob/list-files", () => ({ listFiles: vi.fn() }))

const CWD = path.resolve(path.sep, "test", "workspace")
const OUTSIDE = path.resolve(path.sep, "elsewhere")

function makeTask(state: Record<string, unknown> | null = {}) {
	return {
		cwd: CWD,
		consecutiveMistakeCount: 3,
		recordToolError: vi.fn(),
		didToolFailInCurrentTurn: false,
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing path"),
		rooIgnoreController: { validateAccess: (p: string) => !p.endsWith(".env") },
		rooProtectedController: undefined,
		providerRef: { deref: () => (state ? { getState: async () => state } : undefined) },
		ask: vi.fn().mockResolvedValue(undefined),
	} as unknown as Task & { ask: ReturnType<typeof vi.fn> }
}

function makeCallbacks(approve = true) {
	return {
		askApproval: vi.fn().mockResolvedValue(approve),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		toolCallId: "call-1",
	} as unknown as ToolCallbacks & Record<"askApproval" | "handleError" | "pushToolResult", ReturnType<typeof vi.fn>>
}

const approvalMessage = (callbacks: ReturnType<typeof makeCallbacks>) =>
	JSON.parse(callbacks.askApproval.mock.calls[0][1])

beforeEach(() => {
	vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([{ uri: { fsPath: CWD } }] as any)
	vi.mocked(listFiles).mockReset()
	vi.mocked(listFiles).mockResolvedValue([[path.join(CWD, "src", "a.ts"), path.join(CWD, ".env")], false])
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe("ListFilesTool.execute", () => {
	it("asks for a missing path and lists nothing", async () => {
		const task = makeTask()
		const callbacks = makeCallbacks()

		await new ListFilesTool().execute({ path: "" }, task, callbacks)

		expect(callbacks.pushToolResult).toHaveBeenCalledWith("missing path")
		expect(task.recordToolError).toHaveBeenCalledWith("list_files")
		expect(listFiles).not.toHaveBeenCalled()
	})

	it.each([
		[undefined, false, "listFilesTopLevel"],
		[true, true, "listFilesRecursive"],
	])(
		"lists (recursive: %s) under the cwd, shows the result for approval and returns it",
		async (recursive, listedRecursively, tool) => {
			const task = makeTask()
			const callbacks = makeCallbacks()

			await new ListFilesTool().execute({ path: "src", recursive }, task, callbacks)

			expect(listFiles).toHaveBeenCalledWith(path.join(CWD, "src"), listedRecursively, 200)
			const message = approvalMessage(callbacks)
			expect(message).toMatchObject({ tool, path: "src", isOutsideWorkspace: false, toolCallId: "call-1" })
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(message.content)
			expect(task.consecutiveMistakeCount).toBe(0)
		},
	)

	it.each([
		["hides", { showRooIgnoredFiles: false }, false],
		["shows", { showRooIgnoredFiles: true }, true],
		["hides by default without provider", null, false],
		["hides by default when the setting is unset", {}, false],
	])("%s .rooignore'd files as the setting says", async (_, state, shown) => {
		const callbacks = makeCallbacks()

		await new ListFilesTool().execute({ path: "." }, makeTask(state), callbacks)

		const result = callbacks.pushToolResult.mock.calls[0][0] as string
		expect(result).toContain("src/a.ts")
		expect(result.includes(".env")).toBe(shown)
	})

	it("marks a directory outside the workspace", async () => {
		const callbacks = makeCallbacks()

		await new ListFilesTool().execute({ path: OUTSIDE }, makeTask(), callbacks)

		expect(approvalMessage(callbacks).isOutsideWorkspace).toBe(true)
	})

	it("returns nothing when the listing is rejected", async () => {
		const callbacks = makeCallbacks(false)

		await new ListFilesTool().execute({ path: "src" }, makeTask(), callbacks)

		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})

	it("hands a failed listing to handleError", async () => {
		const failure = new Error("EACCES")
		vi.mocked(listFiles).mockRejectedValue(failure)
		const callbacks = makeCallbacks()

		await new ListFilesTool().execute({ path: "src" }, makeTask(), callbacks)

		expect(callbacks.handleError).toHaveBeenCalledWith("listing files", failure, "list_files")
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
	})
})

describe("ListFilesTool.handlePartial", () => {
	const block = (params: Record<string, string | undefined>) =>
		({
			type: "tool_use",
			name: "list_files",
			id: "call-2",
			params,
			partial: true,
		}) as unknown as ToolUse<"list_files">

	it.each([
		[
			{ path: "src", recursive: "TRUE" },
			{ tool: "listFilesRecursive", path: "src", isOutsideWorkspace: false },
		],
		[
			{ path: OUTSIDE, recursive: "false" },
			{ tool: "listFilesTopLevel", isOutsideWorkspace: true },
		],
		[{ path: undefined }, { tool: "listFilesTopLevel", isOutsideWorkspace: false }],
	])("shows a placeholder for %j", async (params, expected) => {
		const task = makeTask()

		await new ListFilesTool().handlePartial(task, block(params))

		const [type, message, partial] = task.ask.mock.calls[0]
		expect(type).toBe("tool")
		expect(JSON.parse(message)).toMatchObject({ ...expected, content: "", toolCallId: "call-2" })
		expect(partial).toBe(true)
	})

	it("ignores a rejected placeholder ask", async () => {
		const task = makeTask()
		task.ask.mockRejectedValue(new Error("ask promise was ignored"))

		await expect(new ListFilesTool().handlePartial(task, block({ path: "src" }))).resolves.toBeUndefined()
	})
})
