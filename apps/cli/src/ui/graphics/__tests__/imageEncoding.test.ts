import { encodeImage, flattenOnto, imageFileSize, placeImage, rasterizeSvg, wrapBitmapInSvg } from "../imageEncoding.js"
import type { TerminalGraphics } from "../terminalProbe.js"

const graphics: TerminalGraphics = { protocol: "kitty", cellWidth: 10, cellHeight: 20, cellSizeKnown: true }

const square = (size: number, fill = "#ff0000") =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${fill}"/></svg>`

describe("placeImage", () => {
	it("keeps an image that fits at its own size", () => {
		expect(placeImage({ width: 100, height: 50 }, { maxColumns: 80, maxRows: 20 }, graphics)).toEqual({
			width: 100,
			height: 50,
			rows: 3,
		})
	})

	it("scales a wide image down to the columns and a tall one to the rows", () => {
		expect(placeImage({ width: 1600, height: 400 }, { maxColumns: 80, maxRows: 20 }, graphics)).toEqual({
			width: 800,
			height: 200,
			rows: 10,
		})
		expect(placeImage({ width: 200, height: 800 }, { maxColumns: 80, maxRows: 20 }, graphics)).toEqual({
			width: 100,
			height: 400,
			rows: 20,
		})
	})

	it("keeps a sixel image within the largest image the terminal accepts", () => {
		const sixel: TerminalGraphics = { ...graphics, protocol: "sixel", maxImage: { width: 1000, height: 500 } }
		expect(placeImage({ width: 800, height: 1000 }, { maxColumns: 200, maxRows: 100 }, sixel)).toEqual({
			width: 400,
			height: 500,
			rows: 25,
		})
		// The limit is sixel's; kitty scales whatever it gets.
		const kitty = { ...sixel, protocol: "kitty" as const }
		expect(placeImage({ width: 800, height: 1000 }, { maxColumns: 200, maxRows: 100 }, kitty)?.height).toBe(1000)
	})

	it("refuses an empty image or an empty box", () => {
		expect(placeImage({ width: 0, height: 10 }, { maxColumns: 80, maxRows: 20 }, graphics)).toBeUndefined()
		expect(placeImage({ width: 10, height: 10 }, { maxColumns: 0, maxRows: 20 }, graphics)).toBeUndefined()
	})
})

describe("imageFileSize", () => {
	it("reads a PNG header", () => {
		const png = rasterizeSvg(square(7), 7).png
		expect(imageFileSize(png)).toEqual({ mime: "image/png", width: 7, height: 7 })
	})

	it("reads a GIF header", () => {
		const gif = Uint8Array.from([...Buffer.from("GIF89a"), 0x2c, 0x01, 0x90, 0x00])
		expect(imageFileSize(gif)).toEqual({ mime: "image/gif", width: 300, height: 144 })
	})

	it("reads a JPEG start-of-frame after other segments", () => {
		const jpeg = Uint8Array.from([
			0xff, 0xd8,
			// APP0 segment, length 4 (two bytes of payload)
			0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
			// SOF0: length, precision, height 480, width 640
			0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03,
		])
		expect(imageFileSize(jpeg)).toEqual({ mime: "image/jpeg", width: 640, height: 480 })
	})

	it("reads a lossless WebP header", () => {
		const bytes = new Uint8Array(30)
		bytes.set(Buffer.from("RIFF"), 0)
		bytes.set(Buffer.from("WEBPVP8L"), 8)
		// 14 bits width-1, then 14 bits height-1: 100 x 50.
		new DataView(bytes.buffer).setUint32(21, 99 | (49 << 14), true)
		expect(imageFileSize(bytes)).toEqual({ mime: "image/webp", width: 100, height: 50 })
	})

	it("returns undefined for anything else", () => {
		expect(imageFileSize(Buffer.from("not an image at all, just text"))).toBeUndefined()
	})
})

describe("rasterizeSvg", () => {
	it("draws a bitmap wrapped in SVG at the requested size", () => {
		const png = rasterizeSvg(square(40, "#00ff00"), 40).png
		const raster = rasterizeSvg(wrapBitmapInSvg(png, "image/png", { width: 20, height: 20 }), 20)

		expect(raster).toMatchObject({ width: 20, height: 20 })
		expect(Array.from(raster.pixels.subarray(0, 4))).toEqual([0, 255, 0, 255])
	})
})

describe("flattenOnto", () => {
	it("blends by alpha onto the background and makes every pixel opaque", () => {
		const pixels = Uint8Array.from([255, 255, 255, 255, 255, 255, 255, 0, 200, 100, 0, 128])
		expect(Array.from(flattenOnto(pixels, "#204060"))).toEqual([
			255, 255, 255, 255, 32, 64, 96, 255, 116, 82, 48, 255,
		])
	})
})

describe("encodeImage", () => {
	const raster = rasterizeSvg(square(64), 64)

	it("sends kitty PNG data in chunks of at most 4096 bytes, the last with m=0", () => {
		const big = { ...raster, png: new Uint8Array(10_000).fill(7) }
		const parts = encodeImage("kitty", big).split("\x1b\\").filter(Boolean)

		expect(parts[0]?.startsWith("\x1b_Ga=T,f=100,t=d,q=2,C=1,m=1;")).toBe(true)
		expect(parts.at(-1)?.startsWith("\x1b_Gm=0;")).toBe(true)
		for (const part of parts) {
			expect(part.slice(part.indexOf(";") + 1).length).toBeLessThanOrEqual(4096)
		}
	})

	it("lets kitty move the cursor only when asked to", () => {
		expect(encodeImage("kitty", raster)).toContain(",C=1,")
		expect(encodeImage("kitty", raster, { movesCursor: true })).not.toContain("C=1")
	})

	it("sizes an iTerm2 image in pixels", () => {
		expect(encodeImage("iterm", raster)).toMatch(
			new RegExp(`^\\x1b\\]1337;File=inline=1;size=${raster.png.length};width=64px;height=64px;`),
		)
	})

	it("uses no more sixel colours than the terminal has registers", () => {
		const gradient =
			'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g">' +
			'<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>' +
			'<rect width="64" height="64" fill="url(#g)"/></svg>'
		const image = rasterizeSvg(gradient, 64)
		const registers = (sixel: string) => new Set(sixel.match(/#\d+;2;/g)).size

		expect(registers(encodeImage("sixel", image))).toBeGreaterThan(16)
		expect(registers(encodeImage("sixel", image, { colors: 16 }))).toBeLessThanOrEqual(16)
	})

	it("produces a sixel DCS sequence with the raster size", () => {
		const sixel = encodeImage("sixel", raster)
		expect(sixel.startsWith("\x1bP")).toBe(true)
		expect(sixel).toContain('"1;1;64;64')
		expect(sixel.endsWith("\x1b\\")).toBe(true)
	})
})
