// The KaTeX HTML in chat messages and the KaTeX stylesheet come from two
// different places: rehype-katex renders with the `katex` package it resolves
// itself, while `src/index.css` imports `katex/dist/katex.min.css` from the
// webview's own `katex` dependency. KaTeX's layout lives almost entirely in
// that stylesheet (fraction bars, radicals, sub- and superscript offsets), and
// 0.18 renamed its internal classes, so the two copies must stay the same
// version or formulas render as jumbled text. This spec fails when they drift.

import fs from "fs"
import path from "path"
import { createRequire } from "module"
import { render, waitFor } from "@/utils/test-utils"

import MarkdownBlock from "../MarkdownBlock"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

const WEBVIEW_ROOT = path.resolve(__dirname, "../../../..")
const webviewRequire = createRequire(path.join(WEBVIEW_ROOT, "package.json"))

const cssPackageJson = webviewRequire.resolve("katex/package.json")
const css = fs.readFileSync(path.join(path.dirname(cssPackageJson), "dist", "katex.min.css"), "utf8")

const rehypeKatexDir = fs.realpathSync(path.join(WEBVIEW_ROOT, "node_modules", "rehype-katex"))
const rehypeKatexRequire = createRequire(path.join(rehypeKatexDir, "package.json"))

const MATH = [
	"Inline $e^{i\\pi}+1=0$, $x_1^2$, $\\hat{a}\\vec{b}$ and $\\mathbb{R}\\mathcal{L}$.",
	"$$\n\\frac{a}{b} = \\sqrt[3]{c^2} + \\binom{n}{k}\n$$",
	"$$\n\\begin{aligned} x &= \\sum_{i=0}^{n} i \\\\ y &= \\int_0^1 f(t)\\,dt \\end{aligned}\n$$",
	"$$\n\\left( \\begin{matrix} 1 & 2 \\\\ 3 & 4 \\end{matrix} \\right) \\overbrace{a+b}^{x} \\underline{u}\n$$",
	"Bad: $\\notacommand{x}$",
].join("\n\n")

describe("KaTeX stylesheet matches the KaTeX that renders chat math", () => {
	it("uses the same KaTeX version for the stylesheet and for rehype-katex", () => {
		const cssVersion = JSON.parse(fs.readFileSync(cssPackageJson, "utf8")).version
		const renderVersion = JSON.parse(
			fs.readFileSync(rehypeKatexRequire.resolve("katex/package.json"), "utf8"),
		).version
		expect(renderVersion).toBe(cssVersion)
	})

	it("has a stylesheet rule for every class in the rendered KaTeX HTML", async () => {
		const { container } = render(<MarkdownBlock markdown={MATH} />)
		await waitFor(() => expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(8))

		const classes = new Set<string>()
		container.querySelectorAll(".katex-html, .katex-html *").forEach((el) => {
			el.classList.forEach((c) => classes.add(c))
		})
		expect(classes.size).toBeGreaterThan(20)

		const escape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
		const unstyled = [...classes].filter((c) => !new RegExp(`\\.${escape(c)}(?![\\w-])`).test(css)).sort()
		// Classes KaTeX emits as semantic markers without any rule of their own.
		expect(unstyled).toEqual(KNOWN_UNSTYLED)
	})
})

// These are TeX atom types (ordinary, binary, relation, ...) and the \text
// marker; KaTeX spaces atoms itself and styles none of them by class.
const KNOWN_UNSTYLED = ["mbin", "mclose", "minner", "mop", "mopen", "mord", "mrel", "mtight", "text"]
