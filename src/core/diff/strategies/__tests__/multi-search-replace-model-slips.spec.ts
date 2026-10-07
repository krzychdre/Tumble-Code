import { MultiSearchReplaceDiffStrategy } from "../multi-search-replace"

// Regression tests built from real failed apply_diff calls (GLM-5.3 and GLM-5.3-Flash task
// history, 2026-10). Each shape is a deterministic formatting slip the parser now tolerates;
// the negative tests pin the ambiguous shapes it must keep rejecting.

/** Lines "line 1" .. "line n", with `overrides` placed at the given 1-based line numbers. */
function makeFile(n: number, overrides: Record<number, string> = {}): string {
	return Array.from({ length: n }, (_, i) => overrides[i + 1] ?? `line ${i + 1}`).join("\n")
}

describe("MultiSearchReplaceDiffStrategy - weak-model slips", () => {
	describe("indented :start_line: header", () => {
		const strategy = new MultiSearchReplaceDiffStrategy()
		const original = [
			'    p = sub.add_parser("pending")',
			'    p.add_argument("--limit", type=int, default=100)',
			'    sub.add_parser("commit")',
			'    p = sub.add_parser("commit")',
			'    p.add_argument("--until", default=None)',
			'    p = sub.add_parser("rd")',
		].join("\n")

		it("parses ' :start_line:N' with a leading space (task 01a1160c)", async () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				" :start_line:3\n" +
				"-------\n" +
				'    sub.add_parser("commit")\n' +
				'    p = sub.add_parser("commit")\n' +
				"=======\n" +
				'    p = sub.add_parser("commit")\n' +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff(original, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe(
					[
						'    p = sub.add_parser("pending")',
						'    p.add_argument("--limit", type=int, default=100)',
						'    p = sub.add_parser("commit")',
						'    p.add_argument("--until", default=None)',
						'    p = sub.add_parser("rd")',
					].join("\n"),
				)
			}
		})

		it("parses tab-indented :start_line:, :end_line: and an indented ------- after them", async () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"\t:start_line:6\n" +
				"\t:end_line:6\n" +
				"  -------\n" +
				'    p = sub.add_parser("rd")\n' +
				"=======\n" +
				'    p = sub.add_parser("read")\n' +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff(original, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toContain('    p = sub.add_parser("read")')
				expect(result.content).not.toContain("-------")
			}
		})

		it("keeps an indented ------- as search content when there is no header", async () => {
			const file = "Title\n  -------\nold body"
			const diff =
				"<<<<<<< SEARCH\n" +
				"  -------\n" +
				"old body\n" +
				"=======\n" +
				"  -------\n" +
				"new body\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff(file, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe("Title\n  -------\nnew body")
			}
		})

		it("repairTruncatedDiff keeps an indented header out of the SEARCH text", () => {
			const diff = "<<<<<<< SEARCH\n" + " :start_line:5\n" + " -------\n" + "old line\n" + "new line"
			expect(strategy["repairTruncatedDiff"](diff)).toBe(
				"<<<<<<< SEARCH\n" +
					" :start_line:5\n" +
					" -------\n" +
					"old line\n" +
					"=======\n" +
					"new line\n" +
					">>>>>>> REPLACE",
			)
		})
	})

	describe(":start_line: far from the real location", () => {
		const target = "    return computeTotal(items, taxRate)"

		it("applies an exact, unique match when the hint is past the end of the file (:start_line:545 in 459 lines)", async () => {
			const strategy = new MultiSearchReplaceDiffStrategy()
			const file = makeFile(459, { 449: target })
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:545\n" +
				"-------\n" +
				target +
				"\n=======\n" +
				"    return computeTotal(items, taxRate, discount)\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff(file, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content.split("\n")[448]).toBe("    return computeTotal(items, taxRate, discount)")
			}
		})

		it("applies an exact, unique match 65 lines below the hint (hint 133, real 198)", async () => {
			const strategy = new MultiSearchReplaceDiffStrategy()
			const file = makeFile(300, { 198: target, 199: "}" })
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:133\n" +
				"-------\n" +
				target +
				"\n}\n" +
				"=======\n" +
				"    return 0\n" +
				"}\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff(file, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				const lines = result.content.split("\n")
				expect(lines[197]).toBe("    return 0")
				expect(lines[198]).toBe("}")
			}
		})

		it("still fails when the text occurs twice in the file, and says so", async () => {
			const strategy = new MultiSearchReplaceDiffStrategy()
			const file = makeFile(300, { 150: target, 250: target })
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:20\n" +
				"-------\n" +
				target +
				"\n=======\n" +
				"    return 0\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff(file, diff)
			expect(result.success).toBe(false)
			const error = result.success ? "" : (result.failParts?.[0] as { error: string }).error
			expect(error).toContain("occurs 2 times in the file (at lines 150, 250)")
		})

		it("requires an exact match far from the hint even with a fuzzy threshold", async () => {
			const strategy = new MultiSearchReplaceDiffStrategy(0.9)
			// One character differs from the search text: fuzzy-close, but not exact.
			const file = makeFile(300, { 250: "    return computeTotal(items, taxRat)" })
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:20\n" +
				"-------\n" +
				target +
				"\n=======\n" +
				"    return 0\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff(file, diff)
			expect(result.success).toBe(false)
		})

		it("does not shift a later block's hint by an edit applied below it", async () => {
			// bufferLines 0: the second block only matches if its hint stays exactly at line 100.
			const strategy = new MultiSearchReplaceDiffStrategy(1.0, 0)
			const file = makeFile(300, { 100: "const shared = 1", 226: target, 280: "const shared = 1" })
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:25\n" +
				"-------\n" +
				target +
				"\n=======\n" +
				"    // a\n" +
				"    // b\n" +
				"    // c\n" +
				target +
				"\n>>>>>>> REPLACE\n" +
				"<<<<<<< SEARCH\n" +
				":start_line:100\n" +
				"-------\n" +
				"const shared = 1\n" +
				"=======\n" +
				"const shared = 2\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff(file, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.failParts).toEqual([])
				const lines = result.content.split("\n")
				expect(lines[99]).toBe("const shared = 2")
				expect(lines[225]).toBe("    // a")
				expect(lines[228]).toBe(target)
				expect(lines[282]).toBe("const shared = 1")
			}
		})
	})

	describe("stray separators and closers", () => {
		const strategy = new MultiSearchReplaceDiffStrategy()

		it("drops a second ======= right before the closer (task 01a0f6be)", async () => {
			const file = "# Notes\n**Layout:**\nend"
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:2\n" +
				"-------\n" +
				"**Layout:**\n" +
				"=======\n" +
				"**Fix:** routes follow the active NIC.\n" +
				"\n" +
				"**Layout:**\n" +
				"=======\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff(file, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe("# Notes\n**Fix:** routes follow the active NIC.\n\n**Layout:**\nend")
			}
		})

		it("drops a second ======= followed only by blank lines before the closer", async () => {
			const diff = "<<<<<<< SEARCH\n" + "b\n" + "=======\n" + "B\n" + "=======\n" + "\n" + ">>>>>>> REPLACE"
			const result = await strategy.applyDiff("a\nb\nc", diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe("a\nB\nc")
			}
		})

		it("treats a doubled separator as a deletion (task 01a0fe73)", async () => {
			const file = "keep\nexport function f() {\n\treturn 1\n}"
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:2\n" +
				"-------\n" +
				"export function f() {\n" +
				"\treturn 1\n" +
				"}\n" +
				"=======\n" +
				"=======\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff(file, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe("keep")
			}
		})

		it("treats a doubled separator as a deletion when the closer was cut off", async () => {
			const file = "keep\nexport function f() {\n\treturn 1\n}"
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:2\n" +
				"-------\n" +
				"export function f() {\n" +
				"\treturn 1\n" +
				"}\n" +
				"=======\n" +
				"=======\n" +
				"\n"
			const result = await strategy.applyDiff(file, diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe("keep")
			}
		})

		it("drops a trailing ======= after the last block", async () => {
			const diff = "<<<<<<< SEARCH\n" + "b\n" + "=======\n" + "B\n" + ">>>>>>> REPLACE\n" + "=======\n"
			const result = await strategy.applyDiff("a\nb\nc", diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe("a\nB\nc")
			}
		})

		it("drops a duplicate >>>>>>> REPLACE, at the end and between blocks", async () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"a\n" +
				"=======\n" +
				"A\n" +
				">>>>>>> REPLACE\n" +
				">>>>>>> REPLACE\n" +
				"\n" +
				"<<<<<<< SEARCH\n" +
				"c\n" +
				"=======\n" +
				"C\n" +
				">>>>>>> REPLACE\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff("a\nb\nc", diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe("A\nb\nC")
			}
		})

		it("keeps an escaped \\======= in the replacement as content", async () => {
			const diff = "<<<<<<< SEARCH\n" + "b\n" + "=======\n" + "Title\n" + "\\=======\n" + ">>>>>>> REPLACE"
			const result = await strategy.applyDiff("a\nb\nc", diff)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.content).toBe("a\nTitle\n=======\nc")
			}
		})

		it("still rejects two separators with text after each, naming the problem plainly (task 01a0fba0)", async () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				":start_line:2\n" +
				"-------\n" +
				"| N5 | open |\n" +
				"=======\n" +
				"| N5 | closed |\n" +
				"=======\n" +
				"| N3 | closed |\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff("| Q | state |\n| N5 | open |\n| N3 | open |", diff)
			expect(result.success).toBe(false)
			const error = result.success ? "" : result.error
			expect(error).toContain("more than one '=======' separator (the extra one is at line 7)")
			expect(error).toContain("exactly one '=======' line")
			expect(error).not.toContain("merge conflict")
		})

		it("reports the model's line number after dropping a stray closer earlier in the diff", async () => {
			const diff =
				"<<<<<<< SEARCH\n" + // 1
				"a\n" + // 2
				"=======\n" + // 3
				"A\n" + // 4
				">>>>>>> REPLACE\n" + // 5
				">>>>>>> REPLACE\n" + // 6 (dropped)
				"<<<<<<< SEARCH\n" + // 7
				"b\n" + // 8
				"=======\n" + // 9
				"B1\n" + // 10
				"=======\n" + // 11
				"B2\n" + // 12
				">>>>>>> REPLACE" // 13
			const result = await strategy.applyDiff("a\nb", diff)
			expect(result.success).toBe(false)
			expect(result.success ? "" : result.error).toContain("(the extra one is at line 11)")
		})

		it("keeps the merge-conflict message for unescaped conflict lines", async () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"<<<<<<< HEAD\n" +
				"x\n" +
				"=======\n" +
				"y\n" +
				">>>>>>> develop\n" +
				"=======\n" +
				"x\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff("<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> develop", diff)
			expect(result.success).toBe(false)
			expect(result.success ? "" : result.error).toContain("When removing merge conflict markers")
		})

		it("does not drop a separator in a block that edits conflict text", async () => {
			// The unescaped ======= may be the conflict's middle line the model forgot to escape,
			// so the "blank tail" rule would guess wrong here.
			const diff =
				"<<<<<<< SEARCH\n" +
				"\\<<<<<<< HEAD\n" +
				"=======\n" +
				"x\n" +
				"\\>>>>>>> develop\n" +
				"=======\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff("<<<<<<< HEAD\n=======\nx\n>>>>>>> develop", diff)
			expect(result.success).toBe(false)
		})

		it("keeps the merge-conflict message when the model escaped some conflict lines but missed a ======= (task 01a0ee0b)", async () => {
			const diff =
				"<<<<<<< SEARCH\n" +
				"\\<<<<<<< HEAD\n" +
				"=======\n" +
				"x\n" +
				"\\>>>>>>> develop\n" +
				"=======\n" +
				"x\n" +
				">>>>>>> REPLACE"
			const result = await strategy.applyDiff("<<<<<<< HEAD\n=======\nx\n>>>>>>> develop", diff)
			expect(result.success).toBe(false)
			expect(result.success ? "" : result.error).toContain("When removing merge conflict markers")
		})
	})
})
