// Characterization of the CSS of the content blocks (UI plan §2.12, part b:
// CodeBlock, MarkdownBlock, MermaidBlock and settings/styles.ts leave
// styled-components). The assertions read the resolved style of each element
// through jsdom's getComputedStyle, so they do not care whether a declaration
// comes from a styled-components <style> tag or from a class rule in
// index.css.
//
// Vitest does not run Tailwind, so the index.css rules of these blocks are
// injected by hand: `injectContentBlockCss` copies the plain-CSS section
// between the `content-blocks:start` and `content-blocks:end` markers of
// index.css into a <style> tag. Before the move the markers do not exist and
// the helper does nothing (styled-components injects its own tag).
//
// jsdom resolves neither :hover nor var() (a shorthand holding var(), such as
// the alert border-left, reads back empty), so hover rules are out of reach and
// custom properties are compared as their literal text.

import fs from "fs"
import path from "path"
import React from "react"

import { render, screen, waitFor } from "@/utils/test-utils"

import CodeBlock from "../CodeBlock"
import MarkdownBlock from "../MarkdownBlock"
import MermaidBlock from "../MermaidBlock"
import { ModelDescriptionMarkdown } from "../../settings/ModelDescriptionMarkdown"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

// The fallback <pre><code> is what CodeBlock shows until Shiki answers; the
// highlighter never answers here, so the DOM stays on that stable shape.
vi.mock("@src/utils/highlighter", () => ({
	normalizeLanguage: (lang: string) => lang || "txt",
	isLanguageLoaded: () => false,
	getHighlighter: () => new Promise(() => {}),
}))

const { mermaidRender } = vi.hoisted(() => ({
	mermaidRender: { result: undefined as undefined | Promise<{ svg: string }> },
}))

vi.mock("mermaid", async (importOriginal) => {
	const real = (await importOriginal<typeof import("mermaid")>()).default
	return {
		default: {
			...real,
			parse: real.parse.bind(real),
			initialize: real.initialize.bind(real),
			render: async () => mermaidRender.result ?? { svg: '<svg data-testid="mermaid-svg"></svg>' },
		},
	}
})

const injectContentBlockCss = () => {
	const indexCss = fs.readFileSync(path.join(__dirname, "..", "..", "..", "index.css"), "utf8")
	const match = /\/\* content-blocks:start \*\/([\s\S]*?)\/\* content-blocks:end \*\//.exec(indexCss)
	if (!match) return
	const style = document.createElement("style")
	style.setAttribute("data-content-blocks", "")
	style.textContent = match[1]
	document.head.appendChild(style)
}

beforeAll(() => {
	injectContentBlockCss()
	vi.spyOn(console, "warn").mockImplementation(() => {})
})

const css = (el: Element | null | undefined, prop: string) => {
	if (!el) throw new Error(`no element for ${prop}`)
	// A value holding var() keeps its source text in jsdom, line breaks included;
	// styled-components minified it, so whitespace after commas is dropped.
	return getComputedStyle(el).getPropertyValue(prop).trim().replace(/,\s+/g, ",")
}

const pick = (el: Element | null | undefined, props: string[]) =>
	Object.fromEntries(props.map((prop) => [prop, css(el, prop)]))

