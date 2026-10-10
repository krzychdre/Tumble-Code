import {
	compactReplace,
	findClosestSnippet,
	hasLineNumberPrefixes,
	lastLines,
	matchWithContext,
	stripLineNumberPrefixes,
	toMatchText,
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

/** The content of a replaced result, or a failure that names what came back instead. */
function replaced(result: ReturnType<typeof compactReplace>): string {
	expect(result.kind).toBe("replaced")
	return result.kind === "replaced" ? result.content : ""
}

describe("review fixes: line-number prefixes never move an edit", () => {
	it("old_string as sent goes through every tolerant step before any prefix is stripped (bitmask)", () => {
		const content = "flags = (\n    1 | FLAG_A,\n    2 | FLAG_B,\n)\nmask = FLAG_B, FLAG_C\n"
		const result = compactReplace(content, "    2 | FLAG_B, ", "    2 | FLAG_D, ", false)
		expect(result).toMatchObject({ kind: "replaced", strategy: "whitespace", strippedLineNumbers: false })
		expect(replaced(result)).toBe("flags = (\n    1 | FLAG_A,\n    2 | FLAG_D, \n)\nmask = FLAG_B, FLAG_C\n")
	})

	it("a numbered-looking table row with a trailing space edits its own line (tea)", () => {
		const content = "1 | coffee\n2 | tea\n5 | tea time\n"
		expect(replaced(compactReplace(content, "2 | tea ", "2 | green tea ", false))).toBe(
			"1 | coffee\n2 | green tea \n5 | tea time\n",
		)
	})

	it("a pipe table with a numeric first column keeps that column (double-space typo)", () => {
		const content = "1 | 08:00 | coffee\n2 | 09:40 | coffee\n"
		expect(replaced(compactReplace(content, "2 |  09:40 | coffee", "2 | 09:45 | coffee", false))).toBe(
			"1 | 08:00 | coffee\n2 | 09:45 | coffee\n",
		)
	})

	it("a prefix-stripped old_string matches whole lines only, never a substring inside a line", () => {
		const content = "green tea time\ntea\n"
		const result = compactReplace(content, "  2 | tea", "  2 | black tea", false)
		expect(result).toMatchObject({ kind: "replaced", strategy: "line_numbers", strippedLineNumbers: true })
		expect(replaced(result)).toBe("green tea time\nblack tea\n")
		expect(compactReplace("green tea time\n", "  1 | tea", "  1 | black tea", false)).toEqual({
			kind: "none",
			searched: "tea",
		})
	})

	it("new_string keeps numbered-looking lines unless old_string matched only with its prefixes stripped", () => {
		const exact = compactReplace("rows:\n", "rows:", "rows:\n1 | 08:00 | coffee", false)
		expect(replaced(exact)).toBe("rows:\n1 | 08:00 | coffee\n")
		const tolerant = compactReplace("rows:\n", "rows: ", "rows:\n1 | 08:00 | coffee", false)
		expect(replaced(tolerant)).toBe("rows:\n1 | 08:00 | coffee\n")
	})

	it("tolerant steps that disagree on the place refuse instead of choosing", () => {
		// Equal up to trailing whitespace on line 1, equal up to indentation on line 2.
		expect(compactReplace("foo\n  foo\n", "foo ", "bar", false)).toMatchObject({
			kind: "multiple",
			count: 2,
			matches: [
				{ startLine: 1, endLine: 1 },
				{ startLine: 2, endLine: 2 },
			],
		})
		// A whole line on line 3 and the same words inside line 1.
		expect(compactReplace("xfoo bar\nmid\nfoo bar\n", "foo  bar", "baz", false)).toMatchObject({
			kind: "multiple",
			count: 2,
		})
	})

	it("overlapping matches count as several places", () => {
		expect(compactReplace("aaa\n", "aa", "b", false)).toMatchObject({ kind: "multiple", count: 2 })
		expect(compactReplace("x\nx\nx\n", "x \nx", "y", false)).toMatchObject({ kind: "multiple", count: 2 })
	})
})

describe("review fixes: re-indentation only when it is certain", () => {
	it("refuses when old_string flattened a nested block, quoting the exact file lines", () => {
		const content = "def f(x):\n    if x:\n        return 1\n    return 0\n"
		expect(compactReplace(content, "if x:\nreturn 1", "if x:\nreturn 2", false)).toEqual({
			kind: "none",
			searched: "if x:\nreturn 1",
			snippet: { startLine: 2, lines: ["    if x:", "        return 1"], bestLine: 0 },
		})
	})

	it("maps a space-indented edit onto a tab-indented file level by level", () => {
		const content = "def f():\n\tif x:\n\t\treturn 1\n"
		const result = compactReplace(
			content,
			"    if x:\n        return 1",
			"    if x:\n        return 2\n    return 3",
			false,
		)
		expect(replaced(result)).toBe("def f():\n\tif x:\n\t\treturn 2\n\treturn 3\n")
	})

	it("refuses a new line deeper than old_string's levels when the units differ (spaces into tabs)", () => {
		const content = "def f():\n\tif x:\n\t\treturn 1\n"
		const result = compactReplace(
			content,
			"    if x:\n        return 1",
			"    if x:\n        if y:\n            return 2",
			false,
		)
		expect(result).toMatchObject({ kind: "none", snippet: { startLine: 2, lines: ["\tif x:", "\t\treturn 1"] } })
	})

	it("keeps a deeper new line when the steps are the same text on both sides", () => {
		const content = "class A:\n    def f(self):\n        if x:\n            return 1\n"
		const result = compactReplace(content, "if x:\n    return 1", "if x:\n    if y:\n        return 2", false)
		expect(replaced(result)).toBe(
			"class A:\n    def f(self):\n        if x:\n            if y:\n                return 2\n",
		)
	})

	it("refuses levels that do not nest the same way, and a new line shallower than old_string", () => {
		// Shallower in old_string, equal in the file.
		expect(compactReplace("    foo(a,\n    b)\n", "  foo(a,\nb)", "x", false)).toMatchObject({
			kind: "none",
			snippet: { startLine: 1, lines: ["    foo(a,", "    b)"] },
		})
		// The new line's indentation is shallower than every level of old_string.
		expect(
			compactReplace("\tif x:\n\t\treturn 1\n", "    if x:\n        return 1", "if x:\n    return 2", false),
		).toMatchObject({ kind: "none", snippet: { startLine: 1 } })
	})

	it("a multi-line substring needs the file's indentation after each line break", () => {
		const content = "def f():\n    foo(a,\n        b)\n"
		expect(compactReplace(content, "foo(a,\nb)", "foo(a,\nc)", false)).toMatchObject({
			kind: "none",
			snippet: { startLine: 2, lines: ["    foo(a,", "        b)"] },
		})
		expect(replaced(compactReplace(content, "foo(a,  \n        b)", "foo(a,\n        c)", false))).toBe(
			"def f():\n    foo(a,\n        c)\n",
		)
		// The whole-line step cannot map the levels (deeper in old_string, equal in the file), but the
		// substring step has the file's indentation after the break, so it places the text safely.
		expect(replaced(compactReplace("    foo(a,\n    b)\n", "  foo(a,\n    b) ", "x", false))).toBe("    x\n")
	})

	it("blank lines at the edges of old_string that new_string repeats keep the file's blank lines", () => {
		expect(replaced(compactReplace("a\n\t\n{ : x )\n", "\n{  :  x )\n", "\n{ : y )\n", false))).toBe(
			"a\n\t\n{ : y )\n",
		)
		// Without the repetition the blank line is part of the change, as old_string says.
		expect(replaced(compactReplace("a\n\t\nfoo \n", "\nfoo  ", "bar", false))).toBe("a\nbar\n")
	})

	it("refuses to add lines after a single-line substring match (their indentation is unknown)", () => {
		expect(compactReplace("    x = add(a,  b) + 1\n", "add(a, b)", "add(a, b)\n+ c", false)).toEqual({
			kind: "none",
			searched: "add(a, b)",
			snippet: { startLine: 1, lines: ["    x = add(a,  b) + 1"], bestLine: 0 },
		})
	})
})

describe("review fixes: only the replaced region changes (line endings, BOM)", () => {
	it("mixed line endings: untouched lines keep theirs", () => {
		expect(replaced(compactReplace("a\r\nb\nc\n", "a", "A", false))).toBe("A\r\nb\nc\n")
		expect(replaced(compactReplace("a\r\nb\nc\n", "b", "B", false))).toBe("a\r\nB\nc\n")
		expect(replaced(compactReplace("a\nb\r\nc", "c", "C", false))).toBe("a\nb\r\nC")
	})

	it("new_string takes the line ending of the region it replaces", () => {
		expect(replaced(compactReplace("a\nb\r\nc\r\nd\n", "b\nc", "B\nX\nC", false))).toBe("a\nB\r\nX\r\nC\r\nd\n")
		expect(replaced(compactReplace("a\r\nb\nc\n", "b \nc", "B\nC", false))).toBe("a\r\nB\nC\n")
		expect(replaced(compactReplace("a\r\nb\r\n", "b", "b\nc", false))).toBe("a\r\nb\r\nc\r\n")
	})

	it("old_string and new_string sent with CRLF match an LF file and are written with LF", () => {
		expect(replaced(compactReplace("a\nb\nc\n", "a\r\nb", "A\r\nB", false))).toBe("A\nB\nc\n")
	})

	it("deleting lines in a mixed file takes one line break with them", () => {
		expect(replaced(compactReplace("a\r\nb \nc\r\n", "b", "", false))).toBe("a\r\n \nc\r\n")
		expect(replaced(compactReplace("a\r\nb\nc\r\n", "b  ", "", false))).toBe("a\r\nc\r\n")
		expect(replaced(compactReplace("a\nb\r\nc ", "c", "", false))).toBe("a\nb\r\n ")
		expect(replaced(compactReplace("a\nb\r\nc ", "c  ", "", false))).toBe("a\nb")
	})

	it("keeps a UTF-8 BOM in every step", () => {
		const bom = "\uFEFF"
		expect(replaced(compactReplace(`${bom}title: x\nbody\n`, "title: x ", "title: y", false))).toBe(
			`${bom}title: y\nbody\n`,
		)
		expect(replaced(compactReplace(`${bom}  title:  x\r\nbody\r\n`, "title: x", "title: y", false))).toBe(
			`${bom}  title: y\r\nbody\r\n`,
		)
		expect(replaced(compactReplace(`${bom}title: x\n`, "title", "name", false))).toBe(`${bom}name: x\n`)
		// A BOM copied into old_string is not part of what is matched.
		expect(replaced(compactReplace(`${bom}a\nb\n`, `${bom}a`, "A", false))).toBe(`${bom}A\nb\n`)
		// A no-break space is text, not whitespace.
		expect(compactReplace("a\u00A0b\n", "a b", "c", false)).toMatchObject({ kind: "none" })
	})

	it("toMatchText drops the BOM and the CR of CRLF", () => {
		expect(toMatchText("\uFEFFa\r\nb\n")).toBe("a\nb\n")
	})
})

describe("property: an edit changes only the matched region, in every step", () => {
	/** mulberry32, so a failing seed can be replayed. */
	function randomGenerator(seed: number): () => number {
		let state = seed
		return () => {
			state = (state + 0x6d2b79f5) | 0
			let t = Math.imul(state ^ (state >>> 15), 1 | state)
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		}
	}

	// No digits and no pipes, so a numbered variant can only match through its stripped prefixes.
	const WORDS = ["a", "b", "foo", "bar", "x", "=", "if", "{", "}", "(", ")", "return", "tea", ":", "#", "->"]
	const INDENTS = ["", "", "  ", "    ", "\t", "\t\t"]
	const SEPARATORS = [" ", " ", " ", "  ", "\t"]
	const TRAILING = ["", "", "", " ", "\t"]

	interface Sample {
		original: string
		/** No BOM, LF: what the model saw. */
		text: string
		/** For each offset of `text`, the offset in `original` (a CRLF newline maps to its "\r"). */
		offsets: number[]
	}

	function randomFile(random: () => number): Sample {
		const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]
		const lineCount = 1 + Math.floor(random() * 8)
		const endings = pick(["lf", "crlf", "mixed"])
		const bom = random() < 0.3 ? "\uFEFF" : ""
		let original = bom
		for (let index = 0; index < lineCount; index++) {
			const words = Array.from({ length: Math.floor(random() * 5) }, () => pick(WORDS))
			let line = pick(INDENTS)
			words.forEach((word, position) => {
				line += (position > 0 ? pick(SEPARATORS) : "") + word
			})
			line += pick(TRAILING)
			const last = index === lineCount - 1
			const eol = endings === "lf" ? "\n" : endings === "crlf" ? "\r\n" : pick(["\n", "\r\n"])
			original += line + (last && random() < 0.3 ? "" : eol)
		}
		const offsets: number[] = []
		for (let index = bom.length; index < original.length; index++) {
			offsets.push(index)
			if (original[index] === "\r" && original[index + 1] === "\n") {
				index++
			}
		}
		offsets.push(original.length)
		return { original, text: toMatchText(original), offsets }
	}

	function occurrences(text: string, search: string): number {
		let count = 0
		for (let index = text.indexOf(search); index !== -1; index = text.indexOf(search, index + 1)) {
			count++
		}
		return count
	}

	/** Every byte of the original outside `[start, end)` of the matched text is still there, in place. */
	function expectOnlyRegionChanged(sample: Sample, content: string, start: number, end: number): string {
		const rawStart = sample.offsets[start]
		const tail = sample.original.length - sample.offsets[end]
		expect(content.length).toBeGreaterThanOrEqual(rawStart + tail)
		expect(content.slice(0, rawStart)).toBe(sample.original.slice(0, rawStart))
		expect(content.slice(content.length - tail)).toBe(sample.original.slice(sample.offsets[end]))
		return content.slice(rawStart, content.length - tail)
	}

	/** new_string: old_string with its first word replaced, so structure and edges stay. */
	const edited = (old: string) => (/[a-z]+/.test(old) ? old.replace(/[a-z]+/, "ZZ") : `${old}ZZ`)

	it("holds for random files, regions and variants", () => {
		const seen = new Set<string>()
		let refused = 0
		for (let seed = 1; seed <= 400; seed++) {
			const random = randomGenerator(seed)
			const sample = randomFile(random)
			const { text } = sample
			const lines = text.split("\n")
			if (text.endsWith("\n")) {
				lines.pop()
			}
			const lineStarts = lines.map((_, index) => lines.slice(0, index).join("\n").length + (index > 0 ? 1 : 0))
			const check = (variant: string, start: number, end: number) => {
				const replacement = edited(variant)
				const result = compactReplace(sample.original, variant, replacement, false)
				if (result.kind !== "replaced") {
					refused++
					return
				}
				seen.add(`${result.strategy}/${result.strippedLineNumbers}`)
				expect(expectOnlyRegionChanged(sample, result.content, start, end)).toContain("ZZ")
			}

			// 1. An exact copy of a unique substring: always replaced, exactly there.
			for (let attempt = 0; attempt < 4 && text.length > 0; attempt++) {
				const start = Math.floor(random() * text.length)
				const end = start + 1 + Math.floor(random() * Math.min(12, text.length - start))
				const old = text.slice(start, end)
				if (!/[^ \t\n]/.test(old) || occurrences(text, old) !== 1) {
					continue
				}
				const replacement = edited(old)
				const result = compactReplace(sample.original, old, replacement, false)
				expect(result, `seed ${seed}`).toMatchObject({ kind: "replaced", strategy: "exact" })
				if (result.kind === "replaced") {
					seen.add("exact/false")
					const middle = expectOnlyRegionChanged(sample, result.content, start, end)
					expect([replacement, replacement.replace(/\n/g, "\r\n")]).toContain(middle)
				}
			}

			// 2-7. Whole lines with the mistakes the tolerant steps forgive.
			const first = Math.floor(random() * lines.length)
			const last = Math.min(lines.length - 1, first + Math.floor(random() * 3))
			const region = lines.slice(first, last + 1)
			if (!region.some((line) => /[^ \t]/.test(line))) {
				continue
			}
			const start = lineStarts[first]
			const end = lineStarts[last] + lines[last].length
			const variants = [
				region.map((line) => `${line.replace(/[ \t]+$/, "")}  `),
				region.map((line) => line.replace(/^[ \t]+/, "")),
				region.map((line) => line.replace(/^\t/g, "    ")),
				region.map((line) => `  ${line}`),
				region.map((line) => line.replace(/(\S)[ \t]+(?=\S)/g, "$1   ")),
				region.map((line, index) => `${first + index + 1} | ${line}`),
				region.map((line, index) => ` ${first + index + 1} | ${line.replace(/[ \t]+$/, "")} `),
			].map((variant) => variant.join("\n"))
			for (const variant of variants) {
				if (variant !== region.join("\n") && occurrences(text, variant) > 0) {
					// The model's text occurs as it is: an exact match, not this step's business.
					continue
				}
				check(variant, start, end)
			}

			// 4. A substring inside lines with its in-line whitespace runs changed.
			const subStart = Math.floor(random() * Math.max(1, text.length))
			const subEnd = Math.min(text.length, subStart + 1 + Math.floor(random() * 20))
			const substring = text.slice(subStart, subEnd)
			const widened = substring.replace(/([^ \t\n])[ \t]+(?=[^ \t\n])/g, "$1  ")
			if (/[^ \t\n]/.test(substring) && widened !== substring && occurrences(text, widened) === 0) {
				check(widened, subStart, subEnd)
			}
		}
		// Every step was exercised, and some variants were refused.
		expect([...seen].sort()).toEqual(
			expect.arrayContaining(["exact/false", "line_numbers/true", "whitespace/false", "whitespace/true"]),
		)
		expect(refused).toBeGreaterThan(0)
	})
})
