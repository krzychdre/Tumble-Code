/**
 * `read_file` under the compact profile: raw lines under one header line, the
 * truncation line with the next offset, the 400-line and 16,000-character
 * limits, and the proof that without the flag the output is unchanged.
 */
import { isBinaryFile } from "isbinaryfile"

import { extractTextFromFile, getSupportedBinaryFormats } from "../../../integrations/misc/extract-text"
import { readFileTool } from "../ReadFileTool"

vi.mock("fs/promises", () => ({
	readFile: vi.fn(),
	stat: vi.fn(),
}))

vi.mock("isbinaryfile")

vi.mock("../../../integrations/misc/extract-text", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../integrations/misc/extract-text")>()),
	extractTextFromFile: vi.fn(),
	getSupportedBinaryFormats: vi.fn(),
}))

const fsPromises = await import("fs/promises")
const mockedReadFile = vi.mocked(fsPromises.readFile)
const mockedStat = vi.mocked(fsPromises.stat)
const mockedIsBinaryFile = vi.mocked(isBinaryFile)
const mockedExtractText = vi.mocked(extractTextFromFile)
const mockedBinaryFormats = vi.mocked(getSupportedBinaryFormats)

const DIARY = "# Coffee diary\n\n## 2026-10-10\n\n| Time | What |\n| --- | --- |\n| 08:15 | coffee |\n"

function createTask(compactProfile: boolean | undefined) {
	return {
		cwd: "/ws",
		taskMode: "code",
		apiConfiguration: compactProfile === undefined ? {} : { compactProfile },
		api: { getModel: vi.fn().mockReturnValue({ info: { supportsImages: false } }) },
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		didRejectTool: false,
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		say: vi.fn().mockResolvedValue(undefined),
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("LONG MISSING PARAMETER TEXT"),
		recordToolError: vi.fn(),
		rooIgnoreController: { validateAccess: vi.fn().mockReturnValue(true) },
		fileContextTracker: { trackFileContext: vi.fn().mockResolvedValue(undefined) },
		providerRef: {
			deref: vi.fn().mockReturnValue({
				getState: vi.fn().mockResolvedValue({}),
				findImageCapableModes: vi.fn().mockResolvedValue([]),
			}),
		},
	}
}

async function read(
	params: Record<string, unknown>,
	content: string,
	// A profile without the flag is `{ compactProfile: undefined }`, so no parameter default here.
	options: { compactProfile?: boolean } = { compactProfile: true },
): Promise<{ task: ReturnType<typeof createTask>; result: string }> {
	mockedReadFile.mockResolvedValue(Buffer.from(content) as any)
	const task = createTask(options.compactProfile)
	const pushToolResult = vi.fn()
	await readFileTool.execute(
		params as any,
		task as any,
		{
			pushToolResult,
			askApproval: vi.fn(),
			handleError: vi.fn(),
		} as any,
	)
	return { task, result: pushToolResult.mock.calls[0][0] }
}

beforeEach(() => {
	vi.clearAllMocks()
	mockedStat.mockResolvedValue({ isDirectory: () => false } as any)
	mockedIsBinaryFile.mockResolvedValue(false)
	mockedBinaryFormats.mockReturnValue([".pdf", ".docx"])
})

