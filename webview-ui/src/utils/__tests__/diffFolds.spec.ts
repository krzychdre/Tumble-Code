// §2.7 (ai_plans/2026-09-27_ui-modernization.md): long runs of unchanged
// lines in a diff fold into one "... N unchanged lines" row, the header counts
// come from the diff itself, and the merged gutter shows one line number.

import type { DiffLine } from "../parseUnifiedDiff"
import { buildDiffRenderRows, countDiffStats, mergedLineNumber } from "../diffFolds"

const ctx = (n: number): DiffLine => ({ oldLineNum: n, newLineNum: n, type: "context", content: `c${n}` })
const add = (n: number): DiffLine => ({ oldLineNum: null, newLineNum: n, type: "addition", content: `a${n}` })
const del = (n: number): DiffLine => ({ oldLineNum: n, newLineNum: null, type: "deletion", content: `d${n}` })
const gap = (hidden: number): DiffLine => ({
	oldLineNum: null,
	newLineNum: null,
	type: "gap",
	content: "",
	hiddenCount: hidden,
})

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

describe("buildDiffRenderRows", () => {
	it("leaves runs of six unchanged lines or fewer alone", () => {
		const lines = [del(1), ...range(2, 7).map(ctx), add(8)]
		const rows = buildDiffRenderRows([{ lines }], new Set())

		expect(rows.every((row) => row.kind === "line")).toBe(true)
		expect(rows).toHaveLength(lines.length)
	})

	it("folds the middle of a long run between two changes, keeping three lines next to each change", () => {
		// 1 change, 18 unchanged lines, 1 change
		const lines = [del(1), ...range(2, 19).map(ctx), add(20)]
		const rows = buildDiffRenderRows([{ lines }], new Set())

		const fold = rows.find((row) => row.kind === "fold")
		expect(fold).toMatchObject({ kind: "fold", count: 12, hunkIndex: 0 })

		const visible = rows.filter((row) => row.kind === "line").map((row) => lines[row.lineIndex].content)
		expect(visible).toEqual(["d1", "c2", "c3", "c4", "c17", "c18", "c19", "a20"])
	})

	it("folds a leading run up to the three lines before the first change", () => {
		const lines = [...range(1, 10).map(ctx), add(11)]
		const rows = buildDiffRenderRows([{ lines }], new Set())

		expect(rows[0]).toMatchObject({ kind: "fold", count: 7 })
		const visible = rows.filter((row) => row.kind === "line").map((row) => lines[row.lineIndex].content)
		expect(visible).toEqual(["c8", "c9", "c10", "a11"])
	})

	it("treats a hunk separator as a boundary, not as a change", () => {
		const lines = [gap(40), ...range(50, 59).map(ctx), del(60)]
		const rows = buildDiffRenderRows([{ lines }], new Set())

		expect(rows[0]).toMatchObject({ kind: "line", lineIndex: 0 })
		expect(rows[1]).toMatchObject({ kind: "fold", count: 7 })
	})

	it("does not fold when the fold would hide a single line", () => {
		// 7 unchanged lines between two changes: 3 + 3 stay, so only 1 would fold.
		const lines = [del(1), ...range(2, 8).map(ctx), add(9)]
		const rows = buildDiffRenderRows([{ lines }], new Set())

		expect(rows.some((row) => row.kind === "fold")).toBe(false)
	})

	it("shows the folded lines once their fold key is expanded", () => {
		const lines = [del(1), ...range(2, 19).map(ctx), add(20)]
		const collapsed = buildDiffRenderRows([{ lines }], new Set())
		const fold = collapsed.find((row) => row.kind === "fold")
		if (fold?.kind !== "fold") throw new Error("expected a fold")

		const expanded = buildDiffRenderRows([{ lines }], new Set([fold.key]))
		expect(expanded.some((row) => row.kind === "fold")).toBe(false)
		expect(expanded).toHaveLength(lines.length)
	})

	it("gives folds in different hunks different keys", () => {
		const hunk = (base: number) => [del(base), ...range(base + 1, base + 12).map(ctx), add(base + 13)]
		const rows = buildDiffRenderRows([{ lines: hunk(1) }, { lines: [gap(5), ...hunk(30)] }], new Set())

		const keys = rows.filter((row) => row.kind === "fold").map((row) => (row.kind === "fold" ? row.key : ""))
		expect(keys).toHaveLength(2)
		expect(new Set(keys).size).toBe(2)
	})
})

describe("countDiffStats", () => {
	it("counts additions and deletions and ignores context and separators", () => {
		expect(countDiffStats([gap(3), ctx(1), add(2), add(3), del(4), ctx(5)])).toEqual({ added: 2, removed: 1 })
	})
})

describe("mergedLineNumber", () => {
	it("shows the old number for deletions and the new number otherwise", () => {
		expect(mergedLineNumber(del(7))).toBe(7)
		expect(mergedLineNumber(add(9))).toBe(9)
		expect(mergedLineNumber({ oldLineNum: 4, newLineNum: 6, type: "context", content: "" })).toBe(6)
		expect(mergedLineNumber(gap(2))).toBeNull()
	})
})
