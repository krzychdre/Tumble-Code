// npx vitest core/tools/__tests__/toolStreamState.onTask.spec.ts
//
// CORE-R12: the partial-stream state of a tool call belongs to the task that
// streams it, not to the tool. Every tool is a module singleton shared by all
// tasks (up to 8 parallel subagents stream next to the foreground task), so
// the state lives in one typed place on the task, `task.toolStreamState`,
// keyed by tool name, and the tool singletons keep no per-task state at all.
//
// The interleaving tests follow the shape of the parser's TL-1 test
// (NativeToolCallParser.spec.ts, "per-task instance isolation"): two tasks
// feed the same singleton alternately, and each must see only its own state.

import { fileExistsAtPath } from "../../../utils/fs"
import type { ToolUse } from "../../../shared/tools"
import { TOOL_DESCRIPTORS, type DispatchableToolName } from "../toolDescriptors"
import { getToolHandler } from "../../assistant-message/toolHandlers"
import type { BaseTool } from "../BaseTool"
import { writeToFileTool } from "../WriteToFileTool"
import { editFileTool } from "../EditFileTool"
import { editTool } from "../EditTool"
import { searchReplaceTool } from "../SearchReplaceTool"
import { applyDiffTool } from "../ApplyDiffTool"

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

function makeTask(name: string): any {
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
			editType: undefined as "create" | "modify" | undefined,
			isEditing: false,
			originalContent: "",
			open: vi.fn().mockResolvedValue(undefined),
			update: vi.fn().mockResolvedValue(undefined),
			reset: vi.fn().mockResolvedValue(undefined),
			revertChanges: vi.fn().mockResolvedValue(undefined),
			saveChanges: vi.fn().mockResolvedValue({ newProblemsMessage: "", userEdits: null, finalContent: "" }),
			scrollToFirstDiff: vi.fn(),
			pushToolWriteResult: vi.fn().mockResolvedValue("written"),
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

/**
 * One row per tool whose partial handler waits for a stabilized path: the
 * tool singleton and how to build a partial block of it for a path.
 */
type StreamingTool = {
	tool: BaseTool<any>
	partialBlock: (path: string) => ToolUse<any>
}

function partialBlock(name: string, params: Record<string, string>): ToolUse<any> {
	return { type: "tool_use", name, id: `call-${name}`, params, partial: true } as unknown as ToolUse<any>
}

const STREAMING_TOOLS: Record<string, StreamingTool> = {
	write_to_file: {
		tool: writeToFileTool,
		partialBlock: (p) => partialBlock("write_to_file", { path: p, content: "x" }),
	},
	edit_file: {
		tool: editFileTool,
		partialBlock: (p) => partialBlock("edit_file", { file_path: p, old_string: "old", new_string: "new" }),
	},
	edit: {
		tool: editTool,
		partialBlock: (p) => partialBlock("edit", { file_path: p, old_string: "old", new_string: "new" }),
	},
	search_replace: {
		tool: searchReplaceTool,
		partialBlock: (p) => partialBlock("search_replace", { file_path: p, old_string: "old", new_string: "new" }),
	},
	apply_diff: {
		tool: applyDiffTool,
		partialBlock: (p) => partialBlock("apply_diff", { path: p, diff: "<<<<<<< SEARCH" }),
	},
}

/** The path shown by the (single) partial row a task asked for, if any. */
function askedPath(task: any): string | undefined {
	const call = task.ask.mock.calls[0]
	return call ? JSON.parse(call[1] as string).path : undefined
}

describe("CORE-R12: tool partial-stream state lives on the task", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(fileExistsAtPath).mockResolvedValue(false)
	})

	describe.each(Object.entries(STREAMING_TOOLS))("%s", (toolName, { tool, partialBlock }) => {
		it("two tasks streaming interleaved chunks each get their own path stabilized", async () => {
			const taskA = makeTask("a")
			const taskB = makeTask("b")

			await tool.handlePartial(taskA, partialBlock("src/a.ts"))
			await tool.handlePartial(taskB, partialBlock("src/b.ts"))
			await tool.handlePartial(taskA, partialBlock("src/a.ts"))
			await tool.handlePartial(taskB, partialBlock("src/b.ts"))

			expect(taskA.ask).toHaveBeenCalledTimes(1)
			expect(taskB.ask).toHaveBeenCalledTimes(1)
			expect(askedPath(taskA)).toBe("src/a.ts")
			expect(askedPath(taskB)).toBe("src/b.ts")
		})

		it("another task's reset does not wipe this task's stream", async () => {
			const taskA = makeTask("a")
			const taskB = makeTask("b")

			await tool.handlePartial(taskA, partialBlock("src/a.ts"))
			await tool.handlePartial(taskB, partialBlock("src/b.ts"))
			tool.resetPartialState(taskB)
			await tool.handlePartial(taskA, partialBlock("src/a.ts"))

			expect(taskA.ask).toHaveBeenCalledTimes(1)
			expect(taskB.ask).not.toHaveBeenCalled()
		})

		it("keeps the state in task.toolStreamState under the tool's name, and reset clears only that entry", async () => {
			const taskA = makeTask("a")
			const taskB = makeTask("b")

			await tool.handlePartial(taskA, partialBlock("src/a.ts"))

			expect(taskA.toolStreamState?.[toolName]?.lastSeenPartialPath).toBe("src/a.ts")
			expect(taskB.toolStreamState?.[toolName]).toBeUndefined()

			taskA.toolStreamState.other_tool = { lastSeenPartialPath: "kept.ts" }
			tool.resetPartialState(taskA)

			expect(taskA.toolStreamState[toolName]).toBeUndefined()
			expect(taskA.toolStreamState.other_tool).toEqual({ lastSeenPartialPath: "kept.ts" })
		})
	})

	it("write_to_file keeps its create/modify path and access memo on the task", async () => {
		const taskA = makeTask("a")

		await writeToFileTool.handlePartial(taskA, STREAMING_TOOLS.write_to_file.partialBlock("src/a.ts"))
		await writeToFileTool.handlePartial(taskA, STREAMING_TOOLS.write_to_file.partialBlock("src/a.ts"))

		expect(taskA.toolStreamState.write_to_file).toMatchObject({
			lastSeenPartialPath: "src/a.ts",
			lastValidatedPartialPath: "src/a.ts",
			lastPartialAccessAllowed: true,
			editTypePath: "src/a.ts",
		})
	})

	it("edit_file keeps the path of its streaming row on the task", async () => {
		const taskA = makeTask("a")

		await editFileTool.handlePartial(taskA, STREAMING_TOOLS.edit_file.partialBlock("src/a.ts"))
		await editFileTool.handlePartial(taskA, STREAMING_TOOLS.edit_file.partialBlock("src/a.ts"))

		expect(taskA.toolStreamState.edit_file).toMatchObject({
			lastSeenPartialPath: "src/a.ts",
			partialToolAskRelPath: "src/a.ts",
		})
	})

	it("write_to_file clears the task's stream state when execute ends", async () => {
		const taskA = makeTask("a")
		const block = STREAMING_TOOLS.write_to_file.partialBlock("src/a.ts")
		await writeToFileTool.handlePartial(taskA, block)
		await writeToFileTool.handlePartial(taskA, block)

		await writeToFileTool.handle(
			taskA,
			{ ...block, partial: false, nativeArgs: { path: "src/a.ts", content: "x" } } as ToolUse<"write_to_file">,
			callbacks(),
		)

		expect(taskA.toolStreamState.write_to_file).toBeUndefined()
	})

	it("no tool singleton keeps state of its own: every handler's only own property is its name", () => {
		const names = Object.keys(TOOL_DESCRIPTORS) as DispatchableToolName[]
		const offenders: string[] = []
		for (const name of names) {
			const handler = getToolHandler(name)
			expect(handler, name).toBeDefined()
			const extra = Object.keys(handler!).filter((key) => key !== "name")
			if (extra.length > 0) {
				offenders.push(`${name}: ${extra.join(", ")}`)
			}
		}
		expect(offenders).toEqual([])
	})
})
