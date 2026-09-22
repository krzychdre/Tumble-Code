/**
 * Noise list for the loading spinner.
 *
 * The line renders as `{sound}… (esc to interrupt · 12s · ↓ 1.2K tokens)`, so
 * the suffix already says that something is running. That frees the word from
 * having to be a verb at all: instead of reporting a sound ("Clunking"), the
 * line simply makes one ("Clunk"). Shorter, and the joke survives.
 *
 * The rock tumbler is still the home key, since it is the product's name taken
 * literally and an honest picture of the job, the same material going around
 * and around until it comes out smoother. But the list is not confined to the
 * barrel: it wanders out into slurry, comic-book springs and small robot noises,
 * because forty variations on one machine would be duller than forty noises.
 *
 * Rules every entry follows, all of them enforced by the tests:
 *
 * - One word, letters only. No spaces, no hyphens, no doubled forms; the tail
 *   of the line supplies the rhythm, the word supplies the hit.
 * - ASCII. The line is redrawn next to a glyph column, and a double-width
 *   character would make the gap to the frame jitter between frames; see the
 *   note on the spinner frames in `figures.ts`.
 * - Nothing that reads as a failure on a status line. That bars the obvious
 *   crash noises (Bang, Boom, Crash, Snap), the fault noises (Grind, Squeak,
 *   Sputter, Hiss, Judder), anything that implies destruction while the agent
 *   is editing files (Zap, Kapow), Fizzle, and Tick, which puts a clock on
 *   someone who is already waiting.
 *
 * The sound is picked deterministically from the seed (the loading-start
 * timestamp) so a single turn keeps one stable word; no Math.random.
 */

export const SPINNER_SOUNDS = [
	// The barrel. `Tumble` is the one entry that is not a noise: it holds index
	// zero as the brand's own word and as the fallback below.
	"Tumble",
	"Rumble",
	"Clunk",
	"Clank",
	"Clack",
	"Whirr",
	"Thrum",
	"Kerchunk",
	"Thunk",
	"Whump",
	// What is inside it: stones, water and abrasive grit.
	"Kerplunk",
	"Kerplop",
	"Sploosh",
	"Slosh",
	"Glug",
	"Glorp",
	"Gloop",
	"Squelch",
	"Crunch",
	"Scritch",
	// Comic-book physics, for the ones that should raise a smile.
	"Boing",
	"Sproing",
	"Plop",
	"Plink",
	"Plonk",
	"Flump",
	"Fwoosh",
	"Shloop",
	"Swish",
	"Thwack",
	// Small noises, half of them the machine's own electronics.
	"Blip",
	"Blorp",
	"Beep",
	"Boop",
	"Meep",
	"Pop",
	"Fizz",
	"Ting",
	"Clink",
	"Vroom",
]

/**
 * Deterministically pick a spinner sound for the given seed.
 * The seed is the loading-start timestamp; the same word is stable per turn.
 */
export function pickSound(seed: number): string {
	return SPINNER_SOUNDS[Math.abs(seed) % SPINNER_SOUNDS.length] ?? "Tumble"
}
