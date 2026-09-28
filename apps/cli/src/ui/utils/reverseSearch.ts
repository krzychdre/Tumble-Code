/**
 * Ctrl+R reverse search over the input history (UI plan §4), bash's
 * reverse-i-search: the newest entry containing the query, and on each
 * further Ctrl+R the next older one. The history is oldest first, as
 * useInputHistory keeps it. Matching ignores case. Pure, so the key handler
 * can run it through a reducer and never read a stale closure.
 */

export interface ReverseSearchState {
	query: string
	/** Index into the history of the entry shown, or null for none. */
	matchIndex: number | null
	/** Nothing (older) matches the query; bash prints "failing". */
	failed: boolean
}

function findFrom(history: readonly string[], query: string, fromIndex: number, skipText?: string): number | null {
	const needle = query.toLowerCase()

	for (let index = Math.min(fromIndex, history.length - 1); index >= 0; index--) {
		const entry = history[index]!

		if (entry === skipText) {
			continue
		}

		if (entry.toLowerCase().includes(needle)) {
			return index
		}
	}

	return null
}

export function startReverseSearch(history: readonly string[]): ReverseSearchState {
	return { query: "", matchIndex: history.length > 0 ? history.length - 1 : null, failed: false }
}

/** A new query searches again from the newest entry. */
export function acceptQuery(_state: ReverseSearchState, history: readonly string[], query: string): ReverseSearchState {
	const matchIndex = findFrom(history, query, history.length - 1)
	return { query, matchIndex, failed: matchIndex === null && history.length > 0 }
}

/**
 * The next older match, skipping entries equal to the one shown (the history
 * keeps repeats). With none left the current match stays and the search is
 * marked failing, as in bash.
 */
export function searchOlder(state: ReverseSearchState, history: readonly string[]): ReverseSearchState {
	if (state.matchIndex === null) {
		return { ...state, failed: history.length > 0 }
	}

	const matchIndex = findFrom(history, state.query, state.matchIndex - 1, history[state.matchIndex])
	return matchIndex === null ? { ...state, failed: true } : { ...state, matchIndex, failed: false }
}
