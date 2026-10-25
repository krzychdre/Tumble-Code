// ReadFileTool on real files in a temporary workspace, with the real readers, binary detection,
// image helpers and response formatting. Only the task and its provider are stand-ins, plus the
// PDF/DOCX text extractor (its own spec covers the libraries behind it). The compact profile is
// pinned in readFileTool.compact.spec.ts.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

import { readFileTool } from "../ReadFileTool"
import { formatResponse } from "../../prompts/responses"
import { extractTextFromFile } from "../../../integrations/misc/extract-text"

vi.mock("../../../integrations/misc/extract-text", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../integrations/misc/extract-text")>()),
	extractTextFromFile: vi.fn(),
}))

const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64)])
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n")

let cwd: string

interface TaskOptions {
	supportsImages?: boolean
	allowed?: (p: string) => boolean
	state?: Record<string, unknown>
	answer?: { response: string; text?: string; images?: string[] }
	imageCapableModes?: () => Promise<Array<{ slug: string; modelId: string }>>
}

function makeTask(options: TaskOptions = {}) {
	return {
		cwd,
		taskMode: "ask",
		apiConfiguration: {},
		api: { getModel: () => ({ info: { supportsImages: options.supportsImages ?? false } }) },
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		didRejectTool: false,
		ask: vi.fn().mockResolvedValue(options.answer ?? { response: "yesButtonClicked" }),
		say: vi.fn().mockResolvedValue(undefined),
		sayAndCreateMissingParamError: vi.fn(async (_tool: string, param: string) => `missing ${param}`),
		recordToolError: vi.fn(),
		rooIgnoreController: { validateAccess: options.allowed ?? (() => true) },
		fileContextTracker: { trackFileContext: vi.fn().mockResolvedValue(undefined) },
		providerRef: {
			deref: () => ({
				getState: async () => options.state ?? {},
				findImageCapableModes: options.imageCapableModes ?? (async () => []),
			}),
		},
	}
}

type FakeTask = ReturnType<typeof makeTask>

async function read(params: Record<string, unknown>, task: FakeTask = makeTask()) {
	const pushToolResult = vi.fn()
	await readFileTool.handle(
		task as any,
		{ type: "tool_use", name: "read_file", id: "call-1", params, nativeArgs: params, partial: false } as any,
		{ askApproval: vi.fn(), handleError: vi.fn(), pushToolResult, toolCallId: "call-1" },
	)
	expect(pushToolResult).toHaveBeenCalledTimes(1)
	return { task, result: pushToolResult.mock.calls[0][0] }
}

const approvalCard = (task: FakeTask) => JSON.parse(task.ask.mock.calls[0][1])

beforeEach(async () => {
	cwd = await fs.mkdtemp(path.join(os.tmpdir(), "read-file-spec-"))
	vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([{ uri: { fsPath: cwd } }] as any)
	await fs.writeFile(path.join(cwd, "short.txt"), "alpha\nbeta\ngamma")
	await fs.writeFile(path.join(cwd, "long.txt"), lines(30))
	await fs.writeFile(path.join(cwd, "empty.txt"), "")
	await fs.writeFile(path.join(cwd, "pic.png"), PNG)
})

afterEach(async () => {
	vi.restoreAllMocks()
	await fs.rm(cwd, { recursive: true, force: true })
})

describe("read_file input", () => {
	it("reports a missing path", async () => {
		const { task, result } = await read({ path: "" })

		expect(result).toBe("Error: missing path")
		expect(task.recordToolError).toHaveBeenCalledWith("read_file")
	})

	it.each([
		[{ path: "short.txt", offset: 0 }, "offset must be a 1-indexed line number (got 0)"],
		[
			{ path: "short.txt", mode: "indentation", indentation: { anchor_line: -1 } },
			"anchor_line must be a 1-indexed line number (got -1)",
		],
	])("refuses %j", async (params, error) => {
		const { task, result } = await read(params)

		expect(result).toContain(error)
		expect(task.ask).not.toHaveBeenCalled()
	})
})

