import {
	COMPACT_READ_MAX_CHARS,
	COMPACT_READ_MAX_LINES,
	compactReadLimit,
	compactReadOffset,
	formatCompactRead,
	splitFileLines,
} from "../compactRead"

describe("splitFileLines", () => {
	it("does not count a trailing newline as a line and drops the \\r of CRLF", () => {
		expect(splitFileLines("a\nb\n")).toEqual(["a", "b"])
		expect(splitFileLines("a\r\nb\r\n")).toEqual(["a", "b"])
		expect(splitFileLines("a\nb")).toEqual(["a", "b"])
		expect(splitFileLines("")).toEqual([])
		expect(splitFileLines("\n")).toEqual([""])
	})
})

describe("compactReadLimit / compactReadOffset", () => {
	it("caps the limit at 400 lines and defaults invalid values to the cap", () => {
		expect(compactReadLimit(undefined)).toBe(COMPACT_READ_MAX_LINES)
		expect(compactReadLimit(null)).toBe(COMPACT_READ_MAX_LINES)
		expect(compactReadLimit(2000)).toBe(400)
		expect(compactReadLimit(0)).toBe(400)
		expect(compactReadLimit(25)).toBe(25)
		expect(compactReadLimit("30")).toBe(30)
	})

	it("reads from line 1 for an offset below 1", () => {
		expect(compactReadOffset(undefined)).toBe(1)
		expect(compactReadOffset(0)).toBe(1)
		expect(compactReadOffset(-5)).toBe(1)
		expect(compactReadOffset(12)).toBe(12)
		expect(compactReadOffset("7")).toBe(7)
	})
})

describe("formatCompactRead", () => {
	it("returns a header and raw lines without line numbers", () => {
		const content = "# Coffee\n\n| Time | What |\n| 08:15 | coffee |\n"
		expect(formatCompactRead("notes.md", content, 1, 400)).toBe(
			"File: notes.md (lines 1-4 of 4)\n# Coffee\n\n| Time | What |\n| 08:15 | coffee |",
		)
	})

	it("adds the truncation line with the next offset when more lines follow", () => {
		const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n")
		const result = formatCompactRead("a.txt", content, 3, 4)
		expect(result).toBe(
			[
				"File: a.txt (lines 3-6 of 10)",
				"line 3",
				"line 4",
				"line 5",
				"line 6",
				"[Truncated: showing lines 3-6 of 10. Call read_file with offset=7 to read more.]",
			].join("\n"),
		)
	})

	it("continues from the offset the truncation line names", () => {
		const content = Array.from({ length: 450 }, (_, i) => `row ${i + 1}`).join("\n")
		const first = formatCompactRead("big.md", content, 1, 400)
		expect(first.split("\n")[0]).toBe("File: big.md (lines 1-400 of 450)")
		expect(first.split("\n").at(-1)).toBe(
			"[Truncated: showing lines 1-400 of 450. Call read_file with offset=401 to read more.]",
		)
		const second = formatCompactRead("big.md", content, 401, 400)
		expect(second.split("\n")[0]).toBe("File: big.md (lines 401-450 of 450)")
		expect(second.split("\n")[1]).toBe("row 401")
		expect(second).not.toContain("[Truncated")
	})

	it("caps one read at 400 lines even when a larger limit is passed", () => {
		const content = Array.from({ length: 1000 }, (_, i) => `${i}`).join("\n")
		const result = formatCompactRead("n.txt", content, 1, 2000)
		expect(result.split("\n")[0]).toBe("File: n.txt (lines 1-400 of 1000)")
	})

	it("cuts at a line boundary when the content would exceed 16,000 characters", () => {
		const line = "x".repeat(99) // 100 characters with the newline
		const content = Array.from({ length: 300 }, () => line).join("\n")
		const result = formatCompactRead("wide.txt", content, 1, 400)
		const lines = result.split("\n")
		const shown = lines.slice(1, -1)
		expect(shown).toHaveLength(COMPACT_READ_MAX_CHARS / 100)
		expect(shown.every((l) => l === line)).toBe(true)
		expect(lines[0]).toBe("File: wide.txt (lines 1-160 of 300)")
		expect(lines.at(-1)).toBe(
			"[Truncated: showing lines 1-160 of 300. Call read_file with offset=161 to read more.]",
		)
	})

	it("always shows at least one line", () => {
		const content = "y".repeat(1500) + "\n" + "z".repeat(10)
		const result = formatCompactRead("one.txt", content, 1, 400)
		expect(result.split("\n")[1]).toBe("y".repeat(1500))
	})

	it("shows CRLF files without \\r", () => {
		expect(formatCompactRead("w.txt", "a\r\nb\r\n", 1, 400)).toBe("File: w.txt (lines 1-2 of 2)\na\nb")
	})

	it("names an empty file and an offset past the end", () => {
		expect(formatCompactRead("e.txt", "", 1, 400)).toBe("File: e.txt (empty file)")
		expect(formatCompactRead("s.txt", "a\nb\n", 5, 400)).toBe(
			"File: s.txt (2 lines)\nNote: offset 5 is past the end of the file. Use an offset from 1 to 2.",
		)
	})
})
