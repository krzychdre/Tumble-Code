import type { ReactNode } from "react"
import { render } from "ink-testing-library"

import Markdown from "../../components/Markdown.js"
import { GraphicsContext, ScrollbackContext, type GraphicsSettings } from "../GraphicsContext.js"
import { expandImageMarkers, resetInlineImages } from "../inlineImages.js"

beforeEach(() => resetInlineImages())

function renderIn(
	node: ReactNode,
	{ protocol, scrollback }: Pick<GraphicsSettings, "protocol"> & { scrollback: boolean },
) {
	const graphics: GraphicsSettings = {
		protocol,
		cellWidth: 10,
		cellHeight: 20,
		cellSizeKnown: true,
		background: "#000000",
		baseDir: process.cwd(),
	}
	return render(
		<GraphicsContext.Provider value={graphics}>
			<ScrollbackContext.Provider value={scrollback}>{node}</ScrollbackContext.Provider>
		</GraphicsContext.Provider>,
	)
}

const answer = [
	"Całka niewłaściwa:",
	"",
	String.raw`$$\int_{-\infty}^{0} \left(3x^3 + \frac{1}{2}\right) dx$$`,
	"",
	"Koniec.",
].join("\n")

describe("display math in markdown", () => {
	it("draws an image in the scrollback of a terminal that draws images", () => {
		const { lastFrame } = renderIn(<Markdown>{answer}</Markdown>, { protocol: "kitty", scrollback: true })
		const frame = lastFrame() ?? ""

		expect(frame).toMatch(/\uE000[0-9a-z]+\uE001/)
		expect(frame).not.toContain(String.raw`\int`)
		expect(frame).not.toContain("∫")
		expect(expandImageMarkers(frame)).toContain("\x1b_G")
	})

	it("writes the formula in Unicode in the live tail and in a text-only terminal", () => {
		for (const options of [
			{ protocol: "kitty" as const, scrollback: false },
			{ protocol: null, scrollback: true },
		]) {
			const { lastFrame } = renderIn(<Markdown>{answer}</Markdown>, options)
			const frame = lastFrame() ?? ""

			expect(frame).toContain("∫_(-∞)⁰ (3x³ + ½) dx")
			expect(frame).not.toContain("$$")
			expect(frame).toContain("Koniec.")
		}
	})

	it.each([
		["$$ over lines", "$$\nx^2 + y^2\n$$\nafter"],
		["\\[ over lines", "\\[\nx^2 + y^2\n\\]\nafter"],
		["\\[ on one line", "\\[ x^2 + y^2 \\]\nafter"],
	])("reads %s", (_name, markdown) => {
		const { lastFrame } = renderIn(<Markdown>{markdown}</Markdown>, { protocol: null, scrollback: true })
		const frame = lastFrame() ?? ""

		expect(frame).toContain("x² + y²")
		expect(frame).toContain("after")
		expect(frame).not.toMatch(/\$\$|\\\[|\\\]/)
	})

	it("shows a formula that still streams as text, without an image", () => {
		const { lastFrame } = renderIn(<Markdown>{"$$\n\\frac{1}{2}"}</Markdown>, {
			protocol: "kitty",
			scrollback: true,
		})
		const frame = lastFrame() ?? ""

		expect(frame).toContain("½")
		expect(frame).not.toMatch(/\uE000/)
	})

	it("shows TeX that MathJax rejects as text", () => {
		const { lastFrame } = renderIn(<Markdown>{"$$\\nosuchcommand{x} + 1$$"}</Markdown>, {
			protocol: "kitty",
			scrollback: true,
		})
		const frame = lastFrame() ?? ""

		expect(frame).toContain("\\nosuchcommand{x} + 1")
		expect(frame).not.toMatch(/\uE000/)
	})
})
