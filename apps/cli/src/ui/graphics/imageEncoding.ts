import { Resvg } from "@resvg/resvg-js"
import { image2sixel } from "sixel"

import type { ImageProtocol, TerminalGraphics } from "./terminalProbe.js"

/**
 * From an image (an SVG document or the bytes of a PNG, JPEG, GIF or WebP
 * file) to the escape sequence that draws it (plan: 2026-10-12 cli inline
 * images).
 *
 * resvg does all the decoding and scaling: an SVG renders directly, and a
 * bitmap is wrapped in a one-element SVG. One renderer therefore covers the
 * diagrams and the image files, and the result is always pixels at exactly
 * the size the transcript reserved for it.
 */

export interface PixelSize {
	width: number
	height: number
}

/** Where an image goes: the most it may take, in character cells. */
export interface ImageBox {
	maxColumns: number
	maxRows: number
}

export interface ImagePlacement extends PixelSize {
	/** Rows of the transcript the image covers. */
	rows: number
}

/**
 * The pixel size to draw an image of `natural` size at: its own size when it
 * fits, otherwise scaled down (never up) to fit the box. Rows round up, since
 * a partly covered row is taken all the same.
 */
export function placeImage(natural: PixelSize, box: ImageBox, graphics: TerminalGraphics): ImagePlacement | undefined {
	if (natural.width <= 0 || natural.height <= 0 || box.maxColumns <= 0 || box.maxRows <= 0) {
		return undefined
	}
	// A sixel terminal cuts off what exceeds its largest image instead of scaling.
	const limit = graphics.protocol === "sixel" ? graphics.maxImage : undefined
	const scale = Math.min(
		1,
		(box.maxColumns * graphics.cellWidth) / natural.width,
		(box.maxRows * graphics.cellHeight) / natural.height,
		limit ? limit.width / natural.width : 1,
		limit ? limit.height / natural.height : 1,
	)
	const width = Math.max(1, Math.floor(natural.width * scale))
	const height = Math.max(1, Math.floor(natural.height * scale))
	return { width, height, rows: Math.ceil(height / graphics.cellHeight) }
}

/**
 * The most pixels an image file may have to be drawn: 4096 x 4096, so a 12
 * megapixel phone photo fits. resvg decodes a bitmap at its full size before
 * scaling it down, synchronously, 4 bytes a pixel and more: a 380 KB PNG with
 * a 10000 x 10000 header took 470 MB and a second to draw at 600 x 600. The
 * path comes from the model's answer, so the header is not to be trusted.
 */
export const MAX_IMAGE_PIXELS = 4096 * 4096

/**
 * The pixel size stored in an image file's header, or undefined for a format
 * resvg cannot draw. Only the header is read; the whole image is decoded
 * later (see MAX_IMAGE_PIXELS).
 */
export function imageFileSize(bytes: Uint8Array): (PixelSize & { mime: string }) | undefined {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))

	// PNG: signature, then the IHDR chunk with width and height.
	if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47) {
		return { mime: "image/png", width: view.getUint32(16), height: view.getUint32(20) }
	}

	// GIF: "GIF87a"/"GIF89a", then little-endian width and height.
	if (bytes.length >= 10 && ascii(0, 4) === "GIF8") {
		return { mime: "image/gif", width: view.getUint16(6, true), height: view.getUint16(8, true) }
	}

	// WebP: a RIFF container whose first chunk says how the size is stored.
	if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
		const chunk = ascii(12, 4)
		if (chunk === "VP8 ") {
			return {
				mime: "image/webp",
				width: view.getUint16(26, true) & 0x3fff,
				height: view.getUint16(28, true) & 0x3fff,
			}
		}
		if (chunk === "VP8L") {
			const bits = view.getUint32(21, true)
			return { mime: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
		}
		if (chunk === "VP8X") {
			const width = 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16))
			const height = 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16))
			return { mime: "image/webp", width, height }
		}
		return undefined
	}

	// JPEG: walk the segments up to a start-of-frame marker, which holds the size.
	if (bytes.length >= 4 && view.getUint16(0) === 0xffd8) {
		let offset = 2
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) {
				return undefined
			}
			const marker = bytes[offset + 1]!
			const length = view.getUint16(offset + 2)
			// SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC).
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
				return { mime: "image/jpeg", height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) }
			}
			offset += 2 + length
		}
	}

	return undefined
}

