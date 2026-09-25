import type { ClineMessage } from "@roo-code/types"

/**
 * The synthetic "condensing context" row is keyed by ts. A fixed ts keeps its
 * key stable while the list recomputes on every streamed token (a `Date.now()`
 * key remounted the row each time), and the largest safe integer can never
 * collide with a real message's ts.
 */
export const CONDENSING_ROW_TS = Number.MAX_SAFE_INTEGER

const CONDENSING_ROW: ClineMessage = {
	type: "say",
	say: "condense_context",
	ts: CONDENSING_ROW_TS,
	partial: true,
}

/** `rows` plus the synthetic condensing row at the end while condensing. */
export function withCondensingRow(rows: ClineMessage[], isCondensing: boolean): ClineMessage[] {
	return isCondensing ? [...rows, CONDENSING_ROW] : rows
}
