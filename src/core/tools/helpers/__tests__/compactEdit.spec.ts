import {
	compactReplace,
	findClosestSnippet,
	hasLineNumberPrefixes,
	lastLines,
	matchWithContext,
	stripCopiedLineNumbers,
	stripLineNumberPrefixes,
} from "../compactEdit"

/** A coffee diary with one table per day; the tables share their header lines. */
const DIARY = [
	"# Coffee diary", // 1
	"", // 2
	"## 2026-10-09", // 3
	"", // 4
	"| Time | What |", // 5
	"| --- | --- |", // 6
	"| 08:10 | coffee 180 ml + milk 40 ml |", // 7
	"| 13:00 | coffee 180 ml + milk 40 ml |", // 8
	"", // 9
	"## 2026-10-10", // 10
	"", // 11
	"| Time | What |", // 12
	"| --- | --- |", // 13
	"| 08:15 | coffee 180 ml + milk 40 ml |", // 14
	"",
].join("\n")

describe("line-number prefixes", () => {
	it("detects prefixes on all or nearly all non-empty lines", () => {
		expect(hasLineNumberPrefixes("  12 | | 08:15 | coffee |")).toBe(true)
		expect(hasLineNumberPrefixes("12 | a\n13 | b\n\n14 | c")).toBe(true)
		expect(hasLineNumberPrefixes("1 | a\n2 | b\n3 | c\n4 | d\ne")).toBe(true) // 4 of 5
		expect(hasLineNumberPrefixes("1 | a\nb")).toBe(false)
		expect(hasLineNumberPrefixes("| 08:15 | coffee |")).toBe(false)
		expect(hasLineNumberPrefixes("a || b")).toBe(false)
	})

	it("strips one space after the pipe and keeps the line's own indentation", () => {
		expect(stripLineNumberPrefixes("  3 |     return x\n  4 | }")).toBe("    return x\n}")
		expect(stripLineNumberPrefixes("12 | | 08:15 | coffee |")).toBe("| 08:15 | coffee |")
	})

	it("write_to_file stripping needs every non-empty line in read_file's format", () => {
		expect(stripCopiedLineNumbers("1 | a\n2 | b\n")).toBe("a\nb\n")
		expect(stripCopiedLineNumbers("1 | a\n\n3 | c")).toBe("a\n\nc")
		expect(stripCopiedLineNumbers("1 | a\r\n2 | b\r\n")).toBe("a\r\nb\r\n")
		// Pipe-separated data without a space before the pipe stays as it is.
		expect(stripCopiedLineNumbers("1|a\n2|b\n")).toBe("1|a\n2|b\n")
		expect(stripCopiedLineNumbers("1 | a\nplain\n")).toBe("1 | a\nplain\n")
		expect(stripCopiedLineNumbers("")).toBe("")
	})
})