describe("read_file text", () => {
	it.each([
		["the whole file with line numbers", { path: "short.txt" }, "File: short.txt\n1 | alpha\n2 | beta\n3 | gamma"],
		["a slice from an offset", { path: "long.txt", offset: 29 }, "File: long.txt\n29 | line 29\n30 | line 30"],
		["the empty-file note", { path: "empty.txt" }, "File: empty.txt\nNote: File is empty"],
		[
			"the note for an offset past the end",
			{ path: "short.txt", offset: 10 },
			"Note: offset 10 is past the end of the file, which has 3 lines. Use an offset from 1 to 3.",
		],
	])("returns %s", async (_, params, expected) => {
		const { result } = await read(params)

		expect(result).toContain(expected)
	})

	it("puts the truncation notice with the next offset first", async () => {
		const { result } = await read({ path: "long.txt", offset: 5, limit: 3 })

		expect(result).toBe(
			"File: long.txt\nIMPORTANT: File content truncated.\n\tStatus: Showing lines 5-7 of 30 total lines.\n\tTo read more: Use the read_file tool with offset=8 and limit=3.\n\t\n\t5 | line 5\n6 | line 6\n7 | line 7",
		)
	})

	it.each([
		["the anchor line", { anchor_line: 3 }, undefined],
		["the offset when no anchor is given", {}, 3],
	])("reads the indentation block around %s", async (_, indentation, offset) => {
		await fs.writeFile(path.join(cwd, "code.py"), "def a():\n    x = 1\n    y = 2\n\ndef b():\n    pass\n")

		const { task, result } = await read({ path: "code.py", mode: "indentation", offset, indentation })

		expect(result).toContain("2 |     x = 1\n3 |     y = 2")
		expect(result).toMatch(/\n\nIncluded ranges: 1-6 \(total: 7 lines\)$/)
		expect(approvalCard(task)).toMatchObject({ reason: "(indentation mode at line 3)", startLine: 3 })
	})

	it("puts the truncation notice first in indentation mode", async () => {
		await fs.writeFile(path.join(cwd, "code.py"), `def a():\n${lines(10).replace(/^/gm, "    ")}\n`)

		const { result } = await read({
			path: "code.py",
			mode: "indentation",
			limit: 3,
			indentation: { anchor_line: 2 },
		})

		expect(result).toBe(
			"File: code.py\nIMPORTANT: File content truncated.\n\tStatus: Showing lines 1-3 of 12 total lines.\n\tTo read more: Use the read_file tool with offset=4 and limit=3.\n\t\n\t1 | def a():\n2 |     line 1\n3 |     line 2",
		)
	})

	it("names the default limit in an indentation notice without a limit", async () => {
		await fs.writeFile(path.join(cwd, "big.py"), `def a():\n${lines(2100).replace(/^/gm, "    ")}\n`)

		const { result } = await read({ path: "big.py", mode: "indentation", indentation: { anchor_line: 2 } })

		expect(result).toContain("To read more: Use the read_file tool with offset=2001 and limit=2000.")
	})

	it.each([
		[{ path: "long.txt" }, "(up to 2000 lines)", undefined],
		[{ path: "long.txt", offset: 5, limit: 10 }, "(lines 5-14)", 5],
		[{ path: "long.txt", mode: "indentation" }, "(indentation mode at line 1)", 1],
	])("asks with the range of %j", async (params, reason, startLine) => {
		const { task } = await read(params)

		expect(approvalCard(task)).toEqual({
			tool: "readFile",
			path: "long.txt",
			isOutsideWorkspace: false,
			content: path.join(cwd, "long.txt"),
			reason,
			...(startLine ? { startLine } : {}),
			toolCallId: "call-1",
		})
	})

	it("records the read in the file context", async () => {
		const { task } = await read({ path: "short.txt" })

		expect(task.fileContextTracker.trackFileContext).toHaveBeenCalledWith("short.txt", "read_tool")
	})
})

