/**
 * Gerund list for the loading spinner.
 *
 * The theme is a rock tumbler: the barrel machine that turns sharp gravel into
 * smooth stones by rolling it for days with water and grit. It is the product's
 * own name taken literally, it is a machine that audibly works while you wait,
 * and it is an honest picture of the agent's job, since the same material goes
 * around and around and comes out smoother.
 *
 * Twenty words for the machine running and twenty for the lapidary work. Words
 * that read as a fault on a status line are deliberately absent (Grumbling,
 * Juddering, Knocking), as is anything that puts a clock on someone who is
 * already waiting.
 *
 * Keep every entry ASCII. The spinner line is redrawn next to a glyph column,
 * and a double-width character would make the gap to the frame jitter between
 * frames; see the note on the spinner frames in `figures.ts`.
 *
 * The verb is picked deterministically from the seed (the loading-start
 * timestamp) so a single turn keeps one stable verb; no Math.random.
 */

export const SPINNER_VERBS = [
	// The machine running.
	"Tumbling",
	"Rumbling",
	"Clattering",
	"Whirring",
	"Clunking",
	"Rattling",
	"Thrumming",
	"Chugging",
	"Clacking",
	"Ratcheting",
	"Humming",
	"Purring",
	"Drumming",
	"Whooshing",
	"Sloshing",
	"Gurgling",
	"Clinking",
	"Trundling",
	"Kerplunking",
	"Buzzing",
	// The lapidary work: lapping and honing are abrasive finishing, grading is
	// sorting stones by size between stages, faceting is cutting a gem's faces,
	// sluicing and panning are washing material down to what is worth keeping,
	// and a cobble is a stone rounded by exactly this treatment.
	"Churning",
	"Grinding",
	"Gritting",
	"Lapping",
	"Honing",
	"Burnishing",
	"Buffing",
	"Polishing",
	"Smoothing",
	"Rounding",
	"Sifting",
	"Cobbling",
	"Sluicing",
	"Panning",
	"Grading",
	"Sorting",
	"Settling",
	"Rolling",
	"Faceting",
	"Unearthing",
]

/**
 * Deterministically pick a spinner verb for the given seed.
 * The seed is the loading-start timestamp; the same verb is stable per turn.
 */
export function pickVerb(seed: number): string {
	return SPINNER_VERBS[Math.abs(seed) % SPINNER_VERBS.length] ?? "Tumbling"
}