describe("CodeBlock styles", () => {
	const renderCodeBlock = (props: Partial<React.ComponentProps<typeof CodeBlock>> = {}) => {
		const { container } = render(<CodeBlock source={"const a = 1\nconst b = 2"} language="ts" {...props} />)
		const root = container.firstElementChild as HTMLElement
		const scroller = root.firstElementChild as HTMLElement
		const toolbar = root.children[1] as HTMLElement
		return { root, scroller, toolbar }
	}

	it("container: positioned, clipped, editor background", () => {
		const { root } = renderCodeBlock()
		expect(pick(root, ["position", "overflow", "background-color"])).toMatchInlineSnapshot(`
			{
			  "background-color": "var(--vscode-editor-background,--vscode-sideBar-background,rgb(30 30 30))",
			  "overflow": "hidden",
			  "position": "relative",
			}
		`)
	})

	it("scroller: collapsed to 500px by default, square, padded, scrolls vertically", () => {
		const { scroller } = renderCodeBlock()
		expect(pick(scroller, ["max-height", "overflow-y", "padding", "border-radius", "background-color"]))
			.toMatchInlineSnapshot(`
				{
				  "background-color": "var(--vscode-editor-background,--vscode-sideBar-background,rgb(30 30 30))",
				  "border-radius": "0px",
				  "max-height": "500px",
				  "overflow-y": "auto",
				  "padding": "8px 3px",
				}
			`)
	})

	it("scroller: honours collapsedHeight, drops the limit when not window-shaded, merges preStyle", () => {
		expect(css(renderCodeBlock({ collapsedHeight: 200 }).scroller, "max-height")).toMatchInlineSnapshot(`"200px"`)
		expect(css(renderCodeBlock({ initialWindowShade: false }).scroller, "max-height")).toMatchInlineSnapshot(
			`"none"`,
		)
		const withPreStyle = renderCodeBlock({ preStyle: { marginTop: "7px", maxWidth: "321px" } }).scroller
		expect(pick(withPreStyle, ["margin-top", "max-width"])).toMatchInlineSnapshot(`
			{
			  "margin-top": "7px",
			  "max-width": "321px",
			}
		`)
	})

	it("pre and code: wrap by default, keep lines with initialWordWrap=false, mono 0.95em", () => {
		const wrapped = renderCodeBlock().scroller
		const pre = wrapped.querySelector("pre")
		const code = wrapped.querySelector("code")
		expect(pick(pre, ["box-sizing", "width", "background-color"])).toMatchInlineSnapshot(`
			{
			  "background-color": "var(--vscode-editor-background,--vscode-sideBar-background,rgb(30 30 30))",
			  "box-sizing": "border-box",
			  "width": "100%",
			}
		`)
		const text = ["white-space", "word-break", "overflow-wrap", "font-size", "font-family"]
		expect({ pre: pick(pre, text), code: pick(code, text) }).toMatchInlineSnapshot(`
			{
			  "code": {
			    "font-family": "var(--font-mono)",
			    "font-size": "14.44px",
			    "overflow-wrap": "break-word",
			    "white-space": "pre-wrap",
			    "word-break": "normal",
			  },
			  "pre": {
			    "font-family": "var(--font-mono)",
			    "font-size": "15.2px",
			    "overflow-wrap": "break-word",
			    "white-space": "pre-wrap",
			    "word-break": "normal",
			  },
			}
		`)
		expect(pick(code, ["color"])).toMatchInlineSnapshot(`
			{
			  "color": "var(--vscode-editor-foreground,#fff)",
			}
		`)

		const unwrapped = renderCodeBlock({ initialWordWrap: false }).scroller
		const wrap = ["white-space", "word-break", "overflow-wrap"]
		expect({
			pre: pick(unwrapped.querySelector("pre"), wrap),
			code: pick(unwrapped.querySelector("code"), wrap),
		}).toMatchInlineSnapshot(`
			{
			  "code": {
			    "overflow-wrap": "normal",
			    "white-space": "pre",
			    "word-break": "normal",
			  },
			  "pre": {
			    "overflow-wrap": "normal",
			    "white-space": "pre",
			    "word-break": "normal",
			  },
			}
		`)
	})

	it("toolbar: fixed, hidden until the block is partly visible, 24px square buttons", () => {
		const { toolbar } = renderCodeBlock()
		expect(
			pick(toolbar, ["position", "z-index", "display", "padding", "border-radius", "pointer-events", "opacity"]),
		).toMatchInlineSnapshot(`
			{
			  "border-radius": "0px",
			  "display": "inline-flex",
			  "opacity": "0",
			  "padding": "4px 6px",
			  "pointer-events": "none",
			  "position": "fixed",
			  "z-index": "40",
			}
		`)
		expect(css(toolbar, "top")).toMatchInlineSnapshot(`"var(--copy-button-top)"`)
		expect(css(toolbar, "right")).toMatchInlineSnapshot(`"var(--copy-button-right,8px)"`)

		const buttons = toolbar.querySelectorAll("button")
		expect(buttons.length).toBeGreaterThan(0)
		for (const button of buttons) {
			expect(
				pick(button, [
					"width",
					"height",
					"padding",
					"opacity",
					"border-radius",
					"display",
					"cursor",
					"position",
				]),
			).toMatchInlineSnapshot(`
				{
				  "border-radius": "0px",
				  "cursor": "var(--copy-button-cursor,default)",
				  "display": "flex",
				  "height": "24px",
				  "opacity": "0.4",
				  "padding": "4px",
				  "position": "relative",
				  "width": "24px",
				}
			`)
		}
	})
})

