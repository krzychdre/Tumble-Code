// npx vitest core/tools/__tests__/toolStreamState.perTask.spec.ts
//
// DEF-C4: every tool is a module singleton (`writeToFileTool`, `editFileTool`, ...)
// shared by all tasks, and up to 8 parallel subagents stream tool calls at the
// same time as the foreground task. Partial-stream state therefore has to be
// kept per task: one task's chunks, execute() or reset must never change what
// another task sees.

import * as path from "path"
import type { MockedFunction } from "vitest"

import { fileExistsAtPath } from "../../../utils/fs"
import type { ToolUse } from "../../../shared/tools"
import { writeToFileTool } from "../WriteToFileTool"
import { editFileTool } from "../EditFileTool"
import { pushToolWriteResult } from "../helpers/toolWriteResult"

vi.mock("../helpers/toolWriteResult", () => ({
	pushToolWriteResult: vi.fn().mockResolvedValue("written"),
}))

vi.mock("delay", () => ({ default: vi.fn() }))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(false),
	createDirectoriesForFile: vi.fn().mockResolvedValue([]),
}))

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: vi.fn().mockReturnValue(false),
}))

vi.mock("../../plan-review/planReviewPause", () => ({
	pauseForPlanReviewIfNeeded: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("vscode", () => ({
	window: { showWarningMessage: vi.fn().mockResolvedValue(undefined) },
	env: { openExternal: vi.fn() },
	Uri: { parse: vi.fn() },
}))

const mockedFileExistsAtPath = fileExistsAtPath as MockedFunction<typeof fileExistsAtPath>

function makeTask(name: string): any {
	// A minimal diff session: open() records the create/modify decision for
	// its path, editTypeOf() answers it back, reset() forgets it.
	let session: { relPath: string; editType: "create" | "modify" } | undefined
	return {
		taskId: name,
		cwd: `/work/${name}`,
		consecutiveMistakeCount: 0,
		consecutiveMistakeCountForEditFile: new Map<string, number>(),
		didEditFile: false,
		silentWrites: false,
		providerRef: {
			deref: () => ({
				getState: vi.fn().mockResolvedValue({ diagnosticsEnabled: false, writeDelayMs: 0, experiments: {} }),
			}),
		},
		rooIgnoreController: { validateAccess: vi.fn().mockReturnValue(true) },
		rooProtectedController: { isWriteProtected: vi.fn().mockReturnValue(false) },
		diffViewProvider: {
			isEditing: false,
			originalContent: "",
			open: vi.fn(async (relPath: string, editType: "create" | "modify") => {
				session = { relPath, editType }
			}),
			editTypeOf: vi.fn((relPath: string) => (session?.relPath === relPath ? session.editType : undefined)),
			update: vi.fn().mockResolvedValue(undefined),
			reset: vi.fn(async () => {
				session = undefined
			}),
			revertChanges: vi.fn().mockResolvedValue(undefined),
			saveChanges: vi.fn().mockResolvedValue({ newProblemsMessage: "", userEdits: null, finalContent: "" }),
			scrollToFirstDiff: vi.fn(),
		},
		api: { getModel: () => ({ id: "claude-test" }) },
		fileContextTracker: { trackFileContext: vi.fn().mockResolvedValue(undefined) },
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue(undefined),
		recordToolError: vi.fn(),
		recordToolUsage: vi.fn(),
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing param"),
		processQueuedMessages: vi.fn(),
	}
}

function callbacks() {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn().mockResolvedValue(undefined),
		pushToolResult: vi.fn(),
	}
}

function writeBlock(relPath: string, content: string, partial: boolean): ToolUse<"write_to_file"> {
	return {
		type: "tool_use",
		name: "write_to_file",
		id: `call-${relPath}`,
		params: { path: relPath, content },
		nativeArgs: partial ? undefined : { path: relPath, content },
		partial,
	} as unknown as ToolUse<"write_to_file">
}

function editBlock(
	filePath: string | undefined,
	partial: boolean,
	oldString = "old",
	newString = "new",
): ToolUse<"edit_file"> {
	const args = { file_path: filePath, old_string: oldString, new_string: newString }
	return {
		type: "tool_use",
		name: "edit_file",
		id: `call-${filePath}`,
		params: args,
		nativeArgs: partial ? undefined : args,
		partial,
	} as unknown as ToolUse<"edit_file">
}

/** The `tool` field ("newFileCreated" / "editedExistingFile") of the approval dialog shown for a write. */
function approvalLabel(askApproval: ReturnType<typeof vi.fn>): string | undefined {
	const call = askApproval.mock.calls[0]
	return call ? JSON.parse(call[1] as string).tool : undefined
}

describe("DEF-C4: tool partial-stream state is kept per task", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockedFileExistsAtPath.mockResolvedValue(false)
	})

	it("write_to_file: two tasks streaming at the same time both get their path stabilized", async () => {
		const taskA = makeTask("a")
		const taskB = makeTask("b")
		const cb = callbacks()

		// The chunks of the two streams arrive interleaved, as they do when a
		// parallel subagent streams next to the foreground task.
		await writeToFileTool.handle(taskA, writeBlock("src/a.ts", "a1", true), cb)
		await writeToFileTool.handle(taskB, writeBlock("src/b.ts", "b1", true), cb)
		await writeToFileTool.handle(taskA, writeBlock("src/a.ts", "a1 a2", true), cb)
		await writeToFileTool.handle(taskB, writeBlock("src/b.ts", "b1 b2", true), cb)

		// Each task saw its own path twice in a row, so each must have shown
		// its streaming preview (one partial "tool" ask with its own path).
		expect(taskA.ask).toHaveBeenCalledTimes(1)
		expect(taskB.ask).toHaveBeenCalledTimes(1)
		expect(taskA.diffViewProvider.open).toHaveBeenCalledWith("src/a.ts", "create")
		expect(taskB.diffViewProvider.open).toHaveBeenCalledWith("src/b.ts", "create")
	})

	it("write_to_file: another task finishing its write does not make this task trust a stale create/modify", async () => {
		const taskA = makeTask("a")
		const taskB = makeTask("b")

		// Only task A's final target exists on disk. The tool asks about the
		// native absolute path (path.resolve of cwd + relPath), which on Windows
		// is "D:\work\a\src\app.tsx", so build the expected path the same way
		// instead of matching a POSIX "/work/a/src/app.tsx" suffix.
		const existingFile = path.resolve(taskA.cwd, "src/app.tsx")
		mockedFileExistsAtPath.mockImplementation(async (p: string) => p === existingFile)

		// Task A streams a path that partial-json truncated ("src/app.ts"); the
		// file does not exist, so its diff view is opened as "create" for that path.
		const cbA = callbacks()
		await writeToFileTool.handle(taskA, writeBlock("src/app.ts", "x", true), cbA)
		await writeToFileTool.handle(taskA, writeBlock("src/app.ts", "x y", true), cbA)
		expect(taskA.diffViewProvider.open).toHaveBeenCalledWith("src/app.ts", "create")

		// Meanwhile a parallel subagent streams and completes its own write.
		const cbB = callbacks()
		await writeToFileTool.handle(taskB, writeBlock("src/b.ts", "b", true), cbB)
		await writeToFileTool.handle(taskB, writeBlock("src/b.ts", "b", true), cbB)
		await writeToFileTool.handle(taskB, writeBlock("src/b.ts", "b", false), cbB)
		expect(approvalLabel(cbB.askApproval)).toBe("newFileCreated")

		// Task A's final path is the real one, and that file exists: the approval
		// dialog must say "edited existing file", not "created new file".
		await writeToFileTool.handle(taskA, writeBlock("src/app.tsx", "x y z", false), cbA)
		expect(approvalLabel(cbA.askApproval)).toBe("editedExistingFile")
		expect(taskA.diffViewProvider.open).toHaveBeenLastCalledWith("src/app.tsx", "modify")
		expect(pushToolWriteResult).toHaveBeenCalledWith(taskA, false)
	})

	it("edit_file: another task finishing its edit does not leave this task's streaming row unfinalized", async () => {
		const taskA = makeTask("a")
		const taskB = makeTask("b")

		// Task A streams an edit: after the path stabilizes it shows a partial row.
		await editFileTool.handle(taskA, editBlock("src/a.ts", true), callbacks())
		await editFileTool.handle(taskA, editBlock("src/a.ts", true), callbacks())
		expect(taskA.ask).toHaveBeenCalledTimes(1)
		expect(taskA.ask.mock.calls[0][2]).toBe(true)

		// A parallel subagent runs (and ends) an edit_file call of its own.
		await editFileTool.handle(taskB, editBlock(undefined, false), callbacks())

		// Task A's edit is then refused by .rooignore: its partial row must be
		// finalized (ask with partial=false), otherwise it spins forever.
		taskA.rooIgnoreController.validateAccess.mockReturnValue(false)
		await editFileTool.handle(taskA, editBlock("src/a.ts", false), callbacks())

		expect(taskA.ask).toHaveBeenCalledTimes(2)
		expect(taskA.ask.mock.calls[1][2]).toBe(false)
		expect(taskB.ask).not.toHaveBeenCalled()
	})
})
