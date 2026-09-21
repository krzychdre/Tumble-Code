/**
 * Whimsical gerund list for the loading spinner, in Claude Code's register.
 * The verb is picked deterministically from the seed (loading-start timestamp)
 * so a single turn keeps one stable verb — no Math.random.
 */

export const SPINNER_VERBS = [
	"Tumbling",
	"Pondering",
	"Rummaging",
	"Brewing",
	"Combobulating",
	"Percolating",
	"Cogitating",
	"Marinating",
	"Actualizing",
	"Untangling",
	"Summoning",
	"Conjuring",
	"Materializing",
	"Synthesizing",
	"Assembling",
	"Manifesting",
	"Crunching",
	"Deliberating",
	"Ruminating",
	"Contemplating",
	"Fermenting",
	"Distilling",
	"Simmering",
	"Coalescing",
	"Reorganizing",
	"Interpolating",
	"Extrapolating",
	"Calibrating",
	"Reconciling",
	"Navigating",
	"Charting",
	"Weaving",
	"Knitting",
	"Sculpting",
	"Painting",
	"Composing",
	"Orchestrating",
	"Harmonizing",
	"Tuning",
	"Polishing",
]

/**
 * Deterministically pick a spinner verb for the given seed.
 * The seed is the loading-start timestamp; the same verb is stable per turn.
 */
export function pickVerb(seed: number): string {
	return SPINNER_VERBS[Math.abs(seed) % SPINNER_VERBS.length] ?? "Tumbling"
}
