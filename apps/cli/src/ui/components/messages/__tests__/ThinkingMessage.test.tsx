import { render } from "ink-testing-library"

import ThinkingMessage from "../ThinkingMessage.js"

describe("ThinkingMessage", () => {
	it("renders the collapsed one-liner by default", () => {
		const { lastFrame } = render(<ThinkingMessage content="secret reasoning" />)
		const output = lastFrame()

		expect(output).toContain("∴ Thinking…")
		expect(output).not.toContain("secret reasoning")
	})

	it("renders the collapsed one-liner when no content is passed at all", () => {
		const { lastFrame } = render(<ThinkingMessage />)

		expect(lastFrame()).toContain("∴ Thinking…")
	})

	it("hides the content when expanded is explicitly false", () => {
		const { lastFrame } = render(<ThinkingMessage content="secret reasoning" expanded={false} />)
		const output = lastFrame()

		expect(output).toContain("∴ Thinking…")
		expect(output).not.toContain("secret reasoning")
	})

	it("shows the reasoning body under the header when expanded", () => {
		const { lastFrame } = render(<ThinkingMessage content={"First step.\nSecond step."} expanded={true} />)
		const output = lastFrame()

		expect(output).toContain("∴ Thinking")
		expect(output).not.toContain("Thinking…")
		expect(output).toContain("First step.")
		expect(output).toContain("Second step.")
	})

	it("sanitizes tabs and carriage returns in the expanded body", () => {
		const { lastFrame } = render(<ThinkingMessage content={"plan:\r\n\tstep one"} expanded={true} />)
		const output = lastFrame()

		expect(output).not.toContain("\t")
		expect(output).not.toContain("\r")
		expect(output).toContain("    step one")
	})

	it("keeps markdown syntax literal in the expanded body", () => {
		const { lastFrame } = render(<ThinkingMessage content="weigh *this* against **that**" expanded={true} />)

		expect(lastFrame()).toContain("weigh *this* against **that**")
	})

	it("falls back to the one-liner when expanded with empty content", () => {
		const { lastFrame } = render(<ThinkingMessage content="" expanded={true} />)

		expect(lastFrame()).toContain("∴ Thinking…")
	})

	it("falls back to the one-liner when expanded with whitespace-only content", () => {
		const { lastFrame } = render(<ThinkingMessage content={"  \n\t\n  "} expanded={true} />)

		expect(lastFrame()).toContain("∴ Thinking…")
	})
})