describe("read_file under the compact profile", () => {
	it("returns the header line and raw lines without line numbers", async () => {
		const { result } = await read({ path: "diary.md" }, DIARY)
		expect(result).toBe(
			"File: diary.md (lines 1-7 of 7)\n# Coffee diary\n\n## 2026-10-10\n\n| Time | What |\n| --- | --- |\n| 08:15 | coffee |",
		)
	})

	it("truncates at 400 lines and the named offset continues the read", async () => {
		const content = Array.from({ length: 1000 }, (_, i) => `row ${i + 1}`).join("\n")
		const first = await read({ path: "big.md", limit: 2000 }, content)
		const firstLines = first.result.split("\n")
		expect(firstLines[0]).toBe("File: big.md (lines 1-400 of 1000)")
		expect(firstLines).toHaveLength(402)
		expect(firstLines.at(-1)).toBe(
			"[Truncated: showing lines 1-400 of 1000. Call read_file with offset=401 to read more.]",
		)

		const second = await read({ path: "big.md", offset: 401 }, content)
		const secondLines = second.result.split("\n")
		expect(secondLines[0]).toBe("File: big.md (lines 401-800 of 1000)")
		expect(secondLines[1]).toBe("row 401")
	})

	it("stops at 16,000 characters of content", async () => {
		const content = Array.from({ length: 400 }, () => "x".repeat(199)).join("\n")
		const { result } = await read({ path: "wide.txt" }, content)
		expect(result.split("\n")[0]).toBe("File: wide.txt (lines 1-80 of 400)")
		expect(result.split("\n").at(-1)).toBe(
			"[Truncated: showing lines 1-80 of 400. Call read_file with offset=81 to read more.]",
		)
	})

	it("treats mode/indentation as a plain slice and clamps an offset of 0", async () => {
		const { result } = await read(
			{ path: "diary.md", mode: "indentation", offset: 0, indentation: { anchor_line: 0 } },
			DIARY,
		)
		expect(result.split("\n")[0]).toBe("File: diary.md (lines 1-7 of 7)")
	})

	it("names the compact limit in the approval card", async () => {
		const { task } = await read({ path: "diary.md" }, DIARY)
		expect(JSON.parse(task.ask.mock.calls[0][1]).reason).toBe("(up to 400 lines)")
	})

	it("missing path: short error with an example, still counted as a mistake", async () => {
		const { task, result } = await read({}, DIARY)
		expect(result).toBe('Error: Missing parameter \'path\'.\nExample read_file call: {"path":"src/app.ts"}')
		expect(task.consecutiveMistakeCount).toBe(1)
		expect(task.sayAndCreateMissingParamError).toHaveBeenCalledWith("read_file", "path")
	})

	it("shows extracted document text without the extractor's line numbers", async () => {
		mockedIsBinaryFile.mockResolvedValue(true)
		mockedExtractText.mockResolvedValue("1 | Invoice\n2 | \n3 | Total: 12 EUR\n")
		const { result } = await read({ path: "doc.pdf" }, "")
		expect(result).toBe("File: doc.pdf (lines 1-3 of 3)\nInvoice\n\nTotal: 12 EUR")
	})

	it("slices extracted document text by offset and limit, so the named offset reads on", async () => {
		mockedIsBinaryFile.mockResolvedValue(true)
		mockedExtractText.mockResolvedValue(
			Array.from({ length: 1000 }, (_, i) => `${i + 1} | page line ${i + 1}`).join("\n") + "\n",
		)

		const first = await read({ path: "report.pdf" }, "")
		expect(first.result.split("\n")[0]).toBe("File: report.pdf (lines 1-400 of 1000)")
		expect(first.result.split("\n").at(-1)).toBe(
			"[Truncated: showing lines 1-400 of 1000. Call read_file with offset=401 to read more.]",
		)

		const second = await read({ path: "report.pdf", offset: 401 }, "")
		const secondLines = second.result.split("\n")
		expect(secondLines[0]).toBe("File: report.pdf (lines 401-800 of 1000)")
		expect(secondLines[1]).toBe("page line 401")

		const limited = await read({ path: "report.pdf", offset: 998, limit: 2 }, "")
		expect(limited.result).toBe(
			"File: report.pdf (lines 998-999 of 1000)\npage line 998\npage line 999\n[Truncated: showing lines 998-999 of 1000. Call read_file with offset=1000 to read more.]",
		)
	})

	it("legacy line ranges become compact blocks", async () => {
		const content = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join("\n")
		const { result } = await read({ files: [{ path: "a.txt", lineRanges: [{ start: 2, end: 3 }] }] }, content)
		expect(result).toBe(
			"File: a.txt (lines 2-3 of 20)\nl2\nl3\n[Truncated: showing lines 2-3 of 20. Call read_file with offset=4 to read more.]",
		)
	})
})

describe("read_file without the compact profile (unchanged)", () => {
	for (const flag of [undefined, false]) {
		it(`compactProfile ${String(flag)}: numbered lines as before`, async () => {
			const { result } = await read({ path: "diary.md" }, DIARY, { compactProfile: flag })
			expect(result).toBe(
				[
					"File: diary.md",
					"1 | # Coffee diary",
					"2 | ",
					"3 | ## 2026-10-10",
					"4 | ",
					"5 | | Time | What |",
					"6 | | --- | --- |",
					"7 | | 08:15 | coffee |",
					"8 | ",
				].join("\n"),
			)
		})

		it(`compactProfile ${String(flag)}: offset 0 is still an error`, async () => {
			const { result } = await read({ path: "diary.md", offset: 0 }, DIARY, { compactProfile: flag })
			expect(result).toBe("Error: offset must be a 1-indexed line number (got 0). Line numbers start at 1.")
		})

		it(`compactProfile ${String(flag)}: missing path keeps the long text`, async () => {
			const { result } = await read({}, DIARY, { compactProfile: flag })
			expect(result).toBe("Error: LONG MISSING PARAMETER TEXT")
		})
	}
})
