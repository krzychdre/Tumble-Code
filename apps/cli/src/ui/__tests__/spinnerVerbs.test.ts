import { describe, it, expect } from "vitest"

import { SPINNER_VERBS, pickVerb } from "../spinnerVerbs.js"

describe("pickVerb", () => {
	it("returns the same verb for the same seed, so one turn keeps one word", () => {
		expect(pickVerb(1_758_547_200_123)).toBe(pickVerb(1_758_547_200_123))
	})

	it("wraps around the list", () => {
		expect(pickVerb(0)).toBe(SPINNER_VERBS[0])
		expect(pickVerb(SPINNER_VERBS.length)).toBe(SPINNER_VERBS[0])
		expect(pickVerb(SPINNER_VERBS.length + 3)).toBe(SPINNER_VERBS[3])
	})

	it("returns a real verb for a negative seed", () => {
		expect(SPINNER_VERBS).toContain(pickVerb(-7))
	})

	it("only ever returns a word from the list", () => {
		for (let seed = 0; seed < 200; seed++) {
			expect(SPINNER_VERBS).toContain(pickVerb(seed))
		}
	})
})

describe("SPINNER_VERBS", () => {
	it("has no duplicates", () => {
		expect(new Set(SPINNER_VERBS).size).toBe(SPINNER_VERBS.length)
	})

	it("is all gerunds, because the spinner renders '{verb}…'", () => {
		for (const verb of SPINNER_VERBS) {
			expect(verb).toMatch(/ing$/)
		}
	})

	it("is all ASCII, so the gap to the spinner frame cannot jitter", () => {
		for (const verb of SPINNER_VERBS) {
			expect(verb).toMatch(/^[\x20-\x7E]+$/)
		}
	})

	it("starts each word with a capital, so the status line reads as a sentence", () => {
		for (const verb of SPINNER_VERBS) {
			expect(verb[0]).toBe(verb[0]?.toUpperCase())
		}
	})
})
