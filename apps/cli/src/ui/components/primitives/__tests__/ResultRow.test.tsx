import { render } from "ink-testing-library"

import ResultRow from "../ResultRow.js"

const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n")

describe("ResultRow", () => {
	it("closes the block with the truncation tail instead of parking it beside the output", () => {
		const rows = (render(<ResultRow>{lines(8)}</ResultRow>).lastFrame() ?? "").split("\n")
		const lastVisible = rows.findIndex((row) => row.includes("line 5"))
		const tail = rows.findIndex((row) => row.includes("+3 lines"))

		// The tail is its own row, directly under the last output line. It used
		// to share a row with an earlier line, laid out as a second column.
		expect(tail).toBe(lastVisible + 1)
		expect(rows[tail]).not.toContain("line ")
	})

	it("says line, not lines, when one line was cut", () => {
		const output = render(<ResultRow>{lines(6)}</ResultRow>).lastFrame()

		expect(output).toContain("… +1 line (ctrl+o)")
		expect(output).not.toContain("+1 lines")
	})

	it("prints only the connector and the counter with maxLines 0", () => {
		const rows = (render(<ResultRow maxLines={0}>{lines(3)}</ResultRow>).lastFrame() ?? "").split("\n")

		expect(rows).toEqual(["  ⎿  … +3 lines (ctrl+o)"])
	})

	it("prints every line and no counter when uncapped", () => {
		const output = render(<ResultRow maxLines={Number.POSITIVE_INFINITY}>{lines(30)}</ResultRow>).lastFrame()

		expect(output).toContain("line 30")
		expect(output).not.toContain("ctrl+o")
	})

	// ink-testing-library renders at 100 columns. A row one column wider wraps
	// in a real terminal onto a row ink does not count, which the live tail
	// then fails to erase (plan: 2026-09-22 cli bash row overflows width).
	it("cuts every line to one row when capped", () => {
		const scraped = `1${"x".repeat(450)}\n\nshort\n${"y ".repeat(300)}`
		const rows = (render(<ResultRow>{scraped}</ResultRow>).lastFrame() ?? "").split("\n")

		// The cut 451-character line, the blank line, "short", the cut
		// 600-character line: 4 rows, not the 12 the wrapped text takes.
		expect(rows).toHaveLength(4)
		expect(rows[0]).toMatch(/^ {2}⎿ {2}1x+…$/)
		expect(rows[1]?.trim()).toBe("")
		expect(rows[2]?.trim()).toBe("short")
		expect(rows[3]?.trimEnd()).toMatch(/…$/)
	})
})
