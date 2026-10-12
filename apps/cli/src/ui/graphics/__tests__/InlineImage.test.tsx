import fs from "fs"
import os from "os"
import path from "path"
import zlib from "zlib"
import type { ReactNode } from "react"
import { render } from "ink-testing-library"

import Markdown from "../../components/Markdown.js"
import { GraphicsContext, ScrollbackContext, type GraphicsSettings } from "../GraphicsContext.js"
import { MAX_IMAGE_PIXELS, rasterizeSvg } from "../imageEncoding.js"
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

/** A valid black PNG of `width` x `height`, one bit a pixel, so it stays small in memory. */
function blackPng(width: number, height: number): Buffer {
	const chunk = (type: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(type), data])
		const length = Buffer.alloc(4)
		length.writeUInt32BE(data.length)
		const crc = Buffer.alloc(4)
		crc.writeUInt32BE(zlib.crc32(body))
		return Buffer.concat([length, body, crc])
	}
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(height, 4)
	header[8] = 1 // bit depth; colour type 0 (grey) and the rest stay 0
	const rows = Buffer.alloc((1 + Math.ceil(width / 8)) * height)
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", zlib.deflateSync(rows)),
		chunk("IEND", Buffer.alloc(0)),
	])
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

	it("does not decode an image with more pixels than the limit", () => {
		// Fits within the limit, so it is drawn...
		fs.writeFileSync(path.join(dir, "small.png"), blackPng(64, 64))
		// ...one pixel over it is not: resvg would decode it whole before scaling.
		const side = Math.ceil(Math.sqrt(MAX_IMAGE_PIXELS + 1))
		fs.writeFileSync(path.join(dir, "huge.png"), blackPng(side, side))
		const { lastFrame } = renderIn(<Markdown>{"![a](small.png)\n![b](huge.png)"}</Markdown>, {
			protocol: "kitty",
			scrollback: true,
		})
		expect(lastFrame()).not.toContain("[image: a]")
		expect(lastFrame()).toContain("[image: b] huge.png")
	})

	it("does not spell out an embedded data URL", () => {
		const { lastFrame } = renderIn(<Markdown>{"![logo](data:image/png;base64,AAAA)"}</Markdown>, {
			protocol: null,
			scrollback: true,
		})
		expect(lastFrame()).toContain("[image: logo] (embedded)")
	})
})
