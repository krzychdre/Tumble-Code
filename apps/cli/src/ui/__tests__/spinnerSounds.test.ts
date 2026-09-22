import { describe, it, expect } from "vitest"

import { SPINNER_SOUNDS, pickSound } from "../spinnerSounds.js"

describe("pickSound", () => {
	it("returns the same sound for the same seed, so one turn keeps one word", () => {
		expect(pickSound(1_758_547_200_123)).toBe(pickSound(1_758_547_200_123))
	})

	it("wraps around the list", () => {
		expect(pickSound(0)).toBe(SPINNER_SOUNDS[0])
		expect(pickSound(SPINNER_SOUNDS.length)).toBe(SPINNER_SOUNDS[0])
		expect(pickSound(SPINNER_SOUNDS.length + 3)).toBe(SPINNER_SOUNDS[3])
	})

	it("returns a real sound for a negative seed", () => {
		expect(SPINNER_SOUNDS).toContain(pickSound(-7))
	})

	it("only ever returns a word from the list", () => {
		for (let seed = 0; seed < 200; seed++) {
			expect(SPINNER_SOUNDS).toContain(pickSound(seed))
		}
	})
})

describe("SPINNER_SOUNDS", () => {
	it("has no duplicates", () => {
		expect(new Set(SPINNER_SOUNDS).size).toBe(SPINNER_SOUNDS.length)
	})

	// One assertion covers three rules at once: a single word (no spaces, no
	// hyphens, no doubled forms), ASCII only (a double-width character would
	// make the gap to the spinner frame jitter between frames), and a leading
	// capital so the status line reads as a sentence.
	it("is a single capitalised ASCII word", () => {
		for (const sound of SPINNER_SOUNDS) {
			expect(sound).toMatch(/^[A-Z][a-z]+$/)
		}
	})

	it("stays short, so a long word cannot push the elapsed/token suffix around", () => {
		for (const sound of SPINNER_SOUNDS) {
			expect(sound.length).toBeLessThanOrEqual(10)
		}
	})
})
