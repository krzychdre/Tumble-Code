import type { Mock } from "vitest"
import * as path from "path"
import fs from "fs/promises"

import type { MockedFunction } from "vitest"

import { fileExistsAtPath } from "../../../utils/fs"
import { isPathOutsideWorkspace } from "../../../utils/pathUtils"
import { getReadablePath } from "../../../utils/path"
import { ToolUse, ToolResponse } from "../../../shared/tools"
import { editTool } from "../EditTool"
import { searchReplaceTool } from "../SearchReplaceTool"
import { pauseForPlanReviewIfNeeded } from "../../plan-review/planReviewPause"

vi.mock("../helpers/toolWriteResult", () => ({
	pushToolWriteResult: vi.fn().mockResolvedValue("Tool result message"),
}))

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn().mockResolvedValue(""),
	},
}))

vi.mock("path", async () => {
	const originalPath = await vi.importActual("path")
	return {
		...originalPath,
		resolve: vi.fn().mockImplementation((...args) => {
			const separator = process.platform === "win32" ? "\\" : "/"
			return args.join(separator)
		}),
		isAbsolute: vi.fn().mockReturnValue(false),
		relative: vi.fn().mockImplementation((_from, to) => to),
	}
})

vi.mock("delay", () => ({
	default: vi.fn(),
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn().mockResolvedValue(true),
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Error: ${msg}`),
		rooIgnoreError: vi.fn((filePath: string) => `Access denied: ${filePath}`),
		createPrettyPatch: vi.fn(() => "mock-diff"),
	},
}))

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: vi.fn().mockReturnValue(false),
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: vi.fn().mockReturnValue("test/path.txt"),
}))

vi.mock("../../diff/stats", () => ({
	sanitizeUnifiedDiff: vi.fn((diff: string) => diff),
	computeDiffStats: vi.fn(() => ({ additions: 1, deletions: 1 })),
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

describe("editTool", () => {
	// Test data
	const testFilePath = "test/file.txt"
	const absoluteFilePath = process.platform === "win32" ? "C:\\test\\file.txt" : "/test/file.txt"
	const testFileContent = "Line 1\nLine 2\nLine 3\nLine 4"

	// Mocked functions
	const mockedFileExistsAtPath = fileExistsAtPath as MockedFunction<typeof fileExistsAtPath>
	const mockedFsReadFile = fs.readFile as unknown as MockedFunction<
		(path: string, encoding: string) => Promise<string>
	>
	const mockedIsPathOutsideWorkspace = isPathOutsideWorkspace as MockedFunction<typeof isPathOutsideWorkspace>
	const mockedGetReadablePath = getReadablePath as MockedFunction<typeof getReadablePath>
	const mockedPathResolve = path.resolve as MockedFunction<typeof path.resolve>
	const mockedPathIsAbsolute = path.isAbsolute as MockedFunction<typeof path.isAbsolute>

	const mockTask: any = {}
	let mockAskApproval: Mock
	let mockHandleError: Mock
	let mockPushToolResult: Mock
	let toolResult: ToolResponse | undefined

	beforeEach(() => {
		vi.clearAllMocks()

		mockedPathResolve.mockReturnValue(absoluteFilePath)
		mockedPathIsAbsolute.mockReturnValue(false)
		mockedFileExistsAtPath.mockResolvedValue(true)
		mockedFsReadFile.mockResolvedValue(testFileContent)
		mockedIsPathOutsideWorkspace.mockReturnValue(false)
		mockedGetReadablePath.mockReturnValue("test/path.txt")

		mockTask.cwd = "/"
		mockTask.consecutiveMistakeCount = 0
		mockTask.didEditFile = false
		mockTask.providerRef = {
			deref: vi.fn().mockReturnValue({
				getState: vi.fn().mockResolvedValue({
					diagnosticsEnabled: true,
					writeDelayMs: 1000,
					experiments: {},
				}),
			}),
		}
		mockTask.rooIgnoreController = {
			validateAccess: vi.fn().mockReturnValue(true),
		}
		mockTask.rooProtectedController = {
			isWriteProtected: vi.fn().mockReturnValue(false),
		}
		mockTask.diffViewProvider = {
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
			saveDirectly: vi.fn().mockResolvedValue(undefined),
			scrollToFirstDiff: vi.fn(),
		}
		mockTask.fileContextTracker = {
			trackFileContext: vi.fn().mockResolvedValue(undefined),
		}
		mockTask.say = vi.fn().mockResolvedValue(undefined)
		mockTask.ask = vi.fn().mockResolvedValue(undefined)
		mockTask.recordToolError = vi.fn()
		mockTask.recordToolUsage = vi.fn()
		mockTask.processQueuedMessages = vi.fn()
		mockTask.sayAndCreateMissingParamError = vi.fn().mockResolvedValue("Missing param error")

		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn().mockResolvedValue(undefined)

		toolResult = undefined
	})

	/**
	 * Helper function to execute the edit tool with different parameters
	 */
	async function executeEditTool(
		params: {
			file_path?: string
			old_string?: string
			new_string?: string
			replace_all?: string
		} = {},
		options: {
			fileExists?: boolean
			fileContent?: string
			isPartial?: boolean
			accessAllowed?: boolean
			/** search_replace runs the same edit with replace_all always off and its own texts. */
			tool?: "edit" | "search_replace"
		} = {},
	): Promise<ToolResponse | undefined> {
		const toolName = options.tool ?? "edit"
		const fileExists = options.fileExists ?? true
		const fileContent = options.fileContent ?? testFileContent
		const isPartial = options.isPartial ?? false
		const accessAllowed = options.accessAllowed ?? true

		mockedFileExistsAtPath.mockResolvedValue(fileExists)
		mockedFsReadFile.mockResolvedValue(fileContent)
		mockTask.rooIgnoreController.validateAccess.mockReturnValue(accessAllowed)

		const defaultParams = {
			file_path: testFilePath,
			old_string: "Line 2",
			new_string: "Modified Line 2",
		}
		const fullParams: Record<string, string | undefined> = { ...defaultParams, ...params }

		// Build nativeArgs from params (only include defined values)
		const nativeArgs: Record<string, unknown> = {}
		if (fullParams.file_path !== undefined) {
			nativeArgs.file_path = fullParams.file_path
		}
		if (fullParams.old_string !== undefined) {
			nativeArgs.old_string = fullParams.old_string
		}
		if (fullParams.new_string !== undefined) {
			nativeArgs.new_string = fullParams.new_string
		}
		if (fullParams.replace_all !== undefined) {
			nativeArgs.replace_all = fullParams.replace_all === "true"
		}

		const toolUse: ToolUse = {
			type: "tool_use",
			name: toolName,
			params: fullParams as Partial<Record<string, string>>,
			nativeArgs: nativeArgs as ToolUse<"edit">["nativeArgs"],
			partial: isPartial,
		}

		mockPushToolResult = vi.fn((result: ToolResponse) => {
			toolResult = result
		})

		const tool = toolName === "edit" ? editTool : searchReplaceTool
		await tool.handle(mockTask, toolUse as any, {
			askApproval: mockAskApproval,
			handleError: mockHandleError,
			pushToolResult: mockPushToolResult,
		})

		return toolResult
	}

	describe("basic replacement", () => {
		it("replaces a single unique occurrence of old_string with new_string", async () => {
			await executeEditTool(
				{ old_string: "Line 2", new_string: "Modified Line 2" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.diffViewProvider.open).toHaveBeenCalledWith(testFilePath, "modify")
			expect(mockAskApproval).toHaveBeenCalled()
		})
	})

	describe("replace_all", () => {
		it("replaces all occurrences when replace_all is true", async () => {
			await executeEditTool(
				{ old_string: "Line", new_string: "Row", replace_all: "true" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.diffViewProvider.open).toHaveBeenCalledWith(testFilePath, "modify")
			expect(mockAskApproval).toHaveBeenCalled()
		})
	})

	describe("uniqueness check", () => {
		it("returns error when old_string appears multiple times without replace_all", async () => {
			const result = await executeEditTool(
				{ old_string: "Line", new_string: "Row" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(result).toContain("Error:")
			expect(result).toContain("3 matches")
			expect(result).toContain("replace_all")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("edit")
		})
	})

	describe("no match error", () => {
		it("returns error when old_string is not found in the file", async () => {
			const result = await executeEditTool(
				{ old_string: "NonExistent", new_string: "New" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(result).toContain("Error:")
			expect(result).toContain("No match found")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("edit", "no_match")
		})
	})

	describe("old_string equals new_string", () => {
		it("returns error when old_string and new_string are identical", async () => {
			const result = await executeEditTool(
				{ old_string: "Line 2", new_string: "Line 2" },
				{ fileContent: "Line 1\nLine 2\nLine 3" },
			)

			expect(result).toContain("Error:")
			expect(result).toContain("identical")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("edit")
		})
	})

	describe("missing required params", () => {
		it("returns error when file_path is missing", async () => {
			const result = await executeEditTool({ file_path: undefined })

			expect(result).toBe("Missing param error")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("edit")
			expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("edit", "file_path")
		})

		it("returns error when old_string is missing", async () => {
			const result = await executeEditTool({ old_string: undefined })

			expect(result).toBe("Missing param error")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("edit")
			expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("edit", "old_string")
		})

		it("returns error when new_string is missing", async () => {
			const result = await executeEditTool({ new_string: undefined })

			expect(result).toBe("Missing param error")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("edit")
			expect(mockTask.sayAndCreateMissingParamError).toHaveBeenCalledWith("edit", "new_string")
		})
	})

	describe("file access", () => {
		it("returns error when file does not exist", async () => {
			const result = await executeEditTool({}, { fileExists: false })

			expect(result).toContain("Error:")
			expect(result).toContain("File not found")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
		})

		it("returns error when access is denied", async () => {
			const result = await executeEditTool({}, { accessAllowed: false })

			expect(result).toContain("Access denied")
		})
	})

	describe("approval workflow", () => {
		it("saves changes when user approves", async () => {
			mockAskApproval.mockResolvedValue(true)

			await executeEditTool()

			expect(mockTask.diffViewProvider.saveChanges).toHaveBeenCalled()
			expect(mockTask.didEditFile).toBe(true)
			expect(mockTask.recordToolUsage).toHaveBeenCalledWith("edit")
		})

		it("reverts changes when user rejects", async () => {
			mockAskApproval.mockResolvedValue(false)

			const result = await executeEditTool()

			expect(mockTask.diffViewProvider.revertChanges).toHaveBeenCalled()
			expect(mockTask.diffViewProvider.saveChanges).not.toHaveBeenCalled()
			expect(result).toContain("rejected")
		})
	})

	describe("partial block handling", () => {
		it("handles partial block without errors after path stabilizes", async () => {
			// Path stabilization requires two consecutive calls with the same path
			await executeEditTool({}, { isPartial: true })
			await executeEditTool({}, { isPartial: true })

			expect(mockTask.ask).toHaveBeenCalled()
		})
	})

	describe("error handling", () => {
		it("handles file read errors gracefully", async () => {
			mockedFsReadFile.mockRejectedValueOnce(new Error("Read failed"))

			const toolUse: ToolUse = {
				type: "tool_use",
				name: "edit",
				params: {
					file_path: testFilePath,
					old_string: "Line 2",
					new_string: "Modified",
				},
				nativeArgs: {
					file_path: testFilePath,
					old_string: "Line 2",
					new_string: "Modified",
				} as ToolUse<"edit">["nativeArgs"],
				partial: false,
			}

			let capturedResult: ToolResponse | undefined
			const localPushToolResult = vi.fn((result: ToolResponse) => {
				capturedResult = result
			})

			await editTool.handle(mockTask, toolUse as ToolUse<"edit">, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: localPushToolResult,
			})

			expect(capturedResult).toContain("Error:")
			expect(capturedResult).toContain("Failed to read file")
			expect(mockTask.consecutiveMistakeCount).toBe(1)
		})

		it("handles general errors and resets diff view", async () => {
			mockTask.diffViewProvider.open.mockRejectedValueOnce(new Error("General error"))

			await executeEditTool()

			expect(mockHandleError).toHaveBeenCalledWith("edit", expect.any(Error), "edit")
			expect(mockTask.diffViewProvider.reset).toHaveBeenCalled()
		})
	})

	describe("file tracking", () => {
		it("tracks file context after successful edit", async () => {
			await executeEditTool()

			expect(mockTask.fileContextTracker.trackFileContext).toHaveBeenCalledWith(testFilePath, "roo_edited")
		})
	})
	describe("line endings", () => {
		it.each([
			["an LF old_string", "Line 1\nLine 2"],
			["a CRLF old_string", "Line 1\r\nLine 2"],
		])("matches %s against a CRLF file", async (_, oldString) => {
			await executeEditTool(
				{ old_string: oldString, new_string: "Modified Lines" },
				{ fileContent: "Line 1\r\nLine 2\r\nLine 3" },
			)

			expect(mockTask.diffViewProvider.update).toHaveBeenCalledWith("Modified Lines\nLine 3", true)
		})
	})

	describe("literal replacement of $ patterns", () => {
		// String.prototype.replace treats $$, $&, $1, $` and $' in a string replacement as special
		// patterns. The model's new_string is code, so every one of them must reach the file as is.
		it.each([["price = $$5"], ["wrap($&)"], ['s.replace(re, "$1")'], ["before $` marker"], ["after $' marker"]])(
			"writes %s literally",
			async (replacement) => {
				await executeEditTool({ new_string: replacement }, { fileContent: "Line 1\nLine 2\nLine 3" })

				expect(mockTask.diffViewProvider.update).toHaveBeenCalledWith(`Line 1\n${replacement}\nLine 3`, true)
			},
		)

		it("writes $ patterns literally when the file is saved directly", async () => {
			mockTask.providerRef.deref.mockReturnValue({
				getState: vi.fn().mockResolvedValue({
					diagnosticsEnabled: true,
					writeDelayMs: 1000,
					experiments: { preventFocusDisruption: true },
				}),
			})

			await executeEditTool({ old_string: "10", new_string: "$$5 [$&]" }, { fileContent: "cost 10 now" })

			expect(mockTask.diffViewProvider.saveDirectly).toHaveBeenCalledWith(
				testFilePath,
				"cost $$5 [$&] now",
				false,
				true,
				1000,
			)
		})
	})

	describe("plan review gate", () => {
		const mockedPause = vi.mocked(pauseForPlanReviewIfNeeded)

		it("pauses for plan review after saving and appends the review note to the result", async () => {
			mockedPause.mockResolvedValueOnce("The user reviewed the updated plan and approved it.")

			const result = await executeEditTool()

			expect(mockedPause).toHaveBeenCalledWith(mockTask, testFilePath)
			// The gate runs after the file is saved, like every other write tool.
			expect(mockTask.diffViewProvider.saveChanges.mock.invocationCallOrder[0]).toBeLessThan(
				mockedPause.mock.invocationCallOrder[0],
			)
			expect(result).toBe("Tool result message\n\nThe user reviewed the updated plan and approved it.")
		})

		it("does not pause when the user rejects the change", async () => {
			mockAskApproval.mockResolvedValue(false)

			await executeEditTool()

			expect(mockedPause).not.toHaveBeenCalled()
		})
	})

	// search_replace is edit with replace_all always off; the texts it shows the model are its own.
	describe("search_replace", () => {
		it.each([
			[
				"identical strings",
				{ new_string: "Line 2" },
				{},
				"The 'old_string' and 'new_string' parameters must be different.",
			],
			[
				"a missing file",
				{},
				{ fileExists: false },
				"File not found: test/file.txt. Cannot perform search and replace on a non-existent file.",
			],
			["no match", { old_string: "Line 9" }, {}, "No match found for the specified 'old_string'."],
			["two matches", { old_string: "Line" }, {}, "Found 4 matches for the specified 'old_string'."],
		])("reports %s with its own text", async (_, params, options, text) => {
			const result = await executeEditTool(params, { ...options, tool: "search_replace" })

			expect(result).toContain(text)
		})

		it("replaces the one match and saves", async () => {
			await executeEditTool({}, { tool: "search_replace" })

			expect(mockTask.diffViewProvider.update).toHaveBeenCalledWith(
				"Line 1\nModified Line 2\nLine 3\nLine 4",
				true,
			)
			expect(mockTask.diffViewProvider.saveChanges).toHaveBeenCalled()
			expect(mockTask.recordToolUsage).toHaveBeenCalledWith("search_replace")
		})

		it("ignores a stray replace_all", async () => {
			const result = await executeEditTool(
				{ old_string: "Line", replace_all: "true" },
				{ tool: "search_replace" },
			)

			expect(result).toContain("Found 4 matches")
			expect(mockTask.diffViewProvider.update).not.toHaveBeenCalled()
		})

		it.each([
			["short", "Line 2", 'replacing: "Line 2"'],
			["long", "x".repeat(60), `replacing: "${"x".repeat(50)}..."`],
		])("previews a %s old_string while streaming", async (_, oldString, preview) => {
			// The path must arrive twice unchanged before the placeholder is shown.
			await executeEditTool({ old_string: oldString }, { isPartial: true, tool: "search_replace" })
			await executeEditTool({ old_string: oldString }, { isPartial: true, tool: "search_replace" })

			expect(JSON.parse(mockTask.ask.mock.calls[0][1])).toMatchObject({ tool: "appliedDiff", diff: preview })
		})
	})
})
