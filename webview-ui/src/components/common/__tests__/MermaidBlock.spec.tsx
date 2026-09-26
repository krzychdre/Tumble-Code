import { fireEvent, render, screen } from "@/utils/test-utils"

import MermaidBlock from "../MermaidBlock"

// The real Mermaid parses and is configured here; only render() is replaced,
// because jsdom cannot measure text (getBBox) and every layout needs it.
const { calls } = vi.hoisted(() => ({
	calls: { initialize: [] as unknown[], render: [] as string[] },
}))

vi.mock("mermaid", async (importOriginal) => {
	const real = (await importOriginal<typeof import("mermaid")>()).default
	return {
		default: {
			...real,
			parse: real.parse.bind(real),
			initialize: (config: unknown) => {
				calls.initialize.push(config)
				real.initialize(config as Parameters<typeof real.initialize>[0])
			},
			render: async (_id: string, code: string) => {
				calls.render.push(code)
				return { svg: '<svg data-testid="mermaid-svg"></svg>' }
			},
		},
	}
})

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

// Mermaid's message for a flowchart edge without a target, as the user sees it.
const PARSE_ERROR = [
	"Parse error on line 3:",
	"graph TD  A -->",
	"---------------^",
	"Expecting 'AMP', 'COLON', 'PIPE', 'TESTSTR', 'DOWN', 'DEFAULT', 'NUM', 'COMMA', 'NODE_STRING', 'BRKT', 'MINUS', 'MULT', 'UNICODE_TEXT', got 'EOF'",
].join("\n")

describe("MermaidBlock with the real Mermaid parser", () => {
	beforeAll(() => {
		vi.spyOn(console, "warn").mockImplementation(() => {})
	})

	it("renders a valid diagram", async () => {
		render(<MermaidBlock code={"graph TD\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]"} />)

		expect(await screen.findByTestId("mermaid-svg", {}, { timeout: 5000 })).toBeInTheDocument()
		expect(calls.render).toHaveLength(1)
	})

	// Mermaid 12 changed its defaults to the ELK layout, the "neo" look and
	// 120px minimum node widths, which re-lays out and restyles every
	// flowchart, class and state diagram. Our dark palette was tuned for the
	// classic dagre look, so Mermaid 11's values are requested explicitly.
	it("configures Mermaid once with the classic dagre look, Mermaid 11 node sizes and the dark theme", () => {
		expect(calls.initialize).toHaveLength(1)
		expect(calls.initialize[0]).toMatchObject({
			startOnLoad: false,
			securityLevel: "loose",
			theme: "dark",
			suppressErrorRendering: true,
			look: "classic",
			flowchart: { layout: "dagre", minNodeWidth: 0, wrappingWidth: 200 },
			state: { layout: "dagre", minNodeWidth: 0, wrappingWidth: 200 },
			class: { layout: "dagre" },
			er: { layout: "dagre" },
			requirement: { layout: "dagre" },
		})
		// A global layout would override mindmap's cose-bilkent and swimlane's own layout.
		expect(calls.initialize[0]).not.toHaveProperty("layout")
	})

	it("shows Mermaid's parse error for invalid syntax and renders nothing", async () => {
		render(<MermaidBlock code={"graph TD\n  A -->"} />)

		fireEvent.click(await screen.findByText("common:mermaid.render_error", {}, { timeout: 5000 }))
		// The expanded panel shows Mermaid's own message above the source.
		expect(document.body.textContent).toContain(PARSE_ERROR)
		expect(calls.render).toHaveLength(1)
		expect(screen.queryByTestId("mermaid-svg")).toBeNull()
	})

	it("rejects an unknown diagram type", async () => {
		render(<MermaidBlock code={"notADiagram\n  x"} />)

		expect(await screen.findByText("common:mermaid.render_error", {}, { timeout: 5000 })).toBeInTheDocument()
		expect(calls.render).toHaveLength(1)
	})
})