describe("MarkdownBlock styles", () => {
	const MARKDOWN = [
		"# Title",
		"",
		"## Section",
		"",
		"### Sub",
		"",
		"Some **bold** text with `inline` code and a [link](https://example.com).",
		"",
		"- one",
		"  - nested",
		"",
		"1. first",
		"   1. second",
		"      1. third",
		"",
		"| a | b |",
		"| - | - |",
		"| 1 | 2 |",
		"| 3 | 4 |",
		"",
		"> [!NOTE]",
		"> Heads up",
	].join("\n")

	const renderMarkdown = () => {
		const { container } = render(<MarkdownBlock markdown={MARKDOWN} />)
		return container.firstElementChild as HTMLElement
	}

	it("root: theme font and size", () => {
		const root = renderMarkdown()
		expect(css(root, "font-family")).toMatchInlineSnapshot(
			`"var(--vscode-font-family),system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,"Open Sans","Helvetica Neue",sans-serif"`,
		)
		expect(css(root, "font-size")).toMatchInlineSnapshot(`"var(--vscode-font-size,13px)"`)
	})

	it("text: paragraphs keep line breaks, headings and strong keep their weights", () => {
		const root = renderMarkdown()
		expect(pick(root.querySelector("p"), ["white-space", "margin", "line-height"])).toMatchInlineSnapshot(`
			{
			  "line-height": "21.6px",
			  "margin": "16px 0px 4px",
			  "white-space": "pre-wrap",
			}
		`)
		expect(pick(root.querySelector("h1"), ["font-size", "font-weight", "margin"])).toMatchInlineSnapshot(`
			{
			  "font-size": "26.4px",
			  "font-weight": "700",
			  "margin": "35.64px 0px 13.2px",
			}
		`)
		expect(pick(root.querySelector("h2"), ["font-size", "font-weight"])).toMatchInlineSnapshot(`
			{
			  "font-size": "21.6px",
			  "font-weight": "500",
			}
		`)
		expect(pick(root.querySelector("h3"), ["font-size", "font-weight"])).toMatchInlineSnapshot(`
			{
			  "font-size": "19.2px",
			  "font-weight": "500",
			}
		`)
		expect(css(root.querySelector("strong"), "font-weight")).toMatchInlineSnapshot(`"600"`)
	})

	it("lists: indented, bullet and numbering styles by depth", () => {
		const root = renderMarkdown()
		const ul = root.querySelector("ul")
		expect(pick(ul, ["padding-left", "margin-left", "list-style-type"])).toMatchInlineSnapshot(`
			{
			  "list-style-type": "disc",
			  "margin-left": "0px",
			  "padding-left": "32px",
			}
		`)
		expect(pick(root.querySelector("li"), ["margin", "line-height"])).toMatchInlineSnapshot(`
			{
			  "line-height": "21.6px",
			  "margin": "8px 0px",
			}
		`)
		const ols = root.querySelectorAll("ol")
		expect(css(ols[0], "list-style-type")).toMatchInlineSnapshot(`"decimal"`)
		expect(css(ols[1], "list-style-type")).toMatchInlineSnapshot(`"lower-alpha"`)
		expect(css(ols[2], "list-style-type")).toMatchInlineSnapshot(`"lower-roman"`)
	})

	it("inline code and links", () => {
		const root = renderMarkdown()
		const code = root.querySelector("p code")
		expect(
			pick(code, ["font-family", "font-size", "padding", "white-space", "word-break", "overflow-wrap", "color"]),
		).toMatchInlineSnapshot(`
			{
			  "color": "var(--vscode-textPreformat-foreground)",
			  "font-family": "var(--vscode-editor-font-family,monospace)",
			  "font-size": "13.6px",
			  "overflow-wrap": "anywhere",
			  "padding": "1px 2px",
			  "white-space": "pre-line",
			  "word-break": "break-word",
			}
		`)
		expect(getComputedStyle(code!).getPropertyPriority("color")).toBe("important")
		expect(pick(root.querySelector("a"), ["color", "text-decoration"])).toMatchInlineSnapshot(`
			{
			  "color": "var(--vscode-textLink-foreground)",
			  "text-decoration": "none",
			}
		`)
	})

	it("tables: collapsed borders, scroll wrapper, zebra rows", () => {
		const root = renderMarkdown()
		expect(pick(root.querySelector(".table-wrapper"), ["overflow-x", "margin"])).toMatchInlineSnapshot(`
			{
			  "margin": "16px 0px",
			  "overflow-x": "auto",
			}
		`)
		expect(pick(root.querySelector("table"), ["border-collapse", "min-width", "max-width", "table-layout"]))
			.toMatchInlineSnapshot(`
			{
			  "border-collapse": "collapse",
			  "max-width": "100%",
			  "min-width": "50%",
			  "table-layout": "fixed",
			}
		`)
		expect(pick(root.querySelector("th"), ["padding", "text-align", "font-weight", "background-color"]))
			.toMatchInlineSnapshot(`
			{
			  "background-color": "var(--vscode-editor-background)",
			  "font-weight": "600",
			  "padding": "8px 12px",
			  "text-align": "left",
			}
		`)
		expect(css(root.querySelector("td"), "padding")).toMatchInlineSnapshot(`"8px 12px"`)
		const bodyRows = root.querySelectorAll("tbody tr")
		expect(css(bodyRows[1], "background-color")).toMatchInlineSnapshot(
			`"var(--vscode-editor-inactiveSelectionBackground)"`,
		)
	})

	it("alerts: accent border and flex title", () => {
		const root = renderMarkdown()
		const alert = root.querySelector(".markdown-alert")
		expect(pick(alert, ["margin", "padding", "border-radius", "background-color"])).toMatchInlineSnapshot(`
			{
			  "background-color": "var(--vscode-textBlockQuote-background)",
			  "border-radius": "0px",
			  "margin": "16px 0px",
			  "padding": "8px 16px",
			}
		`)
		expect(css(root.querySelector(".markdown-alert-note"), "--alert-accent")).toMatchInlineSnapshot(
			`"var(--vscode-charts-blue,var(--vscode-textLink-foreground))"`,
		)
		expect(pick(root.querySelector(".markdown-alert-title"), ["display", "font-weight", "color"]))
			.toMatchInlineSnapshot(`
				{
				  "color": "var(--alert-accent,var(--vscode-foreground))",
				  "display": "flex",
				  "font-weight": "600",
				}
			`)
	})
})

