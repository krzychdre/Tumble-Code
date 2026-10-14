/**
 * The part of a diff preview that decides what each coloured band shows.
 *
 * A diff line is painted as one band of exactly `width` columns, and a line
 * longer than that is cut, never wrapped: a wrapped band would spill a
 * half-coloured second row and blow the dynamic tail's row budget. The cut
 * used to be blind, so an edit to a long line (the typo in column 300 of a
 * 400-column sentence) showed up as a removed band and an added band that
 * read exactly the same, as if the model had added a duplicate line.
 *
 * Now the removed and added lines of a modified pair are compared first. The
 * columns they differ in are known before the band is cut, so the band is
 * shifted to keep the change in view (an ellipsis marks the cut-away identical
 * prefix) and the changed columns are painted in a stronger shade. Everything
 * here is plain string work with no ink in it, so it can be tested without a
 * terminal.
 */

import { figures } from "../../figures.js"

import type { DiffHunk } from "./utils.js"

export type DiffLine = DiffHunk["lines"][number]

/** Columns of a line that differ from its partner line; `to` is exclusive. */
export interface ChangeSpan {
	from: number
	to: number
}

/** A hunk line plus the span its partner line differs in, if it has one. */
export interface DiffLineView {
	line: DiffLine
	change?: ChangeSpan
}

/** One band, cut into the text before the change, the change and the rest. */
export interface BandSegments {
	before: string
	changed: string
	after: string
}

/** Identical columns kept to the left of a change the band is shifted to. */
const LEAD_CONTEXT = 12

/** Columns of the change that must be in view before the band is shifted. */
const MIN_CHANGE_IN_VIEW = 8

const GUTTER: Record<DiffLine["type"], string> = {
	added: "+",
	removed: "-",
	context: " ",
	header: " ",
}

/**
 * The columns `removed` and `added` differ in: everything between their common
 * prefix and their common suffix. Lines that share nothing get no span; a
 * highlight of every column says no more than the band already does.
 */
export function changeSpans(removed: string, added: string): { removed: ChangeSpan; added: ChangeSpan } | undefined {
	if (removed === added) {
		return undefined
	}
	const shortest = Math.min(removed.length, added.length)
	let prefix = 0
	while (prefix < shortest && removed[prefix] === added[prefix]) {
		prefix++
	}
	let suffix = 0
	while (suffix < shortest - prefix && removed[removed.length - 1 - suffix] === added[added.length - 1 - suffix]) {
		suffix++
	}
	if (prefix + suffix === 0) {
		return undefined
	}
	return {
		removed: { from: prefix, to: removed.length - suffix },
		added: { from: prefix, to: added.length - suffix },
	}
}

/**
 * Pair every run of removed lines with the run of added lines that follows it,
 * the way a unified diff lays a modification out, and record for each paired
 * line the span its partner differs in. Lines without a partner (context, a
 * surplus of removed or added lines) are passed through unchanged.
 */
export function pairHunkLines(lines: DiffLine[]): DiffLineView[] {
	const views: DiffLineView[] = lines.map((line) => ({ line }))
	let index = 0
	while (index < lines.length) {
		if (lines[index]!.type !== "removed") {
			index++
			continue
		}
		const removedStart = index
		while (index < lines.length && lines[index]!.type === "removed") {
			index++
		}
		const addedStart = index
		while (index < lines.length && lines[index]!.type === "added") {
			index++
		}
		const pairs = Math.min(addedStart - removedStart, index - addedStart)
		for (let pair = 0; pair < pairs; pair++) {
			const removed = views[removedStart + pair]!
			const added = views[addedStart + pair]!
			const spans = changeSpans(removed.line.content, added.line.content)
			if (spans) {
				removed.change = spans.removed
				added.change = spans.added
			}
		}
	}
	return views
}

/**
 * One diff line as an exactly `width`-wide band: the gutter sign, the line and
 * either padding or a trailing ellipsis where the line was cut. When the line
 * is cut and its change would fall beyond the cut, the band starts a little
 * before the change instead and opens with an ellipsis for the identical
 * columns it skipped. Both lines of a pair share the same first differing
 * column, so both bands shift by the same amount and stay aligned.
 */
export function bandSegments(view: DiffLineView, width: number): BandSegments {
	const { line, change } = view
	const gutter = GUTTER[line.type]
	let lead = gutter
	let start = 0
	const fits = gutter.length + line.content.length <= width
	if (!fits && change) {
		// The last column of a cut band is its ellipsis.
		const inView = width - gutter.length - 1
		const needed = Math.max(1, Math.min(change.to - change.from, MIN_CHANGE_IN_VIEW))
		if (change.from + needed > inView) {
			start = Math.max(0, change.from - LEAD_CONTEXT)
			lead = `${gutter}${figures.ellipsis}`
		}
	}

	let text = `${lead}${line.content.slice(start)}`
	const cut = text.length > width
	text = cut ? `${text.slice(0, Math.max(0, width - 1))}${figures.ellipsis}` : text.padEnd(width)
	if (!change) {
		return { before: text, changed: "", after: "" }
	}

	const last = cut ? width - 1 : width
	const from = Math.min(last, lead.length + change.from - start)
	const to = Math.max(from, Math.min(last, lead.length + change.to - start))
	return { before: text.slice(0, from), changed: text.slice(from, to), after: text.slice(to) }
}
