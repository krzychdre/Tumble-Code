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
})
