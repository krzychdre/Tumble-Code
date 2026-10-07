import type { Mock } from "vitest"
import * as path from "path"
import fs from "fs/promises"

import type { MockedFunction } from "vitest"

import { fileExistsAtPath } from "../../../utils/fs"
import { getReadablePath } from "../../../utils/path"
import { ToolUse, ToolResponse } from "../../../shared/tools"
import { applyDiffTool } from "../ApplyDiffTool"
import { MultiSearchReplaceDiffStrategy } from "../../diff/strategies/multi-search-replace"
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

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: vi.fn().mockReturnValue(false),
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: vi.fn().mockReturnValue("test/file.txt"),
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

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			capture: vi.fn(),
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
	let mockAskApproval: Mock
	let mockHandleError: Mock
	let mockPushToolResult: Mock
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

	// Native tool calls deliver the diff as JSON, verbatim. The SEARCH side must
	// match the file byte for byte, so decoding "&quot;" here made every edit of
	// an XML attribute value (Tableau .twb files) fail to match.
	describe("HTML entities in the diff", () => {
		it("hands the diff to the strategy verbatim for a non-Claude model", async () => {
			mockCline.api.getModel.mockReturnValue({ id: "glm-5.3" })
			const diff =
				"<<<<<<< SEARCH\n<member value='&quot;Day&quot;' />\n=======\n<member value='&quot;Week&quot;' /> &gt; &amp;\n>>>>>>> REPLACE"

			await executeApplyDiffTool({ diff })

			expect(mockCline.diffStrategy.applyDiff).toHaveBeenCalledWith("original content", diff, undefined)
		})
	})

	// The model used to see only the LAST failed block (the loop assigned
	// instead of collecting), and a partial success said only "unable to apply
	// all diff parts", so GLM re-sent blocks that were already in the file.
	describe("reporting failed blocks", () => {
		const noMatch = (line: number, bestMatch: string, fileDump: string) =>
			`No sufficiently similar match found at line: ${line} (40% similar, needs 100%)\n\nDebug Info:\n- Similarity Score: 40%\n\nSearch Content:\nsearched ${line}\n\nBest Match Found:\n${bestMatch}\n\nOriginal Content:\n${fileDump}`

		it("reports every failed block in diff order, with the full detail only for the first", async () => {
			mockCline.consecutiveMistakeCountForApplyDiff.set(testFilePath, 1)
			mockCline.diffStrategy.applyDiff.mockResolvedValue({
				success: false,
				blockCount: 3,
				// The strategy sorts blocks by start line, so its order is not the diff's order.
				failParts: [
					{
						success: false,
						blockIndex: 3,
						startLine: 30,
						error: noMatch(30, "30 | best three", "DUMP_THREE"),
					},
					{ success: false, blockIndex: 1, startLine: 10, error: noMatch(10, "10 | best one", "DUMP_ONE") },
				],
			})

			const result = (await executeApplyDiffTool()) as string

			expect(result).toContain(`Unable to apply diff to file: ${absoluteFilePath}`)
			expect(result).toContain("None of the 3 diff blocks were applied. The file is unchanged.")
			expect(result.indexOf("Block 1 of 3 (:start_line:10) failed:")).toBeGreaterThan(-1)
			expect(result.indexOf("Block 3 of 3 (:start_line:30) failed:")).toBeGreaterThan(
				result.indexOf("Block 1 of 3 (:start_line:10) failed:"),
			)
			expect(result).toContain("DUMP_ONE")
			expect(result).toContain(
				"Block 3 of 3 (:start_line:30) failed:\nNo sufficiently similar match found at line: 30 (40% similar, needs 100%)\nBest Match Found:\n30 | best three\n</error_details>",
			)
			expect(result).not.toContain("DUMP_THREE")
			expect(mockCline.say).toHaveBeenCalledWith("diff_error", result)
			expect(mockCline.recordToolError).toHaveBeenCalledWith("apply_diff", result)
		})

		it("reports both blocks of a real 2-block diff whose blocks both miss", async () => {
			vi.mocked(fs.readFile).mockResolvedValueOnce("alpha\nbeta\ngamma\n" as any)
			mockCline.diffStrategy = new MultiSearchReplaceDiffStrategy()
			const diff =
				"<<<<<<< SEARCH\n:start_line:1\n-------\nnot here one\n=======\nx\n>>>>>>> REPLACE\n\n" +
				"<<<<<<< SEARCH\n:start_line:3\n-------\nnot here two\n=======\ny\n>>>>>>> REPLACE"

			const result = (await executeApplyDiffTool({ diff })) as string

			expect(result).toContain("None of the 2 diff blocks were applied.")
			expect(result).toContain("Block 1 of 2 (:start_line:1) failed:")
			expect(result).toContain("Block 2 of 2 (:start_line:3) failed:")
		})

		it("names the applied and the failed blocks on a partial success", async () => {
			mockCline.diffStrategy.applyDiff.mockResolvedValue({
				success: true,
				content: "patched content",
				blockCount: 3,
				failParts: [
					{
						success: false,
						blockIndex: 2,
						startLine: 145,
						error: "Search and replace content are identical",
					},
					{ success: false, blockIndex: 3, startLine: 200, error: noMatch(200, "200 | close", "DUMP") },
				],
			})

			const result = await executeApplyDiffTool()

			expect(result).toBe(
				`Partially applied the diff to file: ${absoluteFilePath}. 1 of 3 blocks applied, 2 failed.\n` +
					"Tool result message" +
					"\n\nApplied: block 1. The file already contains these changes. Do NOT send block 1 again.\n" +
					"Failed: blocks 2 and 3. These changes are NOT in the file.\n" +
					"Next step: use read_file to read the current lines of the failed blocks (line numbers may have changed). " +
					"Then send one new apply_diff with ONLY the failed blocks, fixed.\n\n" +
					"<error_details>\n" +
					"Block 2 of 3 (:start_line:145) failed:\nSearch and replace content are identical\n\n" +
					"Block 3 of 3 (:start_line:200) failed:\nNo sufficiently similar match found at line: 200 (40% similar, needs 100%)\nBest Match Found:\n200 | close\n" +
					"</error_details>" +
					"\n<notice>Making multiple related changes in a single apply_diff is more efficient. If other changes are needed in this file, please include them as additional SEARCH/REPLACE blocks.</notice>",
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
