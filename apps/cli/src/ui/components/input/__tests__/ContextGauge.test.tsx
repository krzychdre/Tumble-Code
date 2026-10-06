import { render } from "ink-testing-library"

import ContextGauge, { fillCells, formatTokenCount } from "../ContextGauge.js"

const barOf = (percent: number) => (render(<ContextGauge percent={percent} />).lastFrame() ?? "").split(" ")[0] ?? ""

describe("fillCells", () => {
	it("lights no cell at zero", () => {
		expect(fillCells(0)).toBe(0)
	})

	it("lights the first cell for any context at all", () => {
		expect(fillCells(1)).toBe(1)
		expect(fillCells(4)).toBe(1)
	})

	it("rounds to the nearest cell in between", () => {
		expect(fillCells(38)).toBe(4)
		expect(fillCells(50)).toBe(5)
		expect(fillCells(84)).toBe(8)
	})

	it("keeps the last cell dark until the window is truly full", () => {
		expect(fillCells(95)).toBe(9)
		expect(fillCells(99)).toBe(9)
		expect(fillCells(100)).toBe(10)
	})

	it("clamps out-of-range input", () => {
		expect(fillCells(-5)).toBe(0)
		expect(fillCells(140)).toBe(10)
	})

	it("honours a different cell count", () => {
		expect(fillCells(50, 4)).toBe(2)
		expect(fillCells(100, 4)).toBe(4)
	})
})

describe("ContextGauge", () => {
	it("renders a ten-cell bar followed by the percentage", () => {
		const frame = render(<ContextGauge percent={38} />).lastFrame() ?? ""

		expect(frame).toContain("████░░░░░░")
		expect(frame).toContain("38%")
	})

	it("fills the bar as the context fills", () => {
		expect(barOf(0)).toBe("░░░░░░░░░░")
		expect(barOf(50)).toBe("█████░░░░░")
		expect(barOf(100)).toBe("██████████")
	})

	it("always renders exactly ten cells", () => {
		for (const percent of [0, 7, 38, 80, 95, 100]) {
			expect(barOf(percent)).toHaveLength(10)
		}
	})

	it("clamps a percentage outside 0-100", () => {
		const frame = render(<ContextGauge percent={130} />).lastFrame() ?? ""

		expect(frame).toContain("100%")
		expect(frame).not.toContain("130%")
	})
})

describe("formatTokenCount", () => {
	it.each([
		[850, "850"],
		[12_400, "12.4K"],
		[99_949, "99.9K"],
		[118_234, "118K"],
		[262_144, "262K"],
		[1_048_576, "1.0M"],
	])("formats %s as %s", (tokens, expected) => {
		expect(formatTokenCount(tokens)).toBe(expected)
	})
})

describe("ContextGauge tokens", () => {
	it("shows the tokens in the context out of the window after the percentage", () => {
		const frame = render(<ContextGauge percent={45} tokens={118_234} window={262_144} />).lastFrame()

		expect(frame).toContain("45% 118K/262K")
	})

	it("shows only the percentage when the counts are unknown", () => {
		const frame = render(<ContextGauge percent={45} />).lastFrame() ?? ""

		expect(frame.trimEnd().endsWith("45%")).toBe(true)
	})
})