describe("read_file approval", () => {
	it.each<[string, { response: string; text?: string }, string]>([
		[
			"a plain no",
			{ response: "noButtonClicked" },
			`${formatResponse.toolDenied()}\nFile: short.txt\nStatus: Denied by user`,
		],
		[
			"a no with feedback",
			{ response: "noButtonClicked", text: "not that one" },
			`${formatResponse.toolDeniedWithFeedback("not that one")}\nFile: short.txt\nStatus: Denied by user`,
		],
		[
			"a yes with feedback",
			{ response: "yesButtonClicked", text: "look at gamma" },
			`${formatResponse.toolApprovedWithFeedback("look at gamma")}\nFile: short.txt\n1 | alpha\n2 | beta\n3 | gamma`,
		],
	])("answers %s", async (_, answer, expected) => {
		const { task, result } = await read({ path: "short.txt" }, makeTask({ answer }))

		expect(result).toBe(expected)
		expect(task.didRejectTool).toBe(answer.response !== "yesButtonClicked")
		if (answer.text) expect(task.say).toHaveBeenCalledWith("user_feedback", answer.text, undefined)
	})

	it("blocks a .rooignore'd file before asking", async () => {
		const { task, result } = await read({ path: "short.txt" }, makeTask({ allowed: () => false }))

		expect(task.say).toHaveBeenCalledWith("rooignore_error", "short.txt")
		expect(result).toBe(`File: short.txt\nError: ${formatResponse.rooIgnoreError("short.txt")}`)
		expect(task.ask).not.toHaveBeenCalled()
		expect(task.didToolFailInCurrentTurn).toBe(true)
	})

	it.each([
		["a directory", "sub", "Cannot read 'sub' because it is a directory. Use list_files tool instead."],
		["a missing file", "nope.txt", "ENOENT"],
	])("fails the turn for %s", async (_, file, error) => {
		await fs.mkdir(path.join(cwd, "sub"))

		const { task, result } = await read({ path: file })

		expect(result).toContain(`File: ${file}\nError: `)
		expect(result).toContain(error)
		expect(task.say).toHaveBeenCalledWith("error", expect.stringContaining(error))
		expect(task.didToolFailInCurrentTurn).toBe(true)
	})

	it("reports an ask that fails", async () => {
		const task = makeTask()
		task.ask.mockRejectedValue(new Error("aborted"))

		const { result } = await read({ path: "short.txt" }, task)

		expect(result).toBe("File: short.txt\nError: aborted")
		expect(task.say).toHaveBeenCalledWith("error", "Error reading file short.txt: aborted")
	})
})

describe("read_file binary files", () => {
	it("sends an image to a model that can see it", async () => {
		const { task, result } = await read({ path: "pic.png" }, makeTask({ supportsImages: true }))

		expect(result).toEqual([
			{ type: "text", text: expect.stringContaining("File: pic.png\nNote: ") },
			{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG.toString("base64") } },
		])
		expect(task.fileContextTracker.trackFileContext).toHaveBeenCalledWith("pic.png", "read_tool")
	})

	it.each([
		[
			"names the other image-capable modes",
			async () => [
				{ slug: "ask", modelId: "own" },
				{ slug: "vision", modelId: "vlm" },
			],
			"`vision` (runs on vlm)",
			"`ask`",
		],
		[
			"treats a failing mode lookup as none",
			async () => Promise.reject(new Error("no state")),
			"Do NOT delegate this image",
			"`vision`",
		],
	])("for a model that cannot see images %s", async (_, imageCapableModes, shown, hidden) => {
		const { result } = await read({ path: "pic.png" }, makeTask({ imageCapableModes }))

		expect(result).toContain(
			"File: pic.png\nNote: Image file detected but the current model does not support images",
		)
		expect(result).toContain(shown)
		expect(result).not.toContain(hidden)
	})

	it("puts the user's feedback before the image and the file text after it", async () => {
		const answer = { response: "yesButtonClicked", text: "what is this?" }

		const { result } = await read({ path: "pic.png" }, makeTask({ supportsImages: true, answer }))

		expect(result).toEqual([
			{ type: "text", text: formatResponse.toolApprovedWithFeedback("what is this?") },
			{ type: "image", source: expect.objectContaining({ media_type: "image/png" }) },
			{ type: "text", text: expect.stringContaining("File: pic.png\nNote: ") },
		])
	})

	it("skips an image over the per-file limit", async () => {
		const { result } = await read(
			{ path: "pic.png" },
			makeTask({ supportsImages: true, state: { maxImageFileSize: 0.00001 } }),
		)

		expect(result).toMatch(/^File: pic\.png\nNote: /)
		expect(typeof result).toBe("string")
	})

	it("counts every image of a legacy call against the total limit", async () => {
		await fs.writeFile(path.join(cwd, "pic2.png"), PNG)
		const limit = (PNG.length * 1.5) / (1024 * 1024)

		const { result } = await read(
			{ files: [{ path: "pic.png" }, { path: "pic2.png" }] },
			makeTask({ supportsImages: true, state: { maxTotalImageSize: limit } }),
		)

		expect(result).toHaveLength(2)
		expect(result[0].text).toContain("File: pic2.png\nNote: Image skipped to avoid size limit")
	})

	it.each([
		[
			"extracts the text of a document",
			async () => "first\nsecond",
			"File: doc.pdf\nLines 1-2:\n1 | first\n2 | second\n",
		],
		[
			"reports a failed extraction",
			async () => Promise.reject(new Error("bad pdf")),
			"File: doc.pdf\nError: bad pdf",
		],
	])("%s", async (_, extract, expected) => {
		vi.mocked(extractTextFromFile).mockImplementation(extract)
		await fs.writeFile(path.join(cwd, "doc.pdf"), Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(32)]))

		const { result } = await read({ path: "doc.pdf" })

		expect(result).toBe(expected)
	})

	it("does not show a binary file of another kind", async () => {
		await fs.writeFile(path.join(cwd, "blob.bin"), Buffer.alloc(32))

		const { result } = await read({ path: "blob.bin" })

		expect(result).toBe("File: blob.bin\nBinary file (bin) - content not displayed")
	})
})

