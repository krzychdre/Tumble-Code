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

/**
 * Droplet-into-puddle animation, played as a forward cycle: the drop falls
 * (˙ · .), hits (∘), the ripple grows (○) and fades (◦), then the next drop
 * appears. Every glyph is string-width 1 — the previous star set mixed
 * widths (✳ U+2733 is East-Asian Wide since Unicode 9, the rest narrow),
 * so ink reserved 2 columns for some frames and 1 for others, making the
 * gap to the verb jitter between frames.
 */
export const SPINNER_FRAMES = ["˙", "·", ".", "∘", "○", "◦"]
