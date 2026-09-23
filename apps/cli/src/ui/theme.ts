/**
 * Theme configuration for Tumble Code CLI TUI.
 *
 * Semantic theme (Claude Code naming) built on the Hardcore color scheme.
 * This is the canonical source of truth — all UI code accesses colors
 * through the `theme` object via `import * as theme from "../theme.js"`
 * and `theme.brand`, `theme.text`, etc.
 *
 * See ai_plans/2026-08-05_cli-claude-code-style-ui-redesign.md (§4).
 */

export const theme = {
	brand: "#FD971F", // orange: welcome ✻, spinner verb/frames, ❯ in user rows
	text: "#F8F8F2",
	secondaryText: "#A3BABF", // descriptions, dialog and panel text
	// Tool results and "∴ Thinking", the rows the eye should skip. Already dark
	// on its own, never paired with dimColor: VTE (GNOME Terminal, Ptyxis) dims
	// only palette colours and draws an RGB colour at full strength, so
	// `dimColor` + a hex colour was not dim there at all (vte.cc, "Handle dim
	// colors"). Terminals that do dim RGB would darken it twice.
	faint: "#6D7C7F",
	subtle: "#5E7175", // separators, empty gauge cells
	inactive: "#505354", // placeholder, disabled
	permission: "#9E6FFE", // dialog borders, select pointer/focus
	promptBorder: "#5E7175", // input rules + prompt ❯
	userMessageBg: "#2F3E5A", // user-turn band; slate blue, so it stands out on grey and aubergine backgrounds alike
	bashBorder: "#F92672", // reserved: `!` bash-style accents
	success: "#A6E22E", // resolved tool bullets, success toasts
	error: "#F92672",
	warning: "#E6DB74",
	suggestion: "#66D9EF", // autocomplete matches, links
	planMode: "#66D9EF",
	diffAdded: "#225C2B", // bg for added lines (from Claude dark)
	diffRemoved: "#7A2936",
	diffAddedDimmed: "#47584A",
	diffRemovedDimmed: "#69474D",
	code: "#E6DB74", // inline code spans
} as const

export type Theme = typeof theme

// --- Semantic flat re-exports -------------------------------------------------
// `import * as theme from "../theme.js"` only resolves top-level exports, so
// every semantic key is also exported flat. New code should access colors
// through the `theme` object via the namespace import (e.g. `theme.brand`).

export const brand = theme.brand
export const text = theme.text
export const secondaryText = theme.secondaryText
export const faint = theme.faint
export const subtle = theme.subtle
export const inactive = theme.inactive
export const permission = theme.permission
export const promptBorder = theme.promptBorder
export const userMessageBg = theme.userMessageBg
export const bashBorder = theme.bashBorder
export const success = theme.success
export const error = theme.error
export const warning = theme.warning
export const suggestion = theme.suggestion
export const planMode = theme.planMode
export const diffAdded = theme.diffAdded
export const diffRemoved = theme.diffRemoved
export const diffAddedDimmed = theme.diffAddedDimmed
export const diffRemovedDimmed = theme.diffRemovedDimmed
export const code = theme.code
