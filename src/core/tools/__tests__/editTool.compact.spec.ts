/**
 * `edit` under the compact profile: the lenient matching chain, the short
 * errors that quote the file, the empty-old_string rules, and the proof that
 * without the flag the tool answers exactly as before.
 */
import fs from "fs/promises"

import { fileExistsAtPath } from "../../../utils/fs"
import { applyComputedEdit } from "../helpers/applyComputedEdit"
import { editTool } from "../EditTool"

vi.mock("fs/promises", () => ({
	default: { readFile: vi.fn() },
}))

vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))

vi.mock("../helpers/applyComputedEdit", () => ({
	applyComputedEdit: vi.fn().mockResolvedValue("saved"),
}))

const mockedReadFile = vi.mocked(fs.readFile) as unknown as ReturnType<typeof vi.fn>
const mockedExists = vi.mocked(fileExistsAtPath)
const mockedApply = vi.mocked(applyComputedEdit)

const DIARY = [
	"# Coffee diary",
	"",
	"## 2026-10-09",
	"",
	"| Time | What |",
	"| --- | --- |",
	"| 08:10 | coffee 180 ml + milk 40 ml |",
	"| 13:00 | coffee 180 ml + milk 40 ml |",
	"",
	"## 2026-10-10",
	"",
	"| Time | What |",
	"| --- | --- |",
	"| 08:15 | coffee 180 ml + milk 40 ml |",
	"",
].join("\n")

function createTask(compactProfile: boolean | undefined) {
	return {
		cwd: "/ws",
		apiConfiguration: compactProfile === undefined ? {} : { compactProfile },
		consecutiveMistakeCount: 0,
		rooIgnoreController: { validateAccess: vi.fn().mockReturnValue(true) },
		say: vi.fn().mockResolvedValue(undefined),
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("LONG MISSING PARAMETER TEXT"),
		recordToolError: vi.fn(),
		recordToolUsage: vi.fn(),
		processQueuedMessages: vi.fn(),
		diffViewProvider: { reset: vi.fn().mockResolvedValue(undefined) },
	}
}

async function runEdit(
	params: Record<string, unknown>,
	options: { compact?: boolean; content?: string | null } = {},
): Promise<{ task: ReturnType<typeof createTask>; result: string | undefined }> {
	// `compact: undefined` stands for a profile without the flag, so no destructuring default here.
	const compact = "compact" in options ? options.compact : true
	const content = options.content === undefined ? DIARY : options.content
	mockedExists.mockResolvedValue(content !== null)
	mockedReadFile.mockResolvedValue(content ?? "")
	const task = createTask(compact)
	const pushToolResult = vi.fn()
	await editTool.execute(
		params as any,
		task as any,
		{
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult,
		} as any,
	)
	return { task, result: pushToolResult.mock.calls[0]?.[0] }
}

/** The content passed to the save step of the last successful edit. */
function savedContent(): string {
	return mockedApply.mock.calls.at(-1)![2] as string
}

beforeEach(() => {
	vi.clearAllMocks()
	mockedApply.mockResolvedValue("saved")
})

