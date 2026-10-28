import { render } from "ink-testing-library"

import Markdown from "../Markdown.js"

describe("Markdown", () => {
	it("renders bold text", () => {
		const { lastFrame } = render(<Markdown>{"hello **world** here"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("hello world here")
		expect(output).not.toContain("**")
	})

	it("renders inline code with code color", () => {
		const { lastFrame } = render(<Markdown>{"run `npm test` now"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("npm test")
		expect(output).not.toContain("`")
	})

	it("renders a fenced code block indented with the language tag", () => {
		const { lastFrame } = render(<Markdown>{"before\n```ts\nconst x = 1\nconsole.log(x)\n```\nafter"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("ts")
		expect(output).toContain("const x = 1")
		expect(output).toContain("console.log(x)")
		// block content is 2-space indented
		expect(output).toContain("  const x = 1")
	})

	it("renders an unordered list with bullet prefixes", () => {
		const { lastFrame } = render(<Markdown>{"- first\n- second"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("• first")
		expect(output).toContain("• second")
	})

	it("renders a blockquote with a dim quote prefix", () => {
		const { lastFrame } = render(<Markdown>{"> a wise quote"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("▎ a wise quote")
	})

	it("renders a link with its URL dimmed after the text", () => {
		const { lastFrame } = render(<Markdown>{"see [docs](https://example.com)"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("docs")
		expect(output).toContain("(https://example.com)")
	})

	it("renders malformed unclosed bold literally without throwing", () => {
		const { lastFrame } = render(<Markdown>{"this is **unclosed"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("this is **unclosed")
	})

	it("renders malformed mixed-line message without throwing", () => {
		// A text line with no trailing newline (common streaming tail)
		const { lastFrame } = render(<Markdown>{"no newline at end"}</Markdown>)
		expect(lastFrame()).toContain("no newline at end")
	})

	// A pipe used to be enough to have a line mistaken for a table separator row
	// and replaced by blank spacing, which is what left bare bullets in the
	// transcript (plan: 2026-09-22 empty bullets in the CLI transcript).
	it("renders a shell command containing pipes", () => {
		const { lastFrame } = render(<Markdown>{'grep -n -E "available|curtail" v29.txt | head -30'}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("curtail")
		expect(output).toContain("head -30")
	})

	it("renders prose mentioning a pipe", () => {
		const { lastFrame } = render(<Markdown>{"pipe it: ls -la | wc -l"}</Markdown>)
		expect(lastFrame()).toContain("pipe it: ls -la | wc -l")
	})

	it("renders table content rows verbatim", () => {
		const { lastFrame } = render(<Markdown>{"| register | value |"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("register")
		expect(output).toContain("value")
	})

	it("blanks out a real table separator row", () => {
		const { lastFrame } = render(<Markdown>{"| --- | :---: |"}</Markdown>)
		expect(lastFrame()).not.toContain("---")
	})

	// Lists, quotes and headings used to print their content raw, so the model's
	// `- **Plik:** opis` reached the screen with the asterisks still in it
	// (plan: 2026-09-22 inline markdown in CLI list items).
	it("renders bold inside an unordered list item", () => {
		const { lastFrame } = render(<Markdown>{"- **Plik:** `Markdown.tsx` opis"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("• Plik: Markdown.tsx opis")
		expect(output).not.toContain("**")
		expect(output).not.toContain("`")
	})

	it("renders bold inside an ordered list item", () => {
		const { lastFrame } = render(<Markdown>{"1. **Krok pierwszy** zbuduj"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("1. Krok pierwszy zbuduj")
		expect(output).not.toContain("**")
	})

	it("renders bold inside a blockquote", () => {
		const { lastFrame } = render(<Markdown>{"> **Uwaga:** ostrożnie"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("▎ Uwaga: ostrożnie")
		expect(output).not.toContain("**")
	})

	it("renders inline code inside a heading", () => {
		const { lastFrame } = render(<Markdown>{"## Plik `Markdown.tsx`"}</Markdown>)
		const output = lastFrame()
		expect(output).toContain("Plik Markdown.tsx")
		expect(output).not.toContain("`")
	})

	it("keeps underscores inside identifiers and paths", () => {
		const { lastFrame } = render(<Markdown>{"- edit my_var_name in src/__tests__/a.ts"}</Markdown>)
		expect(lastFrame()).toContain("• edit my_var_name in src/__tests__/a.ts")
	})

	it("still renders _emphasis_ at word boundaries", () => {
		const { lastFrame } = render(<Markdown>{"- _really_ matters"}</Markdown>)
		expect(lastFrame()).toContain("• really matters")
	})

	describe("inline math", () => {
		it.each([
			["$3x^3$ grows", "3x³ grows"],
			["on \\((-\\infty, 0]\\) it", "on (-∞, 0] it"],
			["inline $$\\frac{1}{2}$$ too", "inline ½ too"],
			["**bold** and $x_1$ and `$code$`", "bold and x₁ and $code$"],
			// Math inside emphasis (the 2026-10-12 attention screenshot).
			[
				"czyli **ile uwagi token $i$ poświęca tokenowi $j$** - stąd",
				"czyli ile uwagi token i poświęca tokenowi j - stąd",
			],
			["*weight $\\alpha_i$* and ~~$\\beta$~~", "weight αᵢ and β"],
			["[the $\\pi$ page](https://x.y)", "the π page (https://x.y)"],
			["**costs $5 and $10**", "costs $5 and $10"],
		])("renders %j as %j", (markdown, text) => {
			const { lastFrame } = render(<Markdown>{markdown}</Markdown>)

			expect(lastFrame()).toContain(text)
		})

		it.each(["It costs $5 and $10 today.", "between $ 5 and $ 10", "See \\[1\\] here", "Prices: 5$ and 10$."])(
			"leaves %j as written",
			(markdown) => {
				const { lastFrame } = render(<Markdown>{markdown}</Markdown>)

				expect(lastFrame()).toContain(markdown)
			},
		)
	})

	it.each([
		["unclosed \\[", "\\[".repeat(80000)],
		["unclosed \\(", "\\(".repeat(80000)],
		["unclosed link brackets", "[".repeat(160000)],
		["unclosed link targets", "[a](".repeat(40000)],
	])("renders a line of %s at once", (_label, line) => {
		const started = Date.now()
		const { lastFrame } = render(<Markdown>{line}</Markdown>)
		expect(Date.now() - started).toBeLessThan(2000)
		expect(lastFrame()).toBeTruthy()
	})

	it("keeps a link target with balanced parentheses whole", () => {
		const { lastFrame } = render(<Markdown>{"see [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) here"}</Markdown>)
		expect(lastFrame()).toContain("https://en.wikipedia.org/wiki/Foo_(bar)")
		expect(lastFrame()).not.toContain("[Foo]")
	})
})
