// cd src && ./node_modules/.bin/vitest run core/prompts/sections/__tests__/terminal-display.spec.ts

import { terminalDisplaySection } from "../terminal-display"

describe("terminalDisplaySection", () => {
	it("is empty outside the CLI's terminal UI", () => {
		expect(terminalDisplaySection(undefined)).toBe("")
	})

	it("tells a model in an image terminal the exact image syntax and not to claim an unshown image", () => {
		const section = terminalDisplaySection("images")

		expect(section.startsWith("====\n\nTERMINAL DISPLAY\n\n")).toBe(true)
		expect(section).toContain("![Sales chart](out/sales.png)")
		expect(section).toContain("exception to the link rule in MARKDOWN RULES")
		expect(section).toContain("```mermaid")
		expect(section).toContain("Never say that an image is shown otherwise.")
	})

	it("tells a model in a text terminal that diagrams work and images do not", () => {
		const section = terminalDisplaySection("text")

		expect(section).toContain("```mermaid")
		expect(section).toContain("cannot show images")
		expect(section).not.toContain("![")
	})
})
