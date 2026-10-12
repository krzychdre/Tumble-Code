import fs from "fs"
import { createRequire } from "module"

import { debugLog } from "@tumble-code/core/cli"

import type { PixelSize } from "./imageEncoding.js"

/**
 * Display formulas as images (plan: 2026-10-12 cli math).
 *
 * MathJax lays TeX out without a browser and writes an SVG whose glyphs are
 * paths, which resvg draws as it is (KaTeX writes HTML and CSS instead).
 * MathJax and the glyph ranges common math needs are built into their own
 * file, `mathjax-engine.cjs` next to the bundle (about 4 MB instead of the
 * 105 MB of the npm packages), and loaded on the first formula, not at
 * startup. Loading is synchronous: the transcript is printed once, so the
 * image must exist in the same render as the rest of the answer.
 */

let engine: { texToSvg(tex: string): string } | null | undefined

/** MathJax, or null when it cannot be loaded. */
function getEngine() {
	if (engine === undefined) {
		const load = createRequire(import.meta.url)
		// The built file in dist/, else the source (development and tests,
		// which Node loads with its TypeScript type stripping).
		const file = fs.existsSync(new URL("./mathjax-engine.cjs", import.meta.url))
			? "./mathjax-engine.cjs"
			: "./mathjax-engine.ts"
		try {
			engine = load(file)
		} catch (error) {
			debugLog("[CLI] MathJax could not be loaded", error instanceof Error ? error.message : String(error))
			engine = null
		}
	}
	return engine
}

/**
 * The formula as an SVG painted in `foreground`, `emPixels` to the em, and
 * its size in pixels. Undefined when MathJax is missing or the TeX has an
 * error (an unknown command, an unclosed brace): the caller shows text.
 */
export function renderMathImage(
	tex: string,
	foreground: string,
	emPixels: number,
): { svg: string; size: PixelSize } | undefined {
	const mathjax = getEngine()
	if (!mathjax) {
		return undefined
	}
	try {
		const svg = mathjax.texToSvg(tex)
		if (svg.includes("data-mjx-error")) {
			return undefined
		}
		// The viewBox is in thousandths of an em.
		const [, , width, height] = (svg.match(/viewBox="([^"]+)"/)?.[1] ?? "").split(/\s+/).map(Number)
		if (!width || !height) {
			return undefined
		}
		const size = { width: (width / 1000) * emPixels, height: (height / 1000) * emPixels }
		// resvg knows no currentColor without a color property, and the
		// width and height are in ex, which it cannot resolve.
		const sized = svg
			.replace(/currentColor/g, foreground)
			.replace(/^<svg([^>]*?)\swidth="[^"]*"/, `<svg$1 width="${size.width}"`)
			.replace(/^<svg([^>]*?)\sheight="[^"]*"/, `<svg$1 height="${size.height}"`)
		return { svg: sized, size }
	} catch {
		return undefined
	}
}
