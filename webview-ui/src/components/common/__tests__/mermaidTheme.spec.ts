import { buildMermaidConfig, diagramBackground, themeKindFromBodyClass } from "../mermaidTheme"

describe("themeKindFromBodyClass", () => {
	it.each([
		["vscode-dark", "dark"],
		["vscode-light", "light"],
		["vscode-high-contrast", "high-contrast"],
		["vscode-high-contrast-light", "high-contrast-light"],
		["vscode-high-contrast vscode-high-contrast-light", "high-contrast-light"],
		["", "dark"],
		["something-light", "dark"],
	] as const)("%j is %s", (className, kind) => {
		expect(themeKindFromBodyClass(className)).toBe(kind)
	})
})

describe("buildMermaidConfig", () => {
	it("uses Mermaid's dark theme with light text in dark themes", () => {
		const config = buildMermaidConfig("dark")
		expect(config.theme).toBe("dark")
		expect(config.themeVariables).toMatchObject({ background: "#1e1e1e", textColor: "#ffffff", darkMode: true })
	})

	// A light VS Code theme used to get the dark palette: a black box with white text.
	it("uses Mermaid's default theme with dark text in light themes", () => {
		for (const kind of ["light", "high-contrast-light"] as const) {
			const config = buildMermaidConfig(kind)
			expect(config.theme).toBe("default")
			expect(config.themeVariables).toMatchObject({
				background: "#ffffff",
				textColor: "#1f1f1f",
				darkMode: false,
			})
		}
	})

	it("draws on the editor background of the active theme", () => {
		expect(buildMermaidConfig("light", { background: " #f5f5dc " }).themeVariables?.background).toBe("#f5f5dc")
		expect(buildMermaidConfig("dark", { background: "#002b36" }).themeVariables?.background).toBe("#002b36")
	})

	it("ignores theme values Mermaid cannot derive colours from", () => {
		for (const background of ["", "var(--x)", "rgba(0, 0, 0, 0.5)", "#12345"]) {
			expect(buildMermaidConfig("dark", { background }).themeVariables?.background).toBe("#1e1e1e")
		}
	})

	it("outlines nodes and lines with the contrast border in high contrast themes", () => {
		const vars = buildMermaidConfig("high-contrast", {
			contrastBorder: "#6fc3df",
			foreground: "#ffffff",
		}).themeVariables
		expect(vars).toMatchObject({ nodeBorder: "#6fc3df", lineColor: "#6fc3df", actorBorder: "#6fc3df" })

		const fallback = buildMermaidConfig("high-contrast-light", { foreground: "#000000" }).themeVariables
		expect(fallback).toMatchObject({ nodeBorder: "#000000", lineColor: "#000000" })
	})

	it("keeps the classic dagre look in every theme", () => {
		for (const kind of ["dark", "light", "high-contrast", "high-contrast-light"] as const) {
			expect(buildMermaidConfig(kind)).toMatchObject({
				look: "classic",
				flowchart: { layout: "dagre", minNodeWidth: 0, wrappingWidth: 200 },
			})
		}
	})
})

describe("diagramBackground", () => {
	it("is the editor background, or the palette background when the theme gives none", () => {
		expect(diagramBackground("light", { background: "#fffffe" })).toBe("#fffffe")
		expect(diagramBackground("light")).toBe("#ffffff")
		expect(diagramBackground("dark")).toBe("#1e1e1e")
	})
})
