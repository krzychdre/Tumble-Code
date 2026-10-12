import fs from "fs"
import os from "os"
import path from "path"
import type { ReactNode } from "react"
import { render } from "ink-testing-library"

import Markdown from "../../components/Markdown.js"
import { GraphicsContext, ScrollbackContext, type GraphicsSettings } from "../GraphicsContext.js"
import { rasterizeSvg } from "../imageEncoding.js"
import { expandImageMarkers, resetInlineImages } from "../inlineImages.js"

let dir: string

beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-inline-image-"))
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="45"><rect width="30" height="45" fill="#0000ff"/></svg>`
	fs.writeFileSync(path.join(dir, "chart.png"), rasterizeSvg(svg, 30).png)
})

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

beforeEach(() => resetInlineImages())

function renderIn(
	node: ReactNode,
	{ protocol, scrollback }: Pick<GraphicsSettings, "protocol"> & { scrollback: boolean },
) {
	const graphics: GraphicsSettings = { protocol, cellWidth: 10, cellHeight: 20, cellSizeKnown: true, baseDir: dir }
	return render(
		<GraphicsContext.Provider value={graphics}>
			<ScrollbackContext.Provider value={scrollback}>{node}</ScrollbackContext.Provider>
		</GraphicsContext.Provider>,
	)
}

const answer = "Here it is:\n![sales chart](chart.png)\nDone."

describe("images in markdown", () => {
	it("prints a marker in the scrollback of a terminal that draws images", () => {
		const { lastFrame } = renderIn(<Markdown>{answer}</Markdown>, { protocol: "kitty", scrollback: true })
		const frame = lastFrame() ?? ""

		expect(frame).toMatch(/\uE000[0-9a-z]+\uE001/)
		expect(frame).not.toContain("[image")
		// The marker becomes a kitty image three rows tall (45 px in 20 px cells).
		const expanded = expandImageMarkers(frame)
		expect(expanded).toContain("\x1b_Ga=T,f=100")
		expect(expanded).toContain("\n\n\x1b[2A")
	})

	it("shows the text fallback in the live tail, where nothing may be drawn", () => {
		const { lastFrame } = renderIn(<Markdown>{answer}</Markdown>, { protocol: "kitty", scrollback: false })
		expect(lastFrame()).toContain("[image: sales chart] chart.png")
	})

	it("shows the text fallback in a text-only terminal", () => {
		const { lastFrame } = renderIn(<Markdown>{answer}</Markdown>, { protocol: null, scrollback: true })
		expect(lastFrame()).toContain("[image: sales chart] chart.png")
	})

	it("falls back when the file is missing or is not an image", () => {
		fs.writeFileSync(path.join(dir, "notes.png"), "plain text")
		const { lastFrame } = renderIn(<Markdown>{"![a](missing.png)\n![b](notes.png)"}</Markdown>, {
			protocol: "sixel",
			scrollback: true,
		})
		expect(lastFrame()).toContain("[image: a] missing.png")
		expect(lastFrame()).toContain("[image: b] notes.png")
	})

	it("does not spell out an embedded data URL", () => {
		const { lastFrame } = renderIn(<Markdown>{"![logo](data:image/png;base64,AAAA)"}</Markdown>, {
			protocol: null,
			scrollback: true,
		})
		expect(lastFrame()).toContain("[image: logo] (embedded)")
	})
})
