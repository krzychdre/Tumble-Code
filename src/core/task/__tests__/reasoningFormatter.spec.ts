// cd src && ./node_modules/.bin/vitest run core/task/__tests__/reasoningFormatter.spec.ts

// API P3 (Phase 10): the streamed reasoning was formatted by running a regex
// over the whole accumulated text on every chunk. The incremental formatter
// formats each finished line once; these tests pin that its output equals the
// old whole-text formatting after every chunk.

import { formatReasoningText, IncrementalReasoningFormatter } from "../reasoningFormatter"

/** The formatting TaskStreamProcessor applied to the whole text before API P3. */
function formatWhole(text: string): string {
	return text.includes("**") ? text.replace(/([.!?])\*\*([^*\n]+)\*\*/g, "$1\n\n**$2**") : text
}

/** A small deterministic random generator, so a failure can be reproduced. */
function random(seed: number) {
	let state = seed
	return () => {
		state = (state * 1_103_515_245 + 12_345) % 2 ** 31
		return state / 2 ** 31
	}
}

describe("reasoning formatting (API P3)", () => {
	it("puts a blank line before a bold title that follows a sentence end", () => {
		expect(formatReasoningText("Done.**Next step** go")).toBe("Done.\n\n**Next step** go")
		expect(formatReasoningText("no bold here")).toBe("no bold here")
		// A title cannot span lines, so a newline inside it is left alone.
		expect(formatReasoningText("Done.**Next\nstep**")).toBe("Done.**Next\nstep**")
	})

	it("matches the whole-text formatting after every chunk, for random texts and chunk sizes", () => {
		const pieces = ["Done.", "**Title**", "**", " word", "\n", "?", "!", "*", "text ", ".**Plan**", "\n\n", "é"]

		for (let seed = 1; seed <= 200; seed++) {
			const next = random(seed)
			let text = ""
			while (text.length < 400) {
				text += pieces[Math.floor(next() * pieces.length)]
			}

			const formatter = new IncrementalReasoningFormatter()
			let accumulated = ""
			let position = 0
			while (position < text.length) {
				const size = 1 + Math.floor(next() * 12)
				const chunk = text.slice(position, position + size)
				position += size
				accumulated += chunk

				expect(formatter.append(chunk)).toBe(formatWhole(accumulated))
			}
		}
	})

	it("formats each finished line once instead of the whole text per chunk", () => {
		const line = "The model thinks about the change. **Checking the tests** it reads the spec.\n"
		const text = line.repeat(200)
		const formatter = new IncrementalReasoningFormatter()

		let formatted = ""
		for (let i = 0; i < text.length; i += 4) {
			formatted = formatter.append(text.slice(i, i + 4))
		}

		expect(formatted).toBe(formatWhole(text))
		// Characters the formatter scanned: each finished line once plus the open
		// line per chunk, instead of the whole text per chunk (quadratic).
		const wholeTextWork = Array.from({ length: Math.ceil(text.length / 4) }, (_, i) =>
			Math.min(text.length, (i + 1) * 4),
		).reduce((sum, length) => sum + length, 0)
		expect(formatter.scannedCharacters).toBeLessThan(wholeTextWork / 20)
	})

	it("starts over after reset", () => {
		const formatter = new IncrementalReasoningFormatter()
		formatter.append("First.**One**\n")
		formatter.reset()

		expect(formatter.append("Second.**Two**")).toBe("Second.\n\n**Two**")
	})
})