describe("read_file legacy files format", () => {
	it("reports an empty list", async () => {
		const { result } = await read({ files: [] })

		expect(result).toBe("Error: missing files")
	})

	it("reads each file with its own approval and joins the results", async () => {
		const { task, result } = await read({
			files: [
				{ path: "short.txt" },
				{
					path: "long.txt",
					lineRanges: [
						{ start: 2, end: 3 },
						{ start: 29, end: 99999 },
					],
				},
			],
		})

		expect(task.ask).toHaveBeenCalledTimes(2)
		expect(JSON.parse(task.ask.mock.calls[1][1])).toMatchObject({
			reason: "(lines 2-3), (lines 29-2028)",
			startLine: 2,
		})
		expect(JSON.parse(task.ask.mock.calls[1][1]).toolCallId).toBeUndefined()
		expect(result).toBe(
			"File: short.txt\n1 | alpha\n2 | beta\n3 | gamma\n\n---\n\nFile: long.txt\nIMPORTANT: File content truncated.\n\tStatus: Showing lines 2-3 of 30 total lines.\n\tTo read more: Use the read_file tool with offset=4 and limit=2.\n\t\n\t2 | line 2\n3 | line 3\n\n29 | line 29\n30 | line 30",
		)
	})

	it("reads a line range of unusable numbers as line 1", async () => {
		const { task, result } = await read({ files: [{ path: "long.txt", lineRanges: [{ start: "a", end: null }] }] })

		expect(approvalCard(task).reason).toBe("(lines 1-1)")
		expect(result).toContain("\t1 | line 1")
	})

	it("blocks one file and reads the other", async () => {
		const { result } = await read(
			{ files: [{ path: "short.txt" }, { path: "empty.txt" }] },
			makeTask({ allowed: (p) => p !== "short.txt" }),
		)

		expect(result).toBe(
			`File: short.txt\nError: ${formatResponse.rooIgnoreError("short.txt")}\n\n---\n\nFile: empty.txt\nNote: File is empty`,
		)
	})
})

describe("read_file while streaming", () => {
	it.each([
		[{ path: "short.txt" }, "short.txt", false],
		[{ files: [{ path: "../outside.txt" }] }, "../outside.txt", true],
		[undefined, "", false],
		[{ files: [] }, "", false],
	])("shows a card for %j", async (nativeArgs, shownPath, outside) => {
		const task = makeTask()

		await readFileTool.handlePartial(
			task as any,
			{ type: "tool_use", name: "read_file", id: "call-2", params: {}, nativeArgs, partial: true } as any,
		)

		const [type, message, partial] = task.ask.mock.calls[0]
		expect([type, partial]).toEqual(["tool", true])
		expect(JSON.parse(message)).toMatchObject({
			tool: "readFile",
			isOutsideWorkspace: outside,
			toolCallId: "call-2",
		})
		expect(JSON.parse(message).path).toContain(shownPath.replace("../", ""))
	})
})
