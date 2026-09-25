import { render, screen } from "@/utils/test-utils"

import { ModelDescriptionMarkdown } from "../ModelDescriptionMarkdown"

const renderDescription = (markdown: string) =>
	render(<ModelDescriptionMarkdown key="description" markdown={markdown} isExpanded setIsExpanded={() => {}} />)

describe("ModelDescriptionMarkdown", () => {
	it("renders links as anchors that point at the target", async () => {
		renderDescription("See the [model card](https://example.com/card) for details.")

		const link = await screen.findByRole("link", { name: "model card" })
		expect(link).toHaveAttribute("href", "https://example.com/card")
	})

	it("renders bullet and numbered lists", async () => {
		const { container } = renderDescription("Strengths:\n\n- coding\n- reasoning\n\nSteps:\n\n1. first\n2. second")

		await screen.findByText("coding")
		expect(container.querySelectorAll("ul > li")).toHaveLength(2)
		expect(container.querySelectorAll("ol > li")).toHaveLength(2)
		expect(screen.getByText("second").tagName).toBe("LI")
	})

	it("renders inline code and fenced code blocks", async () => {
		const { container } = renderDescription("Call `generate()` like this:\n\n```ts\nconst x = 1\n```")

		const inline = await screen.findByText("generate()")
		expect(inline.tagName).toBe("CODE")
		expect(inline.closest("pre")).toBeNull()

		const block = container.querySelector("pre > code")
		expect(block).not.toBeNull()
		expect(block).toHaveTextContent("const x = 1")
		expect(block).toHaveClass("language-ts")
	})

	it("renders emphasis and paragraphs, and does not inject raw HTML", async () => {
		const { container } = renderDescription("A **fast** model.\n\nSecond <script>alert(1)</script> paragraph.")

		expect((await screen.findByText("fast")).tagName).toBe("STRONG")
		expect(container.querySelectorAll("p")).toHaveLength(2)
		expect(container.querySelector("script")).toBeNull()
	})

	it("renders nothing for an empty description", () => {
		const { container } = renderDescription("")

		expect(container.querySelector("p")).toBeNull()
	})
})
