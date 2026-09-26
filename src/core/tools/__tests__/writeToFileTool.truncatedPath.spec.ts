import type { Mock } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"
import { DiffViewProvider } from "../../../integrations/editor/DiffViewProvider"
import type { ToolUse } from "../../../shared/tools"
import { writeToFileTool } from "../WriteToFileTool"

/**
 * write_to_file whose `path` partial-json truncated at the moment the diff view
 * opened (SVC-17 leftover).
 *
 * partial-json drops an unfinished escape sequence at the end of a string, so
 * `"a/b\u0` and `"a/b\u002` both parse as "a/b". When the model streams
 * `content` before `path`, two consecutive chunks show the same truncated
 * path with content already present: `hasPathStabilized()` says yes and
 * handlePartial() opens the diff view for "a/b", which creates an empty file
 * there. The final path is "a/b.ts" (`\u002e` is ".").
 *
 * Real parser, real tool, real DiffViewProvider on a temporary directory; only
 * the VS Code editor side is faked, as in DiffViewProvider.session.spec.
 */

const lifecycle = vi.hoisted(() => ({
	closeFileTabs: vi.fn(),
	openDiffEditor: vi.fn(),
	scrollEditorToLine: vi.fn(),
	scrollToFirstDiff: vi.fn(),
	closeAllDiffViews: vi.fn(),
}))

const workspace = vi.hoisted(() => ({
	textDocuments: [] as unknown[],
	workspaceFolders: [] as { uri: { fsPath: string } }[],
	applyEdit: vi.fn(),
}))

vi.mock("../../../integrations/editor/DiffEditorLifecycleManager", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../integrations/editor/DiffEditorLifecycleManager")>()),
	DiffEditorLifecycleManager: vi.fn().mockImplementation(function () {
		return lifecycle
	}),
}))

vi.mock("../../../integrations/editor/DecorationController", () => ({
	DecorationController: vi.fn().mockImplementation(function () {
		return {
			addLines: vi.fn(),
			clear: vi.fn(),
			setActiveLine: vi.fn(),
			updateOverlayAfterLine: vi.fn(),
		}
	}),
}))

vi.mock("../../../integrations/editor/DiagnosticsCollector", () => ({
	DiagnosticsCollector: vi.fn().mockImplementation(function () {
		return {
			capturePreDiagnostics: vi.fn().mockReturnValue([]),
			collectPostSaveDiagnostics: vi.fn().mockResolvedValue(""),
		}
	}),
}))

