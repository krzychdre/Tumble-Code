/**
 * Ctrl+R reverse search over the input history (UI plan §4), the pure part:
 * which entry matches, and what "older" means. History is oldest first.
 */

import { acceptQuery, searchOlder, startReverseSearch } from "../reverseSearch.js"

const history = ["git status", "npm test", "git log --oneline", "echo hi", "git log --oneline"]

describe("reverse search", () => {
	it("starts on the newest entry with an empty query", () => {
		expect(startReverseSearch(history)).toEqual({ query: "", matchIndex: 4, failed: false })
	})

	it("starts with no match on an empty history", () => {
		expect(startReverseSearch([])).toEqual({ query: "", matchIndex: null, failed: false })
	})

	it("finds the newest entry containing the query, ignoring case", () => {
		const state = acceptQuery(startReverseSearch(history), history, "GIT")

		expect(state.matchIndex).toBe(4)
		expect(state.failed).toBe(false)
	})

	it("goes to older matches and skips an entry equal to the current one", () => {
		let state = acceptQuery(startReverseSearch(history), history, "git")

		state = searchOlder(state, history)
		// index 2 repeats index 4's text, so the next distinct match is index 0.
		expect(state.matchIndex).toBe(0)
		expect(history[state.matchIndex!]).toBe("git status")
	})

	it("keeps the last match and flags the search as failing when nothing older matches", () => {
		let state = acceptQuery(startReverseSearch(history), history, "git status")
		state = searchOlder(state, history)

		expect(state.matchIndex).toBe(0)
		expect(state.failed).toBe(true)
	})

	it("flags a query nothing matches, keeping no match", () => {
		const state = acceptQuery(startReverseSearch(history), history, "zzz")

		expect(state.matchIndex).toBeNull()
		expect(state.failed).toBe(true)
	})

	it("searches from the newest entry again when the query changes", () => {
		let state = acceptQuery(startReverseSearch(history), history, "git")
		state = searchOlder(state, history)
		state = acceptQuery(state, history, "git l")

		expect(state.matchIndex).toBe(4)
	})
})
