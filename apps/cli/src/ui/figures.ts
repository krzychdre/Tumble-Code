/**
 * Terminal glyphs and spinner frames for the Tumble Code CLI TUI.
 * Platform-dependent glyphs are resolved once at module load.
 */

const isMac = process.platform === "darwin"

export const figures = {
	bullet: isMac ? "⏺" : "●", // message/tool bullets
	elbow: "⎿", // result connector
	pointer: "❯", // prompt, select cursor
	welcome: "✻",
	therefore: "∴", // thinking
	checkboxOn: "☒",
	checkboxOff: "☐",
	arrowDown: "↓",
	arrowUp: "↑",
	ellipsis: "…",
	blockquote: "▎",
	dot: "·",
} as const

export const SPINNER_FRAMES = ["·", "✢", "✳", "∗", "✻", "✽", "∗", "✳", "✢"]
