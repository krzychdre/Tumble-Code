/**
 * Tail-clamping for dynamic (not-yet-promoted) message bodies.
 *
 * Ink can only erase rows inside the visible viewport. If the dynamic tail
 * grows taller than the terminal, its top rows scroll into native scrollback
 * where they can never be erased — every later frame leaves a stale duplicate
 * behind. Clamping the rendered body keeps the tail under the terminal height;
 * the full text still prints once into scrollback when the message finalizes
 * and is promoted into `<Static>`.
 */

export interface TailClampResult {
	/** Content clamped to roughly `maxRows` physical rows (from the end). */
	content: string
	/** Number of raw lines hidden from the start of the content. */
	hiddenLines: number
}

/** Columns lost to the bullet/indent prefix in message renderers. */
const INDENT_COLUMNS = 4

/**
 * Clamp `content` to approximately `maxRows` physical terminal rows, keeping
 * the tail (the newest lines). Wrap-aware: a raw line is estimated to occupy
 * `ceil(length / effectiveWidth)` rows. A single raw line wider than the whole
 * budget is tail-sliced by characters so it can never overflow on its own.
 */
export function clampTail(content: string, maxRows: number, columns: number): TailClampResult {
	const lines = content.split("\n")
	const effectiveWidth = Math.max(20, columns - INDENT_COLUMNS)
	const budget = Math.max(1, maxRows)

	let rowsUsed = 0
	let start = lines.length
	while (start > 0) {
		const line = lines[start - 1] ?? ""
		const lineRows = Math.max(1, Math.ceil(line.length / effectiveWidth))
		if (rowsUsed + lineRows > budget) {
			break
		}
		rowsUsed += lineRows
		start--
	}

	if (start === 0) {
		return { content, hiddenLines: 0 }
	}

	// Nothing fit: the newest raw line alone wraps past the budget. Slice it
	// by characters so the rendered height stays bounded regardless.
	if (start === lines.length) {
		const last = lines[lines.length - 1] ?? ""
		const keepChars = budget * effectiveWidth
		return {
			content: `…${last.slice(-keepChars)}`,
			hiddenLines: lines.length - 1,
		}
	}

	return { content: lines.slice(start).join("\n"), hiddenLines: start }
}