describe("edit under the compact profile", () => {
	it("applies an exact match", async () => {
		const { task, result } = await runEdit({
			file_path: "diary.md",
			old_string: "| 08:15 | coffee 180 ml + milk 40 ml |",
			new_string: "| 08:15 | coffee 180 ml + milk 40 ml |\n| 09:40 | coffee 180 ml + milk 40 ml |",
		})
		expect(result).toBeUndefined()
		expect(savedContent()).toContain(
			"| 08:15 | coffee 180 ml + milk 40 ml |\n| 09:40 | coffee 180 ml + milk 40 ml |\n",
		)
		expect(mockedApply.mock.calls[0][4]).toMatchObject({ originalContent: DIARY, resultSuffix: "" })
		expect(task.consecutiveMistakeCount).toBe(0)
		expect(task.recordToolUsage).toHaveBeenCalledWith("edit")
	})

	it("coffee diary: old_string with `  14 | ` prefixes lands in today's table", async () => {
		const { result } = await runEdit({
			file_path: "diary.md",
			old_string: "  14 | | 08:15 | coffee 180 ml + milk 40 ml |",
			new_string:
				"  14 | | 08:15 | coffee 180 ml + milk 40 ml |\n  15 | | 09:40 | coffee 180 ml + milk 40 ml |\n  16 | | 12:00 | coffee 180 ml + milk 40 ml |",
		})
		expect(result).toBeUndefined()
		const lines = savedContent().split("\n")
		expect(lines.slice(9)).toEqual([
			"## 2026-10-10",
			"",
			"| Time | What |",
			"| --- | --- |",
			"| 08:15 | coffee 180 ml + milk 40 ml |",
			"| 09:40 | coffee 180 ml + milk 40 ml |",
			"| 12:00 | coffee 180 ml + milk 40 ml |",
			"",
		])
		expect(lines.slice(0, 9)).toEqual(DIARY.split("\n").slice(0, 9))
		expect(mockedApply.mock.calls[0][4]?.resultSuffix).toContain("line numbers were removed")
	})

	it("matches with different whitespace and says so in the result", async () => {
		await runEdit({
			file_path: "diary.md",
			old_string: "|  08:15 | coffee 180 ml + milk 40 ml |   ",
			new_string: "| 08:15 | tea |",
		})
		expect(savedContent().split("\n")[13]).toBe("| 08:15 | tea |")
		expect(mockedApply.mock.calls[0][4]?.resultSuffix).toContain("ignoring whitespace differences")
	})

	it("keeps CRLF line endings of the file", async () => {
		await runEdit({ file_path: "w.txt", old_string: "b", new_string: "B" }, { content: "a\r\nb\r\nc\r\n" })
		expect(savedContent()).toBe("a\r\nB\r\nc\r\n")
	})

	it("re-indents new_string to the matched lines", async () => {
		await runEdit(
			{ file_path: "f.ts", old_string: "if (x) {\nreturn 1\n}", new_string: "if (x) {\nreturn 2\n}" },
			{ content: "function f() {\n\tif (x) {\n\treturn 1\n\t}\n}\n" },
		)
		expect(savedContent()).toBe("function f() {\n\tif (x) {\n\treturn 2\n\t}\n}\n")
	})

	it("several matches: names the count and lines, asks for a neighbouring line, counts a mistake", async () => {
		const { task, result } = await runEdit({
			file_path: "diary.md",
			old_string: "| Time | What |",
			new_string: "| Hour | What |",
		})
		expect(result).toBe(
			[
				"Error: old_string matches 2 places in diary.md (lines 5, 12). Add an unchanged neighbouring line to old_string so it matches only one place, or set replace_all to true to change all of them.",
				'Example edit call: {"file_path":"diary.md","old_string":"## 2026-10-09\\n\\n| Time | What |","new_string":"<new text>"}',
			].join("\n"),
		)
		expect(mockedApply).not.toHaveBeenCalled()
		expect(task.consecutiveMistakeCount).toBe(1)
		expect(task.recordToolError).toHaveBeenCalledWith("edit")
	})

	it("replace_all changes every match", async () => {
		await runEdit({
			file_path: "diary.md",
			old_string: "| Time | What |",
			new_string: "| Hour | What |",
			replace_all: true,
		})
		expect(savedContent()).not.toContain("| Time | What |")
		expect(mockedApply.mock.calls[0][4]?.resultSuffix).toBe(" (2 replacements)")
	})

	it("no match: quotes the closest snippet and one corrected call, within 800 characters", async () => {
		const { task, result } = await runEdit({
			file_path: "diary.md",
			old_string: "  14 | | 08:15 | kawa 180 ml + mleko 40 ml |",
			new_string: "x",
		})
		expect(result).toBe(
			[
				"Error: old_string was not found in diary.md. The closest text in the file (line 14) is:",
				"| 08:15 | coffee 180 ml + milk 40 ml |",
				"Copy old_string exactly from the file text, without line numbers.",
				'Example edit call: {"file_path":"diary.md","old_string":"| 08:15 | coffee 180 ml + milk 40 ml |","new_string":"<new text>"}',
			].join("\n"),
		)
		expect(result!.length).toBeLessThanOrEqual(800)
		expect(task.consecutiveMistakeCount).toBe(1)
		expect(task.recordToolError).toHaveBeenCalledWith("edit", "no_match")
	})

	it("no match on a long file stays short", async () => {
		const content = Array.from({ length: 500 }, (_, i) => `line ${i} ${"word ".repeat(30)}`).join("\n")
		const { result } = await runEdit(
			{
				file_path: "long.txt",
				old_string: Array.from({ length: 20 }, (_, i) => `nope ${i} ${"word ".repeat(30)}`).join("\n"),
				new_string: "x",
			},
			{ content },
		)
		expect(result).toMatch(/^Error: old_string was not found in long.txt/)
		expect(result!.length).toBeLessThanOrEqual(800)
		expect(result).not.toMatch(/^\s*\d+ \| /m)
	})

	it("no match in a file of blank lines quotes them without suggesting an empty old_string", async () => {
		const { result } = await runEdit(
			{ file_path: "b.txt", old_string: "x", new_string: "y" },
			{ content: "\n\n\n" },
		)
		expect(result).toBe(
			[
				"Error: old_string was not found in b.txt. The closest text in the file (line 1) is:",
				"",
				"Copy old_string exactly from the file text, without line numbers.",
			].join("\n"),
		)
	})

	it("empty old_string on a missing file creates it with new_string", async () => {
		const { task, result } = await runEdit(
			{ file_path: "new/notes.md", old_string: "", new_string: "# Notes\n" },
			{ content: null },
		)
		expect(result).toBeUndefined()
		expect(savedContent()).toBe("# Notes\n")
		expect(mockedApply.mock.calls[0][4]).toMatchObject({
			isNewFile: true,
			cardTool: "newFileCreated",
			originalContent: "",
		})
		expect(task.consecutiveMistakeCount).toBe(0)
	})

	it("a missing old_string counts as empty", async () => {
		await runEdit({ file_path: "n.md", new_string: "hello" }, { content: null })
		expect(savedContent()).toBe("hello")
	})

	it("empty old_string on an existing file quotes its last 3 lines as the old_string to append after", async () => {
		const { task, result } = await runEdit({ file_path: "diary.md", old_string: "", new_string: "| 09:40 | x |" })
		expect(result).toBe(
			[
				"Error: old_string is empty, but diary.md already exists. To add text at the end, use its last lines as old_string and repeat them at the start of new_string. The file ends with (lines 12-14):",
				"| Time | What |",
				"| --- | --- |",
				"| 08:15 | coffee 180 ml + milk 40 ml |",
				'Example edit call: {"file_path":"diary.md","old_string":"| Time | What |\\n| --- | --- |\\n| 08:15 | coffee 180 ml + milk 40 ml |","new_string":"| Time | What |\\n| --- | --- |\\n| 08:15 | coffee 180 ml + milk 40 ml |\\n<new text>"}',
			].join("\n"),
		)
		expect(mockedApply).not.toHaveBeenCalled()
		expect(task.consecutiveMistakeCount).toBe(1)
	})

	it("the old_string suggested for appending matches the file once", async () => {
		const { result } = await runEdit({ file_path: "diary.md", old_string: "", new_string: "x" })
		const example = JSON.parse(result!.split("Example edit call: ")[1])
		vi.clearAllMocks()
		mockedApply.mockResolvedValue("saved")
		await runEdit({ ...example, new_string: example.new_string.replace("<new text>", "| 09:40 | coffee |") })
		expect(savedContent()).toBe(DIARY.replace(/\n$/, "\n| 09:40 | coffee |\n"))
	})

	it("empty old_string on an existing empty file writes new_string", async () => {
		await runEdit({ file_path: "e.md", old_string: "", new_string: "first" }, { content: "" })
		expect(savedContent()).toBe("first")
		expect(mockedApply.mock.calls[0][4]).toMatchObject({ isNewFile: false, originalContent: "" })
	})

	it("short errors for a missing parameter, a missing file and identical strings", async () => {
		const missing = await runEdit({ old_string: "a", new_string: "b" })
		expect(missing.result).toBe(
			'Error: Missing parameter \'file_path\'.\nExample edit call: {"file_path":"src/app.ts","old_string":"const a = 1","new_string":"const a = 2"}',
		)
		expect(missing.task.sayAndCreateMissingParamError).toHaveBeenCalledWith("edit", "file_path")
		expect(missing.task.consecutiveMistakeCount).toBe(1)

		const noNew = await runEdit({ file_path: "diary.md", old_string: "a" })
		expect(noNew.result).toMatch(/^Error: Missing parameter 'new_string'\./)

		const notFound = await runEdit({ file_path: "nope.md", old_string: "a", new_string: "b" }, { content: null })
		expect(notFound.result).toBe(
			'Error: nope.md does not exist. Check the path with list_files, or create the file with write_to_file.\nExample write_to_file call: {"path":"nope.md","content":"export const a = 1\\n"}',
		)
		expect(notFound.task.consecutiveMistakeCount).toBe(1)

		const same = await runEdit({ file_path: "diary.md", old_string: "| --- | --- |", new_string: "| --- | --- |" })
		expect(same.result).toMatch(/^Error: old_string and new_string are identical/)
		expect(same.task.consecutiveMistakeCount).toBe(1)
	})
})

