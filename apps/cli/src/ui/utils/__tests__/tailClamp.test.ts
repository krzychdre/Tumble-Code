import { clampTail } from "../tailClamp.js"

describe("clampTail", () => {
	const COLUMNS = 84 // effectiveWidth = 80

	it("returns content unchanged when it fits the budget", () => {
		const content = "line one\nline two\nline three"
		const result = clampTail(content, 10, COLUMNS)

		expect(result.content).toBe(content)
		expect(result.hiddenLines).toBe(0)
	})

	it("keeps only the newest lines when over budget", () => {
		const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`)
		const result = clampTail(lines.join("\n"), 5, COLUMNS)

		expect(result.content).toBe(lines.slice(15).join("\n"))
		expect(result.hiddenLines).toBe(15)
	})

	it("counts wrapped lines against the budget", () => {
		// 160 chars wraps to 2 physical rows at effectiveWidth 80.
		const wide = "x".repeat(160)
		const content = ["a", "b", wide, "c"].join("\n")
		// Budget 3: "c" (1) + wide (2) fit; "b" would exceed.
		const result = clampTail(content, 3, COLUMNS)

		expect(result.content).toBe(`${wide}\nc`)
		expect(result.hiddenLines).toBe(2)
	})

	it("slices a single giant line by characters", () => {
		const giant = "y".repeat(1000)
		const content = `first\n${giant}`
		const result = clampTail(content, 2, COLUMNS)

		// 2 rows * 80 cols = 160 chars kept, prefixed with an ellipsis.
		expect(result.content).toBe(`…${"y".repeat(160)}`)
		expect(result.hiddenLines).toBe(1)
	})

	it("handles empty content", () => {
		const result = clampTail("", 5, COLUMNS)

		expect(result.content).toBe("")
		expect(result.hiddenLines).toBe(0)
	})
	it("estimates wrapping from the renderer's indent", () => {
		// 95 characters fit one row at width 96 (indent 4) but need two at width 93 (indent 7).
		const content = ["a", "z".repeat(95)].join("\n")

		expect(clampTail(content, 2, 100).hiddenLines).toBe(0)
		expect(clampTail(content, 2, 100, 7)).toEqual({ content: "z".repeat(95), hiddenLines: 1 })
	})
})
