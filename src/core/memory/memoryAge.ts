/**
 * Staleness text helpers for memory files.
 *
 * Ported near-verbatim from Claude Code's `memdir/memoryAge.ts`. Pure
 * functions, no filesystem or external dependencies — safe to unit-test in
 * isolation.
 */

const MS_PER_DAY = 86_400_000

/** Whole days since `mtimeMs`. Clamped at 0. */
export function memoryAgeDays(mtimeMs: number): number {
	return Math.max(0, Math.floor((Date.now() - mtimeMs) / MS_PER_DAY))
}

/** Human-readable age: "today" | "yesterday" | "N days ago". */
export function memoryAge(mtimeMs: number): string {
	const d = memoryAgeDays(mtimeMs)
	if (d === 0) return "today"
	if (d === 1) return "yesterday"
	return `${d} days ago`
}

/**
 * A staleness caveat for memory files older than one day. Returns "" for
 * fresh memories (≤1 day) so the prompt isn't cluttered with noise.
 */
export function memoryFreshnessText(mtimeMs: number): string {
	const d = memoryAgeDays(mtimeMs)
	if (d <= 1) return ""
	return (
		`This memory is ${d} days old. ` +
		`Memories are point-in-time observations, not live state — ` +
		`claims about code behavior or file:line citations may be outdated. ` +
		`Verify against current code before asserting as fact.`
	)
}

/** The staleness caveat wrapped in a `<system-reminder>` (or "" if fresh). */
export function memoryFreshnessNote(mtimeMs: number): string {
	const text = memoryFreshnessText(mtimeMs)
	if (!text) return ""
	return `<system-reminder>${text}</system-reminder>\n`
}
