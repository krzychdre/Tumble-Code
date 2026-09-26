import { fireEvent, render, screen, waitFor } from "@/utils/test-utils"
import { vscode } from "@src/utils/vscode"

import MarkdownBlock from "../MarkdownBlock"

// Counts when KaTeX (through rehype-katex) and Mermaid are first imported: both are
// heavy and must stay out of the startup bundle until a message actually needs them.
const { importCounts } = vi.hoisted(() => ({ importCounts: { katex: 0, mermaid: 0 } }))

vi.mock("rehype-katex", async (importOriginal) => {
	importCounts.katex++
	return importOriginal()
})

// jsdom cannot lay out a real diagram, so Mermaid renders a marker SVG.
vi.mock("mermaid", () => {
	importCounts.mermaid++
	return {
		default: {
			initialize: vi.fn(),
			parse: vi.fn(async () => true),
			render: vi.fn(async () => ({ svg: '<svg data-testid="mermaid-svg"></svg>' })),
		},
	}
})

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({}),
}))

describe("MarkdownBlock", () => {
	it("should correctly handle URLs with trailing punctuation", async () => {
		const markdown = "Check out this link: https://example.com."
		const { container } = render(<MarkdownBlock markdown={markdown} />)

		// Wait for the content to be processed
		await screen.findByText(/Check out this link/, { exact: false })

		// Check for nested links - this should not happen
		const nestedLinks = container.querySelectorAll("a a")
		expect(nestedLinks.length).toBe(0)

		// Should have exactly one link
		const linkElement = screen.getByRole("link")
		expect(linkElement).toHaveAttribute("href", "https://example.com")
		expect(linkElement.textContent).toBe("https://example.com")

		// Check that the period is outside the link
		const paragraph = container.querySelector("p")
		expect(paragraph?.textContent).toBe("Check out this link: https://example.com.")
	}, 10000)

	it("should not strikethrough text wrapped in a single tilde (#154)", async () => {
		const markdown = "1. Lorem ~10 ipsum dolor sit 1~3 amet."
		const { container } = render(<MarkdownBlock markdown={markdown} />)

		await screen.findByText(/Lorem/, { exact: false })

		// Single tildes around numbers must NOT become strikethrough.
		expect(container.querySelectorAll("del").length).toBe(0)
		const listItem = container.querySelector("li")
		expect(listItem?.textContent).toContain("~10")
		expect(listItem?.textContent).toContain("1~3")
	}, 10000)

	it("should still strikethrough text wrapped in double tildes", async () => {
		const markdown = "This is ~~struck~~ text."
		const { container } = render(<MarkdownBlock markdown={markdown} />)

		await screen.findByText(/struck/, { exact: false })

		const del = container.querySelector("del")
		expect(del).not.toBeNull()
		expect(del?.textContent).toBe("struck")
	}, 10000)

	it("should render unordered lists with proper styling", async () => {
		const markdown = `Here are some items:
- First item
- Second item
  - Nested item
  - Another nested item`

		const { container } = render(<MarkdownBlock markdown={markdown} />)

		// Wait for the content to be processed
		await screen.findByText(/Here are some items/, { exact: false })

		// Check that ul elements exist
		const ulElements = container.querySelectorAll("ul")
		expect(ulElements.length).toBeGreaterThan(0)

		// Check that list items exist
		const liElements = container.querySelectorAll("li")
		expect(liElements.length).toBe(4)

		// Verify the text content
		expect(screen.getByText("First item")).toBeInTheDocument()
		expect(screen.getByText("Second item")).toBeInTheDocument()
		expect(screen.getByText("Nested item")).toBeInTheDocument()
		expect(screen.getByText("Another nested item")).toBeInTheDocument()
	})

	it("should render ordered lists with proper styling", async () => {
		const markdown = `And a numbered list:
1. Step one
2. Step two
3. Step three`

		const { container } = render(<MarkdownBlock markdown={markdown} />)

		// Wait for the content to be processed
		await screen.findByText(/And a numbered list/, { exact: false })

		// Check that ol elements exist
		const olElements = container.querySelectorAll("ol")
		expect(olElements.length).toBe(1)

		// Check that list items exist
		const liElements = container.querySelectorAll("li")
		expect(liElements.length).toBe(3)

		// Verify the text content
		expect(screen.getByText("Step one")).toBeInTheDocument()
		expect(screen.getByText("Step two")).toBeInTheDocument()
		expect(screen.getByText("Step three")).toBeInTheDocument()
	})

	it.each([
		["NOTE", "note", "codicon-info"],
		["TIP", "tip", "codicon-lightbulb"],
		["IMPORTANT", "important", "codicon-report"],
		["WARNING", "warning", "codicon-warning"],
		["CAUTION", "caution", "codicon-flame"],
	])(
		"renders a [!%s] GitHub-style alert (#258)",
		async (marker, type, iconClass) => {
			const markdown = `> [!${marker}]\n> Body content here.`
			const { container } = render(<MarkdownBlock markdown={markdown} />)

			await screen.findByText(/Body content here/, { exact: false })

			const alert = container.querySelector(`blockquote[data-alert-type="${type}"]`)
			expect(alert).not.toBeNull()
			expect(alert?.classList.contains("markdown-alert")).toBe(true)
			expect(alert?.classList.contains(`markdown-alert-${type}`)).toBe(true)

			// Distinct icon for the alert type.
			expect(alert?.querySelector(`.${iconClass}`)).not.toBeNull()

			// The raw "[!TYPE]" marker must not leak into the rendered text.
			expect(alert?.textContent).not.toContain(`[!${marker}]`)
			expect(alert?.textContent).toContain("Body content here.")
		},
		10000,
	)

	it("recognizes alert markers case-insensitively", async () => {
		const markdown = `> [!note]\n> lowercase marker`
		const { container } = render(<MarkdownBlock markdown={markdown} />)

		await screen.findByText(/lowercase marker/, { exact: false })

		expect(container.querySelector('blockquote[data-alert-type="note"]')).not.toBeNull()
	}, 10000)

	it("renders alert content with inline markdown (bold, code, links)", async () => {
		const markdown = `> [!WARNING]\n> Be **careful** with \`rm -rf\` and see [docs](https://example.com).`
		const { container } = render(<MarkdownBlock markdown={markdown} />)

		await screen.findByText(/careful/, { exact: false })

		const alert = container.querySelector('blockquote[data-alert-type="warning"]')
		expect(alert).not.toBeNull()
		expect(alert?.querySelector("strong")?.textContent).toBe("careful")
		expect(alert?.querySelector("code")?.textContent).toBe("rm -rf")
		expect(alert?.querySelector("a")).toHaveAttribute("href", "https://example.com")
	}, 10000)

	it("keeps a normal blockquote rendering unchanged", async () => {
		const markdown = `> Just an ordinary quote.\n> Second line.`
		const { container } = render(<MarkdownBlock markdown={markdown} />)

		await screen.findByText(/ordinary quote/, { exact: false })

		const blockquote = container.querySelector("blockquote")
		expect(blockquote).not.toBeNull()
		expect(blockquote?.hasAttribute("data-alert-type")).toBe(false)
		expect(blockquote?.classList.contains("markdown-alert")).toBe(false)
		// No injected alert title/icon for normal blockquotes.
		expect(blockquote?.querySelector(".markdown-alert-title")).toBeNull()
		expect(blockquote?.querySelector(".codicon")).toBeNull()
	}, 10000)

	it("treats an unsupported marker as a normal blockquote", async () => {
		const markdown = `> [!INFO]\n> Not a supported alert type.`
		const { container } = render(<MarkdownBlock markdown={markdown} />)

		await screen.findByText(/Not a supported alert type/, { exact: false })

		const blockquote = container.querySelector("blockquote")
		expect(blockquote?.hasAttribute("data-alert-type")).toBe(false)
		// The raw marker text remains visible since it was not recognized.
		expect(blockquote?.textContent).toContain("[!INFO]")
	}, 10000)

	it("should render nested lists with proper hierarchy", async () => {
		const markdown = `Complex list:
1. First level ordered
   - Second level unordered
   - Another second level
     1. Third level ordered
     2. Another third level
2. Back to first level`

		const { container } = render(<MarkdownBlock markdown={markdown} />)

		// Wait for the content to be processed
		await screen.findByText(/Complex list/, { exact: false })

		// Check nested structure
		const olElements = container.querySelectorAll("ol")
		const ulElements = container.querySelectorAll("ul")

		expect(olElements.length).toBeGreaterThan(0)
		expect(ulElements.length).toBeGreaterThan(0)

		// Verify all text is rendered
		expect(screen.getByText("First level ordered")).toBeInTheDocument()
		expect(screen.getByText("Second level unordered")).toBeInTheDocument()
		expect(screen.getByText("Third level ordered")).toBeInTheDocument()
		expect(screen.getByText("Back to first level")).toBeInTheDocument()
	})

	// These run in order: the first proves nothing heavy loaded for plain markdown.
	describe("lazy KaTeX and Mermaid", () => {
		it("does not load KaTeX or Mermaid for markdown without math or diagrams", async () => {
			render(<MarkdownBlock markdown={"Plain **text** with `code` and a list:\n\n- one\n- two"} />)

			await screen.findByText(/Plain/)

			expect(importCounts.katex).toBe(0)
			expect(importCounts.mermaid).toBe(0)
		})

		it("loads KaTeX on demand and renders inline and display math", async () => {
			const { container } = render(<MarkdownBlock markdown={"Euler: $e^{i\\pi}+1=0$\n\n$$\na^2+b^2=c^2\n$$"} />)

			await waitFor(() => expect(container.querySelectorAll(".katex").length).toBe(2))
			expect(container.querySelector(".katex-display")).not.toBeNull()
			expect(importCounts.katex).toBe(1)
			expect(importCounts.mermaid).toBe(0)
		})

		it("loads Mermaid on demand and renders the diagram", async () => {
			render(<MarkdownBlock markdown={"```mermaid\ngraph TD; A-->B\n```"} />)

			expect(await screen.findByTestId("mermaid-svg", {}, { timeout: 3000 })).toBeInTheDocument()
			expect(importCounts.mermaid).toBe(1)
		})
	})

	// remark-math read any "$...$" pair as inline math, so prose prices ("$5 and $10")
	// turned into italic KaTeX. Single-dollar math now follows Pandoc's rule: the
	// opening "$" is followed by a non-space, the closing "$" is preceded by a
	// non-space and not followed by a digit.
	describe("dollar signs", () => {
		beforeAll(async () => {
			const { container, unmount } = render(<MarkdownBlock markdown="$x$" />)
			await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull())
			unmount()
		})

		const mathSources = (container: HTMLElement) =>
			Array.from(container.querySelectorAll(".katex annotation")).map((node) => node.textContent)

		it.each([
			"It costs $5 and $10 today.",
			"It costs $5, or $10 with tax.",
			"Between $1,000 and $2,500 per month.",
			"between $ 5 and $ 10",
			"Prices: 5$ and 10$.",
		])("renders %j as plain text", (markdown) => {
			const { container } = render(<MarkdownBlock markdown={markdown} />)

			expect(container.querySelector(".katex")).toBeNull()
			expect(container.querySelector("p")?.textContent).toBe(markdown)
		})

		it("renders prices in a table row as plain text", () => {
			const { container } = render(
				<MarkdownBlock markdown={"| Plan | Monthly | Yearly |\n| --- | --- | --- |\n| Pro | $5 | $50 |"} />,
			)

			expect(container.querySelector(".katex")).toBeNull()
			expect(Array.from(container.querySelectorAll("td")).map((cell) => cell.textContent)).toEqual([
				"Pro",
				"$5",
				"$50",
			])
		})

		it.each([
			["$x$", ["x"]],
			["$2^n$", ["2^n"]],
			["$2x + 1$", ["2x + 1"]],
			["$10^{-3}$ is small", ["10^{-3}"]],
			["a $x$ b $y$", ["x", "y"]],
			["inline $$y_1$$ too", ["y_1"]],
		])("renders %j as inline math", (markdown, sources) => {
			const { container } = render(<MarkdownBlock markdown={markdown} />)

			expect(mathSources(container)).toEqual(sources)
		})

		it("keeps display math and an escaped dollar", () => {
			const { container } = render(<MarkdownBlock markdown={"\\$5 is literal\n\n$$\n5x = 10\n$$"} />)

			expect(container.querySelector(".katex-display")).not.toBeNull()
			expect(container.querySelector("p")?.textContent).toBe("$5 is literal")
		})
	})

	// react-markdown's default urlTransform empties every href whose scheme is not
	// http(s), mailto, irc(s) or xmpp. That also emptied "file://" links and the
	// "name.ext:line" links the system prompt asks models to write, so the click
	// handler below never saw a path to open.
	describe("file links", () => {
		beforeEach(() => {
			vi.mocked(vscode.postMessage).mockClear()
		})

		it.each([
			["[a](file:///tmp/a.ts)", "file:///tmp/a.ts", { type: "openFile", text: "/tmp/a.ts", values: undefined }],
			[
				"[a](file:///tmp/a.ts:12)",
				"file:///tmp/a.ts:12",
				{ type: "openFile", text: "/tmp/a.ts", values: { line: 12 } },
			],
			["[README.md](README.md:6)", "README.md:6", { type: "openFile", text: "./README.md", values: { line: 6 } }],
			["[f](src/a.ts:3)", "src/a.ts:3", { type: "openFile", text: "./src/a.ts", values: { line: 3 } }],
		])("keeps the href of %s and opens the file on click", (markdown, href, message) => {
			render(<MarkdownBlock markdown={markdown} />)
			const link = screen.getByRole("link")

			expect(link).toHaveAttribute("href", href)
			fireEvent.click(link)
			expect(vscode.postMessage).toHaveBeenCalledWith(message)
		})

		it.each([
			["https://example.com/a", "https://example.com/a"],
			["mailto:a@b.c", "mailto:a@b.c"],
			["./a.md#top", "./a.md#top"],
			["javascript:alert(1)", ""],
			["JavaScript:alert(1)", ""],
			["javascript:1", ""],
			["vbscript:msgbox(1)", ""],
			["data:text/html,x", ""],
			["vscode://file/a", ""],
		])("href %s becomes %j", (url, href) => {
			const { container } = render(<MarkdownBlock markdown={`[x](${url})`} />)

			expect(container.querySelector("a")?.getAttribute("href")).toBe(href)
		})
	})
})