describe("MermaidBlock styles", () => {
	it("container margin, loading text and dimmed diagram while loading", async () => {
		let resolve!: (value: { svg: string }) => void
		mermaidRender.result = new Promise((r) => (resolve = r))
		const { container } = render(<MermaidBlock code={"graph TD\n  A --> B"} />)
		const root = container.firstElementChild as HTMLElement
		expect(pick(root, ["position", "margin"])).toMatchInlineSnapshot(`
			{
			  "margin": "8px 0px",
			  "position": "relative",
			}
		`)

		const loading = screen.getByText("common:mermaid.loading")
		expect(pick(loading, ["padding", "font-style", "font-size", "color"])).toMatchInlineSnapshot(`
			{
			  "color": "var(--vscode-descriptionForeground)",
			  "font-size": "14.4px",
			  "font-style": "italic",
			  "padding": "8px 0px",
			}
		`)

		// MermaidButton wraps the diagram host in a `relative w-full` div.
		const host = () => root.querySelector(".relative.w-full")?.firstElementChild as HTMLElement
		expect(pick(host(), ["opacity", "transition"])).toMatchInlineSnapshot(`
			{
			  "opacity": "0.3",
			  "transition": "opacity 0.2s ease",
			}
		`)

		resolve({ svg: '<svg data-testid="mermaid-svg"></svg>' })
		await screen.findByTestId("mermaid-svg")
		// The SVG is written to the DOM before setIsLoading(false) re-renders; wait for that render too.
		await waitFor(() => expect(screen.queryByText("common:mermaid.loading")).toBeNull())
		mermaidRender.result = undefined
		expect(pick(host(), ["display", "justify-content", "max-height", "min-height", "cursor", "opacity"]))
			.toMatchInlineSnapshot(`
			{
			  "cursor": "pointer",
			  "display": "flex",
			  "justify-content": "center",
			  "max-height": "400px",
			  "min-height": "20px",
			  "opacity": "1",
			}
		`)
		expect(pick(root.querySelector("svg"), ["display", "width", "max-height"])).toMatchInlineSnapshot(`
			{
			  "display": "block",
			  "max-height": "100%",
			  "width": "100%",
			}
		`)
	})

	it("error state: copy button is a 24px transparent flex button", async () => {
		const { container } = render(<MermaidBlock code={"graph TD\n  A -->"} />)
		await waitFor(() => expect(container.querySelector(".codicon-warning")).not.toBeNull(), { timeout: 5000 })
		const copyButton = container.querySelector(".codicon-copy")?.closest("button")
		expect(pick(copyButton, ["height", "padding", "margin-right", "display", "cursor", "color"]))
			.toMatchInlineSnapshot(`
			{
			  "color": "var(--vscode-editor-foreground)",
			  "cursor": "pointer",
			  "display": "flex",
			  "height": "24px",
			  "margin-right": "4px",
			  "padding": "3px",
			}
		`)
	})
})

