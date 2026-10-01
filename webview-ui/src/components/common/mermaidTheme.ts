import type { MermaidConfig } from "mermaid"

// VS Code marks the webview body with one of these classes and swaps it when
// the user changes the colour theme.
export type VscodeThemeKind = "dark" | "light" | "high-contrast" | "high-contrast-light"

export function themeKindFromBodyClass(className: string): VscodeThemeKind {
	if (/\bvscode-high-contrast-light\b/i.test(className)) return "high-contrast-light"
	if (/\bvscode-high-contrast\b/i.test(className)) return "high-contrast"
	if (/\bvscode-light\b/i.test(className)) return "light"
	return "dark"
}

const isLightKind = (kind: VscodeThemeKind) => kind === "light" || kind === "high-contrast-light"

// Colours read from the active VS Code theme (`--vscode-*` CSS variables).
export interface EditorColors {
	background?: string
	foreground?: string
	contrastBorder?: string
}

// Mermaid derives shades from its theme variables with khroma, which needs real
// colour values (a `var(...)` reference would break it), so only plain hex
// colours from the theme are used and anything else falls back to the palette.
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

const asHexColour = (value: string | undefined) => {
	const trimmed = value?.trim()
	return trimmed && HEX_COLOUR.test(trimmed) ? trimmed : undefined
}

// Node, line and note colours for the classic look, one palette per theme
// brightness. The dark one was tuned against VS Code's Dark Modern theme.
const DARK_PALETTE = {
	background: "#1e1e1e",
	text: "#ffffff",
	nodeBkg: "#2d2d2d",
	primary: "#3c3c3c",
	tertiary: "#454545",
	border: "#888888",
	line: "#cccccc",
	noteBkg: "#454545",
	critBorder: "#ff9580",
	critBkg: "#803d36",
	link: "#6cb6ff",
}

const LIGHT_PALETTE: typeof DARK_PALETTE = {
	background: "#ffffff",
	text: "#1f1f1f",
	nodeBkg: "#f3f3f3",
	primary: "#e4e4e4",
	tertiary: "#d6d6d6",
	border: "#6f6f6f",
	line: "#444444",
	noteBkg: "#fff4c2",
	critBorder: "#c62828",
	critBkg: "#ffd7d2",
	link: "#005fb8",
}

// Mermaid 12 lays out flowchart, state, class, ER and requirement diagrams
// with ELK and draws them in the "neo" look with 120px minimum node and
// wrapping widths by default. The palettes above were tuned for Mermaid 11's
// classic look, so these keep the 11 layout and sizes. The layout is set per
// diagram type, not globally, because a global layout would also override the
// diagrams that pick their own (mindmap's cose-bilkent, swimlane).
const DAGRE = { layout: "dagre" }
const CLASSIC_NODE_SIZES = { minNodeWidth: 0, wrappingWidth: 200 }

// The canvas behind a diagram, also used to fill the exported PNG: the editor
// background of the active theme.
export function diagramBackground(kind: VscodeThemeKind, colors: EditorColors = {}): string {
	return asHexColour(colors.background) ?? (isLightKind(kind) ? LIGHT_PALETTE : DARK_PALETTE).background
}

export function buildMermaidConfig(kind: VscodeThemeKind, colors: EditorColors = {}): MermaidConfig {
	const light = isLightKind(kind)
	const highContrast = kind === "high-contrast" || kind === "high-contrast-light"
	const base = light ? LIGHT_PALETTE : DARK_PALETTE
	const background = diagramBackground(kind, colors)
	// High contrast themes outline everything in one strong colour.
	const strong = highContrast
		? (asHexColour(colors.contrastBorder) ?? asHexColour(colors.foreground) ?? base.text)
		: undefined
	const p = { ...base, background, border: strong ?? base.border, line: strong ?? base.line }

	return {
		startOnLoad: false,
		securityLevel: "loose",
		theme: light ? "default" : "dark",
		look: "classic",
		flowchart: { ...DAGRE, ...CLASSIC_NODE_SIZES },
		state: { ...DAGRE, ...CLASSIC_NODE_SIZES },
		class: DAGRE,
		er: DAGRE,
		requirement: DAGRE,
		suppressErrorRendering: true,
		themeVariables: {
			darkMode: !light,
			background: p.background,
			textColor: p.text,
			mainBkg: p.nodeBkg,
			nodeBorder: p.border,
			lineColor: p.line,
			primaryColor: p.primary,
			primaryTextColor: p.text,
			primaryBorderColor: p.border,
			secondaryColor: p.nodeBkg,
			tertiaryColor: p.tertiary,

			// Class diagram specific
			classText: p.text,

			// State diagram specific
			labelColor: p.text,

			// Sequence diagram specific
			actorLineColor: p.line,
			actorBkg: p.nodeBkg,
			actorBorder: p.border,
			actorTextColor: p.text,

			// Flow diagram specific
			fillType0: p.nodeBkg,
			fillType1: p.primary,
			fillType2: p.tertiary,

			fontSize: "16px",
			fontFamily: "var(--vscode-font-family, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif)",

			noteTextColor: p.text,
			noteBkgColor: p.noteBkg,
			noteBorderColor: p.border,

			critBorderColor: p.critBorder,
			critBkgColor: p.critBkg,

			// Task diagram specific
			taskTextColor: p.text,
			taskTextOutsideColor: p.text,
			taskTextLightColor: p.text,

			// Numbers/sections
			sectionBkgColor: p.nodeBkg,
			sectionBkgColor2: p.primary,

			// Alt sections in sequence diagrams
			altBackground: p.nodeBkg,

			linkColor: p.link,

			compositeBackground: p.nodeBkg,
			compositeBorder: p.border,
			titleColor: p.text,
		},
	}
}

// Reads the active theme from the webview document at render time.
export function readVscodeTheme(): { kind: VscodeThemeKind; colors: EditorColors } {
	const style = getComputedStyle(document.documentElement)
	return {
		kind: themeKindFromBodyClass(document.body.className),
		colors: {
			background: style.getPropertyValue("--vscode-editor-background"),
			foreground: style.getPropertyValue("--vscode-editor-foreground"),
			contrastBorder: style.getPropertyValue("--vscode-contrastBorder"),
		},
	}
}