describe("edit without the compact profile (unchanged)", () => {
	for (const flag of [undefined, false]) {
		it(`compactProfile ${String(flag)}: prefixed old_string is a plain no-match error`, async () => {
			const { task, result } = await runEdit(
				{
					file_path: "diary.md",
					old_string: "  14 | | 08:15 | coffee 180 ml + milk 40 ml |",
					new_string: "x",
				},
				{ compact: flag },
			)
			expect(result).toBe(
				JSON.stringify({
					status: "error",
					message: "The tool execution failed",
					error: "No match found for 'old_string' in diary.md. Make sure the text to find appears exactly in the file, including whitespace and indentation.",
				}),
			)
			expect(task.consecutiveMistakeCount).toBe(1)
		})

		it(`compactProfile ${String(flag)}: empty old_string is a missing parameter, CRLF becomes LF`, async () => {
			const empty = await runEdit({ file_path: "diary.md", old_string: "", new_string: "x" }, { compact: flag })
			expect(empty.result).toBe("LONG MISSING PARAMETER TEXT")
			expect(mockedApply).not.toHaveBeenCalled()

			await runEdit(
				{ file_path: "w.txt", old_string: "b", new_string: "B" },
				{ compact: flag, content: "a\r\nb\r\n" },
			)
			expect(savedContent()).toBe("a\nB\n")
		})

		it(`compactProfile ${String(flag)}: several matches give the old error text`, async () => {
			const { result } = await runEdit(
				{ file_path: "diary.md", old_string: "| Time | What |", new_string: "| Hour | What |" },
				{ compact: flag },
			)
			expect(JSON.parse(result!).error).toBe(
				"Found 2 matches of 'old_string' in the file. Use 'replace_all: true' to replace all occurrences, or provide more context in 'old_string' to make it unique.",
			)
		})
	}
})
