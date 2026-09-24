// npx vitest run core/tools/__tests__/codebaseSearchTool.workspace.spec.ts
//
// In a multi-root workspace the task runs in one root (task.cwd) while the active
// editor may show a file from another root. build-tools.ts decides whether to offer
// codebase_search from the index of task.cwd, so the search itself must use that same
// index and not the one CodeIndexManager.getInstance() picks from the active editor
// when it is called without a workspace path.

import type { Task } from "../../task/Task"
import type { ToolCallbacks } from "../BaseTool"
import { CodebaseSearchTool } from "../CodebaseSearchTool"
import { CodeIndexManager } from "../../../services/code-index/manager"

vi.mock("vscode", () => ({
	workspace: { asRelativePath: vi.fn((value: string) => value) },
}))

vi.mock("../../../utils/path", () => ({ getWorkspacePath: vi.fn(() => "/first") }))

const makeManager = (root: string) => ({
	isFeatureEnabled: true,
	isFeatureConfigured: true,
	searchIndex: vi.fn().mockResolvedValue([
		{
			score: 0.9,
			payload: { filePath: `${root}/src/result.ts`, startLine: 2, endLine: 4, codeChunk: " match " },
		},
	]),
})

const managers = vi.hoisted(() => ({}) as Record<string, any>)

vi.mock("../../../services/code-index/manager", () => ({
	CodeIndexManager: {
		// Mirrors the real getInstance: without a workspace path it resolves the root of
		// the active editor, which here is "/first".
		getInstance: vi.fn((_context: unknown, workspacePath?: string) => managers[workspacePath ?? "/first"]),
	},
}))

describe("CodebaseSearchTool workspace selection", () => {
	let task: Task
	let callbacks: ToolCallbacks

	beforeEach(() => {
		vi.clearAllMocks()
		managers["/first"] = makeManager("/first")
		managers["/second"] = makeManager("/second")

		const provider = { context: {} }
		task = {
			cwd: "/second",
			providerRef: new WeakRef(provider),
			consecutiveMistakeCount: 0,
			say: vi.fn().mockResolvedValue(undefined),
		} as unknown as Task
		callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn().mockResolvedValue(undefined),
			pushToolResult: vi.fn(),
		}
	})

	it("searches the index of the task cwd, not the root of the active editor", async () => {
		await new CodebaseSearchTool().execute({ query: "find match", path: "src" }, task, callbacks)

		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect(CodeIndexManager.getInstance).toHaveBeenCalledWith(expect.anything(), "/second")
		expect(managers["/second"].searchIndex).toHaveBeenCalledWith("find match", "src")
		expect(managers["/first"].searchIndex).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(
			expect.stringContaining("File path: /second/src/result.ts"),
		)
	})
})