vi.mock("../../plan-review/planReviewPause", () => ({
	pauseForPlanReviewIfNeeded: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("delay", () => ({ default: vi.fn().mockResolvedValue(undefined) }))

vi.mock("vscode", () => ({
	workspace,
	window: {
		showTextDocument: vi.fn().mockResolvedValue(undefined),
	},
	WorkspaceEdit: vi.fn().mockImplementation(function () {
		return {
			replace: vi.fn(),
			delete: vi.fn(),
		}
	}),
	Range: vi.fn(),
	Position: vi.fn(),
	Selection: vi.fn(),
	Uri: { file: vi.fn((p: string) => ({ fsPath: p, scheme: "file" })) },
}))

/**
 * The diff editor's right-hand document. Its save() reports failure, so
 * saveChanges() writes the approved bytes straight to the session's path:
 * the disk then shows which path the write went to.
 */
function fakeEditor(absolutePath: string) {
	return {
		document: {
			uri: { fsPath: absolutePath, scheme: "file" },
			isDirty: true,
			lineCount: 1,
			getText: () => "",
			positionAt: vi.fn((offset: number) => ({ offset })),
			save: vi.fn().mockResolvedValue(false),
		},
		selection: undefined,
		visibleRanges: [],
	}
}

/** Chunks of the tool call's arguments, `content` first, the path split inside `\u002e`. */
const CHUNKS = ['{"content":"hello\\n","path":"a/b', "\\u0", "02e", 'ts"}']

describe("write_to_file: diff opened for a truncated partial path (SVC-17)", () => {
	let cwd: string
	let task: any
	let parser: NativeToolCallParser
	let pushToolResult: Mock
	let askApproval: Mock
	let handleError: Mock

	beforeEach(async () => {
		vi.clearAllMocks()
		vi.spyOn(console, "warn").mockImplementation(() => {})
		cwd = await fs.mkdtemp(path.join(os.tmpdir(), "svc17-truncated-path-"))
		workspace.workspaceFolders = [{ uri: { fsPath: cwd } }]
		workspace.applyEdit.mockResolvedValue(true)
		lifecycle.closeFileTabs.mockResolvedValue(false)
		lifecycle.closeAllDiffViews.mockResolvedValue(undefined)
		lifecycle.openDiffEditor.mockImplementation(async (relPath: string) => fakeEditor(path.resolve(cwd, relPath)))

		task = {
			cwd,
			consecutiveMistakeCount: 0,
			didEditFile: false,
			providerRef: new WeakRef({ getState: async () => ({ experiments: {} }) }),
			rooIgnoreController: { validateAccess: () => true },
			api: { getModel: () => ({ id: "claude-test" }) },
			fileContextTracker: { trackFileContext: vi.fn().mockResolvedValue(undefined) },
			ask: vi.fn().mockResolvedValue(undefined),
			say: vi.fn().mockResolvedValue(undefined),
			recordToolError: vi.fn(),
			processQueuedMessages: vi.fn(),
		}
		task.diffViewProvider = new DiffViewProvider(cwd, task)

		parser = new NativeToolCallParser()
		pushToolResult = vi.fn()
		askApproval = vi.fn().mockResolvedValue(true)
		handleError = vi.fn().mockResolvedValue(undefined)
	})

	afterEach(async () => {
		writeToFileTool.resetPartialState(task)
		await fs.rm(cwd, { recursive: true, force: true })
	})

	const callbacks = () => ({ askApproval, handleError, pushToolResult, toolCallId: "call_1" })

	/** Streams `chunks` through the parser into handlePartial(); returns the path each partial block carried. */
	async function stream(chunks: string[]): Promise<(string | undefined)[]> {
		parser.startStreamingToolCall("call_1", "write_to_file")
		const seen: (string | undefined)[] = []
		for (const chunk of chunks) {
			const block = parser.processStreamingChunk("call_1", chunk) as ToolUse<"write_to_file"> | null
			expect(block).not.toBeNull()
			block!.id = "call_1"
			seen.push(block!.params.path)
			await writeToFileTool.handle(task, block!, callbacks())
		}
		return seen
	}

	async function finish(): Promise<void> {
		const block = parser.finalizeStreamingToolCall("call_1") as ToolUse<"write_to_file">
		block.id = "call_1"
		await writeToFileTool.handle(task, block, callbacks())
	}

	const exists = (relPath: string) =>
		fs.stat(path.join(cwd, relPath)).then(
			() => true,
			() => false,
		)

	it("the real parser shows the same truncated path twice, and handlePartial opens the diff for it", async () => {
		const seen = await stream(CHUNKS)

		expect(seen).toEqual(["a/b", "a/b", "a/b.", "a/b.ts"])
		expect(lifecycle.openDiffEditor).toHaveBeenCalledWith("a/b", "create", "")
	})

	it("execute() drops the truncated-path session and writes only the final path", async () => {
		await stream(CHUNKS)
		await finish()

		expect(handleError).not.toHaveBeenCalled()
		expect(lifecycle.openDiffEditor).toHaveBeenLastCalledWith("a/b.ts", "create", "")
		expect(await fs.readFile(path.join(cwd, "a", "b.ts"), "utf-8")).toBe("hello\n")
		expect(await exists(path.join("a", "b"))).toBe(false)
		// The approval card names the final file.
		expect(JSON.parse(askApproval.mock.calls[0][1]).content).toContain("b.ts")
	})

	it("handlePartial() reopens the diff when the final path stabilizes during the stream", async () => {
		// One more chunk after the closing quote: the final path is seen twice.
		await stream(['{"content":"hello\\n","path":"a/b', "\\u0", "02e", 'ts"', "}"])

		expect(lifecycle.openDiffEditor).toHaveBeenLastCalledWith("a/b.ts", "create", "")
		expect(task.diffViewProvider.editTypeOf("a/b.ts")).toBe("create")
		expect(await exists(path.join("a", "b"))).toBe(false)

		await finish()

		expect(await fs.readFile(path.join(cwd, "a", "b.ts"), "utf-8")).toBe("hello\n")
		expect(await exists(path.join("a", "b"))).toBe(false)
	})

	it("reuses the open session when the partial path already was the final one", async () => {
		await stream(['{"path":"a/b.ts","content":"hel', 'lo\\n"', "}"])
		await finish()

		expect(lifecycle.openDiffEditor).toHaveBeenCalledTimes(1)
		expect(lifecycle.openDiffEditor).toHaveBeenCalledWith("a/b.ts", "create", "")
		expect(await fs.readFile(path.join(cwd, "a", "b.ts"), "utf-8")).toBe("hello\n")
	})
})
