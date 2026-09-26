// Golden renders of MarkdownBlock: fixed markdown inputs, each pinned as the
// rendered innerHTML.
//
// These pin what the markdown pipeline (react-markdown with remark-gfm,
// remark-math, our alert plugin, rehype-katex and KaTeX) produces, so a
// dependency bump of any of them shows its visible effect as a diff to review.
// Code blocks and Mermaid diagrams are stubs that print the props they
// receive (their own rendering has its own specs); KaTeX is real.
//
// The expected HTML lives in __golden__/MarkdownBlock.golden.json.
// Regenerate it with UPDATE_GOLDEN=1 and review the diff before committing.

import fs from "fs"
import path from "path"
import { render, waitFor } from "@/utils/test-utils"

import MarkdownBlock from "../MarkdownBlock"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("../CodeBlock", () => ({
	default: (props: { source?: string; language?: string }) => (
		<pre data-stub="CodeBlock" data-language={props.language}>
			{props.source}
		</pre>
	),
}))

vi.mock("../MermaidBlock", () => ({
	default: (props: { code: string }) => <div data-stub="MermaidBlock">{props.code}</div>,
}))

const CASES: Array<{ name: string; markdown: string }> = [
	{
		name: "paragraphs and emphasis",
		markdown: "Some **bold**, *italic*, ***both*** and `inline code`.\n\nSecond paragraph\nwith a soft break.",
	},
	{ name: "headings", markdown: "# One\n\n## Two\n\n### Three\n\n#### Four" },
	{ name: "lists", markdown: "- a\n- b\n  - nested\n\n1. first\n2. second\n   1. inner" },
	{ name: "task list", markdown: "- [ ] open\n- [x] done" },
	{ name: "table", markdown: "| a | b |\n|:--|--:|\n| 1 | 2 |\n| x | `y` |" },
	{ name: "strikethrough double and single tilde", markdown: "~~gone~~ but 1~3 and ~10 stay" },
	{
		name: "autolink and links",
		markdown: 'See https://example.com. and [docs](https://docs.example.com "Docs") and [file](src/a.ts:12)',
	},
	{ name: "raw html is escaped", markdown: "<b>not bold</b> <script>alert(1)</script>" },
	{ name: "blockquote", markdown: "> quoted\n> text" },
	{ name: "github alert", markdown: "> [!WARNING]\n> Be **careful** with `rm`." },
	{ name: "fenced code with language", markdown: "```typescript\nconst a: number = 1\n```" },
	{ name: "fenced code without language", markdown: "```\nplain\n```" },
	{ name: "fenced code with file name", markdown: "```src/app.tsx\n<App />\n```" },
	{ name: "mermaid block", markdown: "```mermaid\ngraph TD; A-->B\n```" },
	{ name: "footnote", markdown: "Text with a note[^1].\n\n[^1]: The note." },
	{ name: "images", markdown: "![alt text](https://example.com/a.png)" },
	{ name: "horizontal rule", markdown: "above\n\n---\n\nbelow" },
	{ name: "inline math", markdown: "Euler: $e^{i\\pi}+1=0$ and $x_1^2$." },
	{ name: "display math", markdown: "$$\n\\frac{a}{b} = \\sqrt{c^2}\n$$" },
	{
		name: "math environments",
		markdown: "$$\n\\begin{aligned} x &= 1 \\\\ y &= \\sum_{i=0}^{n} i \\end{aligned}\n$$",
	},
	{ name: "math with an unknown command", markdown: "Bad: $\\notacommand{x}$" },
	{ name: "dollar amounts", markdown: "It costs $5 and $10 today." },
	{
		name: "link protocols",
		markdown:
			"[js](javascript:alert(1)) [data](data:text/html,x) [vscode](vscode://file/a) [file](file:///tmp/a.ts) [mail](mailto:a@b.c) [rel](./a.md#top)",
	},
	{ name: "hard line break and entities", markdown: "line one  \nline two &amp; &copy; &#x41; &nbsp;end" },
	{ name: "table with inline markup", markdown: "| **k** | v |\n|---|---|\n| `c` | [l](https://x.y) ~~s~~ |" },
	{
		name: "angle bracket autolink and reference link",
		markdown: '<https://a.b/c> and [ref][r]\n\n[r]: https://r.example "R"',
	},
]

// styled-components names its classes after a per-process counter.
const normalize = (html: string) => html.replace(/\bsc-[A-Za-z0-9]+ [A-Za-z0-9]+\b/g, "sc-styled")

const GOLDEN_FILE = path.join(__dirname, "__golden__", "MarkdownBlock.golden.json")
const UPDATE = process.env.UPDATE_GOLDEN === "1"
const golden: Record<string, string> = fs.existsSync(GOLDEN_FILE)
	? JSON.parse(fs.readFileSync(GOLDEN_FILE, "utf8"))
	: {}
const actual: Record<string, string> = {}

describe("MarkdownBlock golden renders", () => {
	beforeAll(async () => {
		// KaTeX loads on the first markdown with "$"; load it once so every
		// case below renders synchronously with math.
		const { container, unmount } = render(<MarkdownBlock markdown="$x$" />)
		await waitFor(() => expect(container.querySelector(".katex")).not.toBeNull())
		unmount()
	})

	afterAll(() => {
		if (UPDATE) {
			fs.mkdirSync(path.dirname(GOLDEN_FILE), { recursive: true })
			fs.writeFileSync(GOLDEN_FILE, JSON.stringify(actual, null, "\t") + "\n")
		}
	})

	it("has a unique name for every case", () => {
		expect(new Set(CASES.map((c) => c.name)).size).toBe(CASES.length)
	})

	it.each(CASES.map((c) => [c.name, c.markdown] as const))("%s", (name, markdown) => {
		const { container, unmount } = render(<MarkdownBlock markdown={markdown} />)
		const html = normalize(container.innerHTML)
		unmount()
		actual[name] = html
		if (!UPDATE) expect(html).toBe(golden[name])
	})
})