describe("settings StyledMarkdown (model descriptions)", () => {
	it("small description text with compact lists", () => {
		const { container } = render(
			<ModelDescriptionMarkdown
				markdown={"Para\n\n- a\n  - b\n    - c\n\n1. x\n   1. y\n      1. z\n\n[l](https://x.y)"}
				key="k"
				isExpanded
				setIsExpanded={() => {}}
			/>,
		)
		const root = container.querySelector("p")!.parentElement as HTMLElement
		expect(css(root, "font-family")).toMatchInlineSnapshot(
			`"var(--vscode-font-family),system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,Cantarell,"Open Sans","Helvetica Neue",sans-serif"`,
		)
		expect(pick(root, ["font-size", "color"])).toMatchInlineSnapshot(`
			{
			  "color": "var(--vscode-descriptionForeground)",
			  "font-size": "12px",
			}
		`)
		expect(pick(root.querySelector("p"), ["white-space", "line-height", "margin"])).toMatchInlineSnapshot(`
			{
			  "line-height": "1.25",
			  "margin": "0px",
			  "white-space": "pre-wrap",
			}
		`)
		const uls = root.querySelectorAll("ul")
		expect(pick(uls[0], ["padding-left", "list-style-type"])).toMatchInlineSnapshot(`
			{
			  "list-style-type": "disc",
			  "padding-left": "18px",
			}
		`)
		expect(css(uls[1], "list-style-type")).toMatchInlineSnapshot(`"circle"`)
		expect(css(uls[2], "list-style-type")).toMatchInlineSnapshot(`"square"`)
		const ols = root.querySelectorAll("ol")
		expect(css(ols[0], "list-style-type")).toMatchInlineSnapshot(`"decimal"`)
		expect(css(ols[1], "list-style-type")).toMatchInlineSnapshot(`"lower-alpha"`)
		expect(css(ols[2], "list-style-type")).toMatchInlineSnapshot(`"lower-roman"`)
		expect(css(root.querySelector("a"), "text-decoration")).toMatchInlineSnapshot(`"none"`)
	})
})
