import { firstUsableSuggestion, hasUsableAnswer, suggestionItemSchema } from "../followup.js"

describe("hasUsableAnswer", () => {
	it("accepts a non-blank string answer", () => {
		expect(hasUsableAnswer({ answer: "Yes" })).toBe(true)
		expect(hasUsableAnswer({ answer: "  padded  ", mode: "code" })).toBe(true)
	})

	it("rejects blank, missing and non-string answers", () => {
		expect(hasUsableAnswer({ answer: "" })).toBe(false)
		expect(hasUsableAnswer({ answer: " \n\t" })).toBe(false)
		expect(hasUsableAnswer({ mode: "code" })).toBe(false)
		expect(hasUsableAnswer({ answer: 42 })).toBe(false)
		expect(hasUsableAnswer(null)).toBe(false)
		expect(hasUsableAnswer(undefined)).toBe(false)
		expect(hasUsableAnswer("Yes")).toBe(false)
	})
})

describe("firstUsableSuggestion", () => {
	it("returns the first suggestion with a usable answer", () => {
		expect(firstUsableSuggestion([{ answer: "" }, null, { answer: 1 }, { answer: "B" }, { answer: "C" }])).toEqual({
			answer: "B",
		})
	})

	it("returns undefined when nothing is usable or the input is not an array", () => {
		expect(firstUsableSuggestion([{ answer: " " }])).toBeUndefined()
		expect(firstUsableSuggestion([])).toBeUndefined()
		expect(firstUsableSuggestion(undefined)).toBeUndefined()
		expect(firstUsableSuggestion({ answer: "A" })).toBeUndefined()
	})
})

describe("suggestionItemSchema", () => {
	it("accepts an item without an answer", () => {
		expect(suggestionItemSchema.safeParse({ mode: "code" }).success).toBe(true)
	})
})
