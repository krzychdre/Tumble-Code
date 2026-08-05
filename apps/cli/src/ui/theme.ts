/**
 * Theme configuration for Tumble Code CLI TUI
 * Semantic theme (Claude Code naming) built on the Hardcore color scheme,
 * plus deprecated flat aliases for backward compatibility.
 *
 * The aliases exist so existing consumers compile during the staged UI
 * redesign; they are removed once every consumer is rewritten
 * (see ai_plans/2026-08-05_cli-claude-code-style-ui-redesign.md, WP-D).
 */

// Semantic theme — canonical source of truth; all new UI code uses this.
export const theme = {
	brand: "#FD971F", // orange — welcome ✻, spinner verb/frames
	text: "#F8F8F2",
	secondaryText: "#A3BABF", // tool results, descriptions
	subtle: "#5E7175", // ❯ in user rows, ⎿ connectors
	inactive: "#505354", // placeholder, disabled
	permission: "#9E6FFE", // dialog borders, select pointer/focus
	promptBorder: "#5E7175", // input rules + prompt ❯
	userMessageBg: "#383a3e", // user-turn background band
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

// --- Deprecated legacy aliases -------------------------------------------------
// Each alias maps an old flat export name onto its semantic replacement so that
// `import * as theme from "../theme.js"` keeps working. To be deleted in WP-D.
// Note: `import * as theme` only sees top-level exports, so the aliases must be
// top-level names — that is also why the semantic keys are re-exported flat
// below (new components access `theme.brand` etc. through the namespace).

// Title and branding colors
export const titleColor = theme.brand // was orange
export const welcomeText = theme.text
export const asciiColor = theme.suggestion // was cyan

// Tips section colors
export const tipsHeader = theme.brand // was orange
export const tipsText = theme.secondaryText

// Header text colors (for messages)
export const userHeader = theme.permission // was purple
export const rooHeader = theme.brand // was yellow
export const toolHeader = theme.suggestion // was cyan
export const thinkingHeader = theme.subtle // was overlay1

// Message text colors
export const userText = theme.text
export const rooText = theme.text
export const toolText = theme.secondaryText
export const thinkingText = theme.subtle // was overlay2

// UI element colors
export const borderColor = theme.promptBorder // was surface1
export const borderColorActive = theme.permission // was purple
export const dimText = theme.subtle // was overlay1
export const promptColor = theme.subtle // was overlay2
export const promptColorActive = theme.suggestion // was cyan
export const placeholderColor = theme.inactive // was overlay0

// Status colors
export const successColor = theme.success
export const errorColor = theme.error
export const warningColor = theme.warning

// Focus indicator colors
export const focusColor = theme.suggestion // was cyan
export const scrollActiveColor = theme.permission // was purple
export const scrollTrackColor = theme.promptBorder // was surface1

// Base text color
export const text = theme.text

// --- Semantic flat re-exports -------------------------------------------------
// New components access semantic keys through the namespace
// (`import * as theme from "../theme.js"`), which only resolves top-level
// exports, so every semantic key is also exported flat. New code should
// prefer the `theme` object via named import once the aliases are removed.

export const brand = theme.brand
export const secondaryText = theme.secondaryText
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
