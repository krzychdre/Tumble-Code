import { mathjax } from "@mathjax/src/js/mathjax.js"
import { TeX } from "@mathjax/src/js/input/tex.js"
import { SVG } from "@mathjax/src/js/output/svg.js"
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js"
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js"
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js"
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js"
import "@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js"
import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js"

// The glyph ranges beyond the font's base set that common math needs,
// measured on a corpus of everyday TeX (plan: 2026-10-12 cli math): relations
// and operators, shapes (∞, ∂, ∇, ∅, □), script, fraktur, double-struck and
// calligraphic letters, sans-serif and monospace (\mathsf, \mathtt), and
// accented Latin letters in \text, \textbf and \textit (Polish ą, ż, ł...).
// These are about 2.5 MB of the font's 10 MB of ranges; Cyrillic, Greek
// extensions, Arabic, Braille and the like are left out.
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/math.js"
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/shapes.js"
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/script.js"
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/fraktur.js"
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/double-struck.js"
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/calligraphic.js"
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/sans-serif.js"
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/monospace.js"
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/latin.js"
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-b.js"
import "@mathjax/mathjax-newcm-font/js/svg/dynamic/latin-i.js"

/**
 * MathJax with TeX input and SVG output, built into its own file
 * (`dist/mathjax-engine.cjs`, see tsup.config.ts) that `math.ts` loads on the
 * first formula. Only the parts imported here are shipped.
 *
 * The glyph ranges are registered by the imports above. MathJax still asks
 * for a range before it uses it; answering at once (synchronously) applies
 * the registered glyphs in the same call, so a formula is laid out in one go.
 * A range that is not shipped stays empty, and its characters are drawn as
 * plain text instead of glyph paths.
 */
mathjax.asyncLoad = () => undefined
mathjax.asyncIsSynchronous = true

const adaptor = liteAdaptor()
RegisterHTMLHandler(adaptor)

const document = mathjax.document("", {
	InputJax: new TeX({ packages: ["base", "ams", "boldsymbol"] }),
	// "none": every glyph is its own path, no <use> references.
	OutputJax: new SVG({ fontCache: "none", fontData: MathJaxNewcmFont }),
})

/** The display formula as an SVG document (`<svg>...</svg>`). */
export function texToSvg(tex: string): string {
	return adaptor.innerHTML(document.convert(tex, { display: true }) as never)
}
