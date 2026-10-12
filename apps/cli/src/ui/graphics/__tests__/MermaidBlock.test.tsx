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

const diagram = "Flow:\n```mermaid\ngraph TD\n  A[Start] --> B[Done]\n```\nEnd."

describe("mermaid blocks in markdown", () => {
	it("draws an image in the scrollback of a terminal that draws images", () => {
		const { lastFrame } = renderIn(<Markdown>{diagram}</Markdown>, { protocol: "sixel", scrollback: true })
		const frame = lastFrame() ?? ""

		expect(frame).toMatch(/\uE000[0-9a-z]+\uE001/)
		expect(frame).not.toContain("graph TD")
		expect(expandImageMarkers(frame)).toContain("\x1bP")
	})

	it("draws the diagram in characters in the live tail and in a text-only terminal", () => {
		for (const options of [
			{ protocol: "kitty" as const, scrollback: false },
			{ protocol: null, scrollback: true },
		]) {
			const { lastFrame } = renderIn(<Markdown>{diagram}</Markdown>, options)
			const frame = lastFrame() ?? ""

			expect(frame).toContain("Start")
			expect(frame).toMatch(/[│─]/)
			expect(frame).not.toContain("graph TD")
		}
	})

	it("shows the code of a diagram kind it cannot draw", () => {
		const { lastFrame } = renderIn(<Markdown>{'```mermaid\npie title Pets\n  "Dogs": 3\n```'}</Markdown>, {
			protocol: "kitty",
			scrollback: true,
		})
		expect(lastFrame()).toContain("pie title Pets")
	})

	it("shows the code while the fence is still open", () => {
		const { lastFrame } = renderIn(<Markdown>{"```mermaid\ngraph TD\n  A[Start] --> B"}</Markdown>, {
			protocol: null,
			scrollback: false,
		})
		expect(lastFrame()).toContain("A[Start] --> B")
	})
})
