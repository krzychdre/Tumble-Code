import type { Key } from "ink"

import { GLOBAL_INPUT_SEQUENCES, isGlobalInputSequence, matchesGlobalSequence } from "../input.js"

function createKey(overrides: Partial<Key> = {}): Key {
	return {
		upArrow: false,
		downArrow: false,
		leftArrow: false,
		rightArrow: false,
		pageDown: false,
		pageUp: false,
		home: false,
		end: false,
		return: false,
		escape: false,
		ctrl: false,
		shift: false,
		tab: false,
		backspace: false,
		delete: false,
		meta: false,
		super: false,
		hyper: false,
		capsLock: false,
		numLock: false,
		...overrides,
	}
}

describe("globalInputSequences", () => {
	describe("GLOBAL_INPUT_SEQUENCES registry", () => {
		it("should have ctrl-c registered", () => {
			const seq = GLOBAL_INPUT_SEQUENCES.find((s) => s.id === "ctrl-c")
			expect(seq).toBeDefined()
			expect(seq?.description).toContain("Exit")
		})

		it("should have cycle-mode registered", () => {
			const seq = GLOBAL_INPUT_SEQUENCES.find((s) => s.id === "cycle-mode")
			expect(seq).toBeDefined()
			expect(seq?.description).toContain("mode")
		})

		it("should have ctrl-o registered", () => {
			const seq = GLOBAL_INPUT_SEQUENCES.find((s) => s.id === "ctrl-o")
			expect(seq).toBeDefined()
			expect(seq?.description).toContain("verbose")
		})
	})

	describe("isGlobalInputSequence", () => {
		describe("Ctrl+C detection", () => {
			it("should match standard Ctrl+C", () => {
				const result = isGlobalInputSequence("c", createKey({ ctrl: true }))
				expect(result).toBeDefined()
				expect(result?.id).toBe("ctrl-c")
			})

			it("should not match plain 'c' key", () => {
				const result = isGlobalInputSequence("c", createKey())
				expect(result).toBeUndefined()
			})
		})

		describe("mode cycling detection", () => {
			it("should match Shift+Tab (backtab)", () => {
				// ink reports ESC [ Z as tab + shift with an empty input string
				const result = isGlobalInputSequence("", createKey({ tab: true, shift: true }))
				expect(result).toBeDefined()
				expect(result?.id).toBe("cycle-mode")
			})

			it("should match CSI u encoding for Shift+Tab", () => {
				const result = isGlobalInputSequence("\x1b[9;2u", createKey())
				expect(result).toBeDefined()
				expect(result?.id).toBe("cycle-mode")
			})

			it("should match input ending with CSI u sequence", () => {
				const result = isGlobalInputSequence("[9;2u", createKey())
				expect(result).toBeDefined()
				expect(result?.id).toBe("cycle-mode")
			})

			it("should not match plain Tab, which the picker owns", () => {
				const result = isGlobalInputSequence("", createKey({ tab: true }))
				expect(result).toBeUndefined()
			})

			it("should not match Enter, which is what a terminal sends for Ctrl+M", () => {
				// Ctrl+M is byte 0x0d, so ink sees a carriage return: input "\r"
				// with key.return set. Nothing may treat that as mode cycling, or
				// submitting a prompt would switch modes instead.
				const result = isGlobalInputSequence("\r", createKey({ return: true }))
				expect(result).toBeUndefined()
			})
		})

		describe("Ctrl+O detection", () => {
			it("should match standard Ctrl+O", () => {
				const result = isGlobalInputSequence("o", createKey({ ctrl: true }))
				expect(result).toBeDefined()
				expect(result?.id).toBe("ctrl-o")
			})

			it("should match CSI u encoding for Ctrl+O", () => {
				const result = isGlobalInputSequence("\x1b[111;5u", createKey())
				expect(result).toBeDefined()
				expect(result?.id).toBe("ctrl-o")
			})

			it("should match input ending with the CSI u sequence", () => {
				const result = isGlobalInputSequence("[111;5u", createKey())
				expect(result).toBeDefined()
				expect(result?.id).toBe("ctrl-o")
			})

			it("should not match plain 'o' key", () => {
				const result = isGlobalInputSequence("o", createKey())
				expect(result).toBeUndefined()
			})
		})

		it("should return undefined for non-global sequences", () => {
			const result = isGlobalInputSequence("a", createKey())
			expect(result).toBeUndefined()
		})

		it("should return undefined for regular text input", () => {
			const result = isGlobalInputSequence("hello", createKey())
			expect(result).toBeUndefined()
		})
	})

	describe("matchesGlobalSequence", () => {
		it("should return true for matching sequence ID", () => {
			const result = matchesGlobalSequence("c", createKey({ ctrl: true }), "ctrl-c")
			expect(result).toBe(true)
		})

		it("should return false for non-matching sequence ID", () => {
			const result = matchesGlobalSequence("c", createKey({ ctrl: true }), "cycle-mode")
			expect(result).toBe(false)
		})

		it("should return false for non-existent sequence ID", () => {
			const result = matchesGlobalSequence("c", createKey({ ctrl: true }), "non-existent")
			expect(result).toBe(false)
		})

		it("should match cycle-mode in both encodings", () => {
			expect(matchesGlobalSequence("", createKey({ tab: true, shift: true }), "cycle-mode")).toBe(true)
			expect(matchesGlobalSequence("\x1b[9;2u", createKey(), "cycle-mode")).toBe(true)
		})

		it("should match ctrl-o by ID in both encodings", () => {
			expect(matchesGlobalSequence("o", createKey({ ctrl: true }), "ctrl-o")).toBe(true)
			expect(matchesGlobalSequence("\x1b[111;5u", createKey(), "ctrl-o")).toBe(true)
		})
	})

	describe("extensibility", () => {
		it("should have unique IDs for all sequences", () => {
			const ids = GLOBAL_INPUT_SEQUENCES.map((s) => s.id)
			const uniqueIds = new Set(ids)
			expect(uniqueIds.size).toBe(ids.length)
		})

		it("should have descriptions for all sequences", () => {
			for (const seq of GLOBAL_INPUT_SEQUENCES) {
				expect(seq.description).toBeTruthy()
				expect(seq.description.length).toBeGreaterThan(0)
			}
		})
	})
})
