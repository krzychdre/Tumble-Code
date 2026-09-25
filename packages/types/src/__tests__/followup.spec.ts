import {
	firstUsableSuggestion,
	hasUsableAnswer,
	parseFollowUpData,
	suggestionItemSchema,
	suggestionModeToSwitch,
} from "../followup.js"

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

describe("parseFollowUpData", () => {
	it("reads the question and the usable suggestions", () => {
		const text = JSON.stringify({
			question: "Next?",
			suggest: [{ answer: "Build", mode: "code" }, { answer: " " }, { answer: "Plan" }, { mode: "ask" }],
		})

		expect(parseFollowUpData(text)).toEqual({
			question: "Next?",
			suggestions: [{ answer: "Build", mode: "code" }, { answer: "Plan" }],
		})
	})

	it("drops a question or a mode that is not a string", () => {
		const text = JSON.stringify({ question: 42, suggest: [{ answer: "A", mode: 7 }, { answer: "B", mode: "" }] })

		expect(parseFollowUpData(text)).toEqual({ suggestions: [{ answer: "A" }, { answer: "B" }] })
	})

	it.each([undefined, "", "not json", "null", "[1]", '"text"', "42"])("yields nothing for %j", (text) => {
		expect(parseFollowUpData(text)).toEqual({ suggestions: [] })
	})
})

describe("suggestionModeToSwitch", () => {
	it("switches on a manual choice", () => {
		expect(suggestionModeToSwitch({ mode: "code" }, { manual: true })).toBe("code")
	})

	it("switches on an automatic choice only when mode switches are auto-approved", () => {
		expect(suggestionModeToSwitch({ mode: "code" }, { manual: false })).toBeUndefined()
		expect(suggestionModeToSwitch({ mode: "code" }, { manual: false, alwaysAllowModeSwitch: true })).toBe("code")
	})

	it("never switches without a mode", () => {
		expect(suggestionModeToSwitch({}, { manual: true })).toBeUndefined()
		expect(suggestionModeToSwitch({ mode: "" }, { manual: true })).toBeUndefined()
		expect(suggestionModeToSwitch({ mode: 3 }, { manual: true })).toBeUndefined()
	})
})
