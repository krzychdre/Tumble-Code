import * as path from "path"

import type { MockedFunction } from "vitest"

import { fileExistsAtPath } from "../../../utils/fs"
import { getReadablePath } from "../../../utils/path"
import { unescapeHtmlEntities } from "../../../utils/text-normalization"
import { ToolUse, ToolResponse } from "../../../shared/tools"
import { applyDiffTool } from "../ApplyDiffTool"
import { pushToolWriteResult } from "../helpers/toolWriteResult"

vi.mock("../helpers/toolWriteResult", () => ({
	pushToolWriteResult: vi.fn().mockResolvedValue("Tool result message"),
}))

vi.mock("path", async () => {
	const originalPath = await vi.importActual("path")
	return {
		...originalPath,
		resolve: vi.fn().mockImplementation((...args) => {
			const separator = process.platform === "win32" ? "\\" : "/"
			return args.join(separator)
		}),
	}
})

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn().mockResolvedValue("original content"),
	},
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(true),
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg) => `Error: ${msg}`),
		rooIgnoreError: vi.fn((p) => `Access denied: ${p}`),
		createPrettyPatch: vi.fn(() => "mock-diff"),
	},
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: vi.fn().mockReturnValue("test/file.txt"),
}))

vi.mock("../../../utils/text-normalization", () => ({
	unescapeHtmlEntities: vi.fn().mockImplementation((content) => content),
}))

vi.mock("../../plan-review/planReviewPause", () => ({
	pauseForPlanReviewIfNeeded: vi.fn().mockResolvedValue(undefined),
}))

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

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureDiffApplicationError: vi.fn(),
		},
	},
}))

vi.mock("../../ignore/RooIgnoreController", () => ({
	RooIgnoreController: class {
		initialize() {
			return Promise.resolve()
		}
		validateAccess() {
			return true
		}
	},
}))

describe("applyDiffTool", () => {
	const testFilePath = "test/file.txt"
	const absoluteFilePath = process.platform === "win32" ? "C:\\test\\file.txt" : "/test/file.txt"

	const mockedFileExistsAtPath = fileExistsAtPath as MockedFunction<typeof fileExistsAtPath>
	const mockedGetReadablePath = getReadablePath as MockedFunction<typeof getReadablePath>
	const mockedPathResolve = path.resolve as MockedFunction<typeof path.resolve>

	const mockCline: any = {}
	let mockAskApproval: ReturnType<typeof vi.fn>
	let mockHandleError: ReturnType<typeof vi.fn>
	let mockPushToolResult: ReturnType<typeof vi.fn>
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		vi.clearAllMocks()
		applyDiffTool.resetPartialState(mockCline)

		mockedPathResolve.mockReturnValue(absoluteFilePath)
		mockedFileExistsAtPath.mockResolvedValue(true)
		mockedGetReadablePath.mockReturnValue("test/file.txt")

		mockCline.cwd = "/"
		mockCline.consecutiveMistakeCount = 0
		mockCline.didEditFile = false
		mockCline.consecutiveMistakeCountForApplyDiff = new Map()
		mockCline.diffStrategy = {
			applyDiff: vi.fn().mockResolvedValue({
				success: true,
				content: "patched content",
				failParts: [],
			}),
			getProgressStatus: vi.fn(),
		}
		mockCline.providerRef = {
			deref: vi.fn().mockReturnValue({
				getState: vi.fn().mockResolvedValue({
					diagnosticsEnabled: true,
					writeDelayMs: 1000,
				}),
			}),
		}
		mockCline.rooIgnoreController = {
			validateAccess: vi.fn().mockReturnValue(true),
		}
		mockCline.rooProtectedController = {
			isWriteProtected: vi.fn().mockReturnValue(false),
		}
		mockCline.diffViewProvider = {
			isEditing: false,
			originalContent: "",
			open: vi.fn().mockResolvedValue(undefined),
			update: vi.fn().mockResolvedValue(undefined),
			reset: vi.fn().mockResolvedValue(undefined),
			revertChanges: vi.fn().mockResolvedValue(undefined),
			saveChanges: vi.fn().mockResolvedValue({
				newProblemsMessage: "",
				userEdits: null,
				finalContent: "final content",
			}),
			scrollToFirstDiff: vi.fn(),
		}
		mockCline.api = {
			getModel: vi.fn().mockReturnValue({ id: "claude-3" }),
		}
		mockCline.fileContextTracker = {
			trackFileContext: vi.fn().mockResolvedValue(undefined),
		}
		mockCline.say = vi.fn().mockResolvedValue(undefined)
		mockCline.ask = vi.fn().mockResolvedValue(undefined)
		mockCline.recordToolError = vi.fn()
		mockCline.sayAndCreateMissingParamError = vi.fn().mockResolvedValue("Missing param error")
		mockCline.processQueuedMessages = vi.fn()
		mockCline.didToolFailInCurrentTurn = false

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn().mockResolvedValue(undefined)

		toolResult = undefined
	})

	async function executeApplyDiffTool(params: Partial<ToolUse["params"]> = {}): Promise<ToolResponse | undefined> {
		const toolUse: ToolUse = {
			type: "tool_use",
			name: "apply_diff",
			params: {
				path: testFilePath,
				diff: "<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE",
				...params,
			},
			nativeArgs: {
				path: (params.path ?? testFilePath) as any,
				diff: (params.diff ?? "<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE") as any,
			},
			partial: false,
		}

		mockPushToolResult = vi.fn((result: ToolResponse) => {
			toolResult = result
		})

		await applyDiffTool.handle(mockCline, toolUse as ToolUse<"apply_diff">, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		return toolResult
	}

	describe("successful apply through the diff view", () => {
		it("opens the diff view as a modify, saves, and returns the write result with the single-block notice", async () => {
			const result = await executeApplyDiffTool()

			expect(mockHandleError).not.toHaveBeenCalled()
			expect(mockCline.diffViewProvider.open).toHaveBeenCalledWith(testFilePath, "modify")
			expect(mockCline.diffViewProvider.saveChanges).toHaveBeenCalledWith(true, 1000)
			expect(pushToolWriteResult).toHaveBeenCalledWith(mockCline, false)
			expect(result).toBe(
				"Tool result message\n<notice>Making multiple related changes in a single apply_diff is more efficient. If other changes are needed in this file, please include them as additional SEARCH/REPLACE blocks.</notice>",
			)
		})
	})

	describe("weak-model param handling", () => {
		it("passes undefined (not NaN) as startLine when diff has no :start_line: marker", async () => {
			const diffWithoutStartLine = "<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE"

			await executeApplyDiffTool({ diff: diffWithoutStartLine })

			expect(mockCline.diffStrategy.applyDiff).toHaveBeenCalled()
			const thirdArg = mockCline.diffStrategy.applyDiff.mock.calls[0][2]
			// Must NOT be NaN: must be undefined.
			expect(Number.isNaN(thirdArg)).toBe(false)
			expect(thirdArg).toBeUndefined()
		})

		it("passes the numeric startLine when :start_line: marker is present", async () => {
			const diffWithStartLine = ":start_line:5\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE"

			await executeApplyDiffTool({ diff: diffWithStartLine })

			expect(mockCline.diffStrategy.applyDiff).toHaveBeenCalled()
			const thirdArg = mockCline.diffStrategy.applyDiff.mock.calls[0][2]
			expect(thirdArg).toBe(5)
		})
	})
})