/** An SVG document that draws the image file `bytes` at `size`. */
export function wrapBitmapInSvg(bytes: Uint8Array, mime: string, size: PixelSize): string {
	const data = Buffer.from(bytes).toString("base64")
	return (
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
		`width="${size.width}" height="${size.height}">` +
		`<image width="${size.width}" height="${size.height}" preserveAspectRatio="none" ` +
		`xlink:href="data:${mime};base64,${data}"/></svg>`
	)
}

export interface Raster extends PixelSize {
	/** RGBA, 4 bytes per pixel, row by row. */
	pixels: Uint8Array
	png: Uint8Array
}

/** Render `svg` at `width` pixels (the height follows the aspect ratio). */
export function rasterizeSvg(svg: string, width: number): Raster {
	const rendered = new Resvg(svg, {
		fitTo: { mode: "width", value: width },
		font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" },
	}).render()
	return {
		width: rendered.width,
		height: rendered.height,
		pixels: new Uint8Array(rendered.pixels),
		png: new Uint8Array(rendered.asPng()),
	}
}

/** kitty takes at most 4096 bytes of payload per escape sequence. */
const KITTY_CHUNK = 4096

/** Sixel's background when the terminal did not report its own. */
const DEFAULT_BACKGROUND = "#000000"

/**
 * `pixels` blended onto the opaque colour `background` (`#rrggbb`). Sixel has
 * no partial transparency, and the palette reduction treats a half
 * transparent pixel by its colour alone: the smoothed edges of light text on
 * a transparent background came out dark, and small text turned unreadable.
 */
export function flattenOnto(pixels: Uint8Array, background: string): Uint8Array {
	const bg = [1, 3, 5].map((start) => parseInt(background.slice(start, start + 2), 16))
	const out = new Uint8Array(pixels.length)
	for (let i = 0; i < pixels.length; i += 4) {
		const alpha = pixels[i + 3]! / 255
		for (let c = 0; c < 3; c++) {
			out[i + c] = Math.round(pixels[i + c]! * alpha + bg[c]! * (1 - alpha))
		}
		out[i + 3] = 255
	}
	return out
}

interface EncodeOptions {
	/**
	 * Let the terminal move the cursor past the image. Without it the caller
	 * puts the cursor back itself (see `inlineImages.ts`), and kitty is told
	 * to leave it alone.
	 */
	movesCursor?: boolean
	/** The terminal background, for the protocols without transparency. */
	background?: string
	/** Sixel colour registers; an image with more colours than registers comes out in wrong colours. */
	colors?: number
}

/** The escape sequence that draws `raster` at the cursor, in its own pixel size. */
export function encodeImage(
	protocol: ImageProtocol,
	raster: Raster,
	{ movesCursor = false, background = DEFAULT_BACKGROUND, colors = 256 }: EncodeOptions = {},
): string {
	switch (protocol) {
		case "kitty": {
			// a=T: transmit and display; f=100: PNG; q=2: no replies, which
			// would otherwise arrive on stdin as typed input; C=1: leave the
			// cursor where it is.
			const data = Buffer.from(raster.png).toString("base64")
			const display = `a=T,f=100,t=d,q=2${movesCursor ? "" : ",C=1"}`
			const parts: string[] = []
			for (let start = 0; start < data.length; start += KITTY_CHUNK) {
				const more = start + KITTY_CHUNK < data.length ? 1 : 0
				const keys = start === 0 ? `${display},m=${more}` : `m=${more}`
				parts.push(`\x1b_G${keys};${data.slice(start, start + KITTY_CHUNK)}\x1b\\`)
			}
			return parts.join("")
		}
		case "iterm": {
			const data = Buffer.from(raster.png).toString("base64")
			const args = `inline=1;size=${raster.png.length};width=${raster.width}px;height=${raster.height}px;preserveAspectRatio=1`
			return `\x1b]1337;File=${args}:${data}\x07`
		}
		case "sixel":
			return image2sixel(
				flattenOnto(raster.pixels, background),
				raster.width,
				raster.height,
				Math.max(2, Math.min(256, colors)),
			)
	}
}