describe("compactReplace", () => {
	it("(a) replaces a unique exact match", () => {
		const result = compactReplace("one\ntwo\nthree\n", "two", "2", false)
		expect(result).toEqual({
			kind: "replaced",
			content: "one\n2\nthree\n",
			count: 1,
			strategy: "exact",
			strippedLineNumbers: false,
		})
	})

	it("(b) coffee diary: strips line-number prefixes from old_string and new_string", () => {
		const oldString = "  14 | | 08:15 | coffee 180 ml + milk 40 ml |"
		const newString = [
			"  14 | | 08:15 | coffee 180 ml + milk 40 ml |",
			"  15 | | 09:40 | coffee 180 ml + milk 40 ml |",
			"| 12:00 | coffee 180 ml + milk 40 ml |",
		].join("\n")

		const result = compactReplace(DIARY, oldString, newString, false)

		expect(result.kind).toBe("replaced")
		if (result.kind !== "replaced") return
		expect(result.strategy).toBe("line_numbers")
		expect(result.strippedLineNumbers).toBe(true)
		const lines = result.content.split("\n")
		expect(lines.slice(13, 16)).toEqual([
			"| 08:15 | coffee 180 ml + milk 40 ml |",
			"| 09:40 | coffee 180 ml + milk 40 ml |",
			"| 12:00 | coffee 180 ml + milk 40 ml |",
		])
		// The other day's table is untouched.
		expect(lines.slice(4, 8)).toEqual(DIARY.split("\n").slice(4, 8))
	})

	it("(b) strips prefixes from a multi-line old_string copied from the old read_file output", () => {
		const oldString = "10 | ## 2026-10-10\n11 | \n12 | | Time | What |"
		const result = compactReplace(DIARY, oldString, "## 2026-10-10\n\n| Hour | What |", false)
		expect(result.kind).toBe("replaced")
		if (result.kind !== "replaced") return
		expect(result.content.split("\n")[11]).toBe("| Hour | What |")
		expect(result.content.split("\n")[4]).toBe("| Time | What |")
	})

	it("keeps an exact match even when old_string looks numbered", () => {
		const content = "1 | 2 | 3\n4 | 5 | 6\n"
		const result = compactReplace(content, "1 | 2 | 3", "7 | 8 | 9", false)
		expect(result).toMatchObject({ kind: "replaced", strategy: "exact", content: "7 | 8 | 9\n4 | 5 | 6\n" })
	})

	it("(c) matches lines that differ only in trailing whitespace", () => {
		const content = "alpha   \nbeta\t\ngamma\n"
		const result = compactReplace(content, "alpha\nbeta", "ALPHA\nBETA", false)
		expect(result).toMatchObject({ kind: "replaced", strategy: "whitespace", content: "ALPHA\nBETA\ngamma\n" })
	})

	it("(c) matches with different indentation and re-indents new_string to the file", () => {
		const content = "function f() {\n    if (x) {\n        return 1\n    }\n}\n"
		const oldString = "if (x) {\n    return 1\n}"
		const newString = "if (x) {\n    log()\n    return 2\n}"
		const result = compactReplace(content, oldString, newString, false)
		expect(result.kind).toBe("replaced")
		if (result.kind !== "replaced") return
		expect(result.content).toBe("function f() {\n    if (x) {\n        log()\n        return 2\n    }\n}\n")
	})

	it("(c) tolerates collapsed inner whitespace in a padded markdown table", () => {
		const content = "| Time  | What   |\n| 08:15 | coffee |\n"
		const result = compactReplace(content, "| 08:15 |  coffee |", "| 08:15 | tea |", false)
		expect(result).toMatchObject({ kind: "replaced", content: "| Time  | What   |\n| 08:15 | tea |\n" })
	})

	it("(c) a substring inside a line may differ in whitespace runs", () => {
		const content = "const total = add(a,  b) + 1\n"
		const result = compactReplace(content, "add(a, b)", "sum(a, b)", false)
		expect(result).toMatchObject({ kind: "replaced", content: "const total = sum(a, b) + 1\n" })
	})

	it("reports several exact matches with their line numbers", () => {
		const result = compactReplace(DIARY, "| Time | What |", "| Hour | What |", false)
		expect(result).toEqual({
			kind: "multiple",
			count: 2,
			matches: [
				{ startLine: 5, endLine: 5 },
				{ startLine: 12, endLine: 12 },
			],
		})
	})

	it("reports several tolerant matches instead of picking one", () => {
		const content = "  x = 1\nother\n    x = 1\n"
		const result = compactReplace(content, "x = 1", "x = 2", false)
		// "x = 1" occurs twice as an exact substring already.
		expect(result).toMatchObject({ kind: "multiple", count: 2 })
		const loose = compactReplace("a  \nb\na \nb\n", "a\nb", "c\nd", false)
		expect(loose).toMatchObject({ kind: "multiple", count: 2 })
	})

	it("replaces every match with replace_all", () => {
		const result = compactReplace(DIARY, "| Time | What |", "| Hour | What |", true)
		expect(result).toMatchObject({ kind: "replaced", count: 2 })
		if (result.kind !== "replaced") return
		expect(result.content).not.toContain("| Time | What |")
	})

	it("reports no match with the searched text, prefixes stripped", () => {
		const result = compactReplace(DIARY, "  14 | | 08:20 | tea |", "x", false)
		expect(result).toEqual({ kind: "none", searched: "| 08:20 | tea |" })
	})

	it("keeps replacement text literal ($ patterns)", () => {
		const result = compactReplace("a  \n", "a", "$1 $&", false)
		expect(result).toMatchObject({ kind: "replaced", content: "$1 $&  \n" })
		const tolerant = compactReplace("x\ty\n", "x y", "$&", false)
		expect(tolerant).toMatchObject({ kind: "replaced", content: "$&\n" })
	})
})

describe("findClosestSnippet", () => {
	it("returns the most similar window of raw lines and its best line", () => {
		const snippet = findClosestSnippet(DIARY, "| 08:15 | kawa 180 ml + mleko 40 ml |")
		expect(snippet).toEqual({ startLine: 14, lines: ["| 08:15 | coffee 180 ml + milk 40 ml |"], bestLine: 0 })
	})

	it("uses a window as long as old_string", () => {
		const snippet = findClosestSnippet(DIARY, "## 2026-10-10\n\n| Time | Wat |")
		expect(snippet?.startLine).toBe(10)
		expect(snippet?.lines).toEqual(["## 2026-10-10", "", "| Time | What |"])
	})

	it("returns nothing for an empty file", () => {
		expect(findClosestSnippet("", "x")).toBeUndefined()
	})
})

describe("lastLines / matchWithContext", () => {
	it("returns the last lines without trailing blank lines", () => {
		expect(lastLines("a\nb\nc\nd\n\n\n", 3)).toEqual({ startLine: 2, lines: ["b", "c", "d"] })
		expect(lastLines("only\n", 3)).toEqual({ startLine: 1, lines: ["only"] })
	})

	it("adds the nearest non-blank line above a match", () => {
		expect(matchWithContext(DIARY, { startLine: 12, endLine: 12 })).toBe("## 2026-10-10\n\n| Time | What |")
		expect(matchWithContext("x\ny\n", { startLine: 1, endLine: 1 })).toBe("x\ny")
	})
})
