import { createRequire } from "module"

import type { PixelSize } from "./imageEncoding.js"

/**
 * Display formulas as images (plan: 2026-10-12 cli math).
 *
 * MathJax lays TeX out without a browser and writes an SVG whose glyphs are
 * paths, which resvg draws as it is (KaTeX writes HTML and CSS instead). It
 * is loaded on the first formula, not at startup. MathJax fetches the glyphs
 * of rarer alphabets (`\text` letters, `\mathbb`) from separate files on
 * demand; with a synchronous loader it reads them at once, so a formula is
 * drawn in the same render as the rest of the answer: the transcript is
 * printed once and cannot wait for it.
 */

interface MathJaxDocument {
	convert(tex: string, options: { display: boolean }): unknown
}

interface MathJax {
	document(source: string, options: object): MathJaxDocument
	asyncLoad: ((name: string) => unknown) | null
	asyncIsSynchronous: boolean
}

let converter: { document: MathJaxDocument; svgOf(node: unknown): string } | null | undefined

/** The MathJax document, or null when MathJax cannot be loaded. */
function getConverter() {
	if (converter !== undefined) {
		return converter
	}
	try {
		const load = createRequire(import.meta.url)
		const { mathjax } = load("@mathjax/src/js/mathjax.js") as { mathjax: MathJax }
		const { TeX } = load("@mathjax/src/js/input/tex.js")
		const { SVG } = load("@mathjax/src/js/output/svg.js")
		const { liteAdaptor } = load("@mathjax/src/js/adaptors/liteAdaptor.js")
		const { RegisterHTMLHandler } = load("@mathjax/src/js/handlers/html.js")
		load("@mathjax/src/js/input/tex/base/BaseConfiguration.js")
		load("@mathjax/src/js/input/tex/ams/AmsConfiguration.js")
		const { MathJaxNewcmFont } = load("@mathjax/mathjax-newcm-font/js/svg.js")

		// A glyph file that fails to load leaves its characters out; MathJax
		// would console.warn a thrown error, which would scribble on the TUI.
		mathjax.asyncLoad = (name) => {
			try {
				return load(name)
			} catch {
				return undefined
			}
		}
		mathjax.asyncIsSynchronous = true

		const adaptor = liteAdaptor()
		RegisterHTMLHandler(adaptor)
		converter = {
			document: mathjax.document("", {
				InputJax: new TeX({ packages: ["base", "ams"] }),
				// "none": every glyph is its own path, no <use> references.
				OutputJax: new SVG({ fontCache: "none", fontData: MathJaxNewcmFont }),
			}),
			svgOf: (node) => adaptor.innerHTML(node),
		}
	} catch {
		converter = null
	}
	return converter
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
	const mathjax = getConverter()
	if (!mathjax) {
		return undefined
	}
	try {
		const svg = mathjax.svgOf(mathjax.document.convert(tex, { display: true }))
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
