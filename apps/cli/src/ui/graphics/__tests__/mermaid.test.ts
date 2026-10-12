import { renderMermaidImage, renderMermaidText, resolveSvgColors } from "../mermaid.js"

const DIAGRAMS = {
	flowchart: "graph LR\n A[Start] --> B{Ok?}\n B -->|yes| C[Zażółć gęślą]\n subgraph G [Group]\n C --> D\n end",
	sequence: "sequenceDiagram\n participant A\n A->>B: hi\n Note over A,B: note\n B-->>A: back",
	state: "stateDiagram-v2\n [*] --> S1\n S1 --> S2: go\n S2 --> [*]",
	class: "classDiagram\n class Animal {\n +String name\n +eat()\n }\n Animal <|-- Dog",
	er: "erDiagram\n CUSTOMER ||--o{ ORDER : places\n CUSTOMER {\n string name\n }",
	xychart: 'xychart-beta\n title "Sales"\n x-axis [jan, feb, mar]\n y-axis "Rev" 0 --> 100\n bar [10, 50, 90]',
}

describe("resolveSvgColors", () => {
	it("follows var() through definitions and fallbacks", () => {
		const svg =
			'<svg style="--bg:#000000;--fg:#ffffff"><style>svg { --_text: var(--fg); --_line: var(--line, #123456); }' +
			'</style><text fill="var(--_text)"/><path stroke="var(--_line)"/></svg>'

		const out = resolveSvgColors(svg)

		expect(out).toContain('fill="#ffffff"')
		expect(out).toContain('stroke="#123456"')
	})

	it("mixes color-mix() with one or two percentages", () => {
		const svg =
			'<svg style="--bg:#000000;--fg:#ffffff"><style>svg { --a: color-mix(in srgb, var(--fg) 25%, var(--bg));' +
			" --b: color-mix(in srgb, var(--bg) 75%, #ff0000 25%); }</style>" +
			'<rect fill="var(--a)"/><rect fill="var(--b)"/></svg>'

		const out = resolveSvgColors(svg)

		expect(out).toContain('fill="#404040"')
		expect(out).toContain('fill="#400000"')
	})

	it("leaves a reference it cannot resolve, survives a cycle and drops the font import", () => {
		const svg =
			"<svg><style>@import url('https://fonts.example/x');\nsvg { --a: var(--b); --b: var(--a); }</style>" +
			'<rect fill="var(--a)"/><rect fill="var(--missing)"/></svg>'

		const out = resolveSvgColors(svg)

		expect(out).not.toContain("@import")
		expect(out).toContain('fill="var(--missing)"')
	})
})

describe("renderMermaidImage", () => {
	it.each(Object.entries(DIAGRAMS))("draws a %s with plain colours only", (_kind, source) => {
		const image = renderMermaidImage(source, "#1e1e1e")

		expect(image?.size.width).toBeGreaterThan(0)
		expect(image?.size.height).toBeGreaterThan(0)
		expect(image?.svg).not.toMatch(/var\(|color-mix\(/)
	})

	it("uses light text on a dark background and dark text on a light one", () => {
		expect(renderMermaidImage(DIAGRAMS.flowchart, "#000000")?.svg).toContain("#F8F8F2")
		expect(renderMermaidImage(DIAGRAMS.flowchart, "#ffffff")?.svg).toContain("#27272A")
	})

	it("returns undefined for a kind it does not know", () => {
		expect(renderMermaidImage('pie title Pets\n "Dogs": 3', "#000000")).toBeUndefined()
	})
})

describe("renderMermaidText", () => {
	it("draws the diagram in box-drawing characters without trailing spaces", () => {
		const text = renderMermaidText(DIAGRAMS.state, 80)

		expect(text).toContain("S1")
		expect(text).toMatch(/[│─]/)
		expect(text).not.toMatch(/ +$/m)
	})

	it("returns undefined when the diagram is wider than the columns or does not parse", () => {
		expect(renderMermaidText(DIAGRAMS.flowchart, 20)).toBeUndefined()
		expect(renderMermaidText('pie title Pets\n "Dogs": 3', 80)).toBeUndefined()
	})
})
