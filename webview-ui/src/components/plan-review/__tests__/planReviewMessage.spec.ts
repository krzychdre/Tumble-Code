import { describe, expect, it } from "vitest"

import { compilePlanReviewMessage, type PlanAnnotation } from "../planReviewMessage"

describe("compilePlanReviewMessage", () => {
	it("compiles a single annotation", () => {
		const annotations: PlanAnnotation[] = [{ id: "1", quote: "Build the API", note: "Needs auth spec" }]
		const result = compilePlanReviewMessage(annotations, "")
		expect(result).toContain("I reviewed the plan and added notes on specific parts.")
		expect(result).toContain("> Build the API")
		expect(result).toContain("Note: Needs auth spec")
		expect(result).toContain("Please address these notes and update the plan.")
	})

	it("compiles multiple annotations", () => {
		const annotations: PlanAnnotation[] = [
			{ id: "1", quote: "Build the API", note: "Needs auth spec" },
			{ id: "2", quote: "Deploy to prod", note: "Add staging first" },
		]
		const result = compilePlanReviewMessage(annotations, "")
		expect(result).toContain("> Build the API")
		expect(result).toContain("Note: Needs auth spec")
		expect(result).toContain("> Deploy to prod")
		expect(result).toContain("Note: Add staging first")
	})

	it("prefixes every line of a multi-line quote with > ", () => {
		const annotations: PlanAnnotation[] = [{ id: "1", quote: "Line one\nLine two\nLine three", note: "Check this" }]
		const result = compilePlanReviewMessage(annotations, "")
		expect(result).toContain("> Line one\n> Line two\n> Line three")
	})

	it("normalizes \\r\\n to \\n in quotes", () => {
		const annotations: PlanAnnotation[] = [{ id: "1", quote: "Line one\r\nLine two", note: "Check this" }]
		const result = compilePlanReviewMessage(annotations, "")
		expect(result).toContain("> Line one\n> Line two")
		expect(result).not.toContain("\r")
	})

	it("omits header when only overall comment, no annotations", () => {
		const result = compilePlanReviewMessage([], "Good plan overall")
		expect(result).not.toContain("I reviewed the plan and added notes on specific parts.")
		expect(result).toContain("Overall: Good plan overall")
		expect(result).toContain("Please address these notes and update the plan.")
	})

	it("includes both annotations and overall comment", () => {
		const annotations: PlanAnnotation[] = [{ id: "1", quote: "Section A", note: "Fix A" }]
		const result = compilePlanReviewMessage(annotations, "Overall good work")
		expect(result).toContain("I reviewed the plan and added notes on specific parts.")
		expect(result).toContain("> Section A")
		expect(result).toContain("Note: Fix A")
		expect(result).toContain("Overall: Overall good work")
		expect(result).toContain("Please address these notes and update the plan.")
	})

	it("defensively skips annotations with empty quote or note after trim", () => {
		const annotations: PlanAnnotation[] = [
			{ id: "1", quote: "Valid quote", note: "Valid note" },
			{ id: "2", quote: "   ", note: "Note without quote" },
			{ id: "3", quote: "Quote without note", note: "  " },
			{ id: "4", quote: "", note: "" },
		]
		const result = compilePlanReviewMessage(annotations, "")
		expect(result).toContain("> Valid quote")
		expect(result).toContain("Note: Valid note")
		expect(result).not.toContain("Note without quote")
		expect(result).not.toContain("Quote without note")
	})

	it("always includes the final instruction line", () => {
		expect(compilePlanReviewMessage([], "")).toContain("Please address these notes and update the plan.")
		expect(compilePlanReviewMessage([{ id: "1", quote: "Q", note: "N" }], "")).toContain(
			"Please address these notes and update the plan.",
		)
		expect(compilePlanReviewMessage([], "Overall")).toContain("Please address these notes and update the plan.")
	})

	it("trims notes and quotes", () => {
		const annotations: PlanAnnotation[] = [{ id: "1", quote: "  Trimmed quote  ", note: "  Trimmed note  " }]
		const result = compilePlanReviewMessage(annotations, "")
		expect(result).toContain("> Trimmed quote")
		expect(result).toContain("Note: Trimmed note")
	})

	it("trims overall comment", () => {
		const result = compilePlanReviewMessage([], "  Trimmed overall  ")
		expect(result).toContain("Overall: Trimmed overall")
	})

	it("produces correct full output for a typical case", () => {
		const annotations: PlanAnnotation[] = [
			{ id: "1", quote: "Step 1: Design", note: "Missing API schema" },
			{ id: "2", quote: "Step 2: Implement", note: "Add tests" },
		]
		const result = compilePlanReviewMessage(annotations, "Looks reasonable")
		const expected = [
			"I reviewed the plan and added notes on specific parts. Each quoted block is the part of the plan the note refers to.",
			"",
			"> Step 1: Design",
			"",
			"Note: Missing API schema",
			"",
			"> Step 2: Implement",
			"",
			"Note: Add tests",
			"",
			"Overall: Looks reasonable",
			"",
			"Please address these notes and update the plan.",
		].join("\n")
		expect(result).toBe(expected)
	})

	describe("with filePath", () => {
		it("uses file-path header when filePath given and there are annotations", () => {
			const annotations: PlanAnnotation[] = [{ id: "1", quote: "Build the API", note: "Needs auth spec" }]
			const result = compilePlanReviewMessage(annotations, "", "plans/plan.md")
			expect(result).toContain("I reviewed the plan in `plans/plan.md` and added notes on specific parts.")
			expect(result).not.toContain("I reviewed the plan and added notes on specific parts.")
			expect(result).toContain("> Build the API")
			expect(result).toContain("Note: Needs auth spec")
		})

		it("does not use file-path header when filePath given but no annotations", () => {
			const result = compilePlanReviewMessage([], "Good overall", "plans/plan.md")
			expect(result).not.toContain("I reviewed the plan in")
			expect(result).not.toContain("I reviewed the plan and added notes")
			expect(result).toContain("Overall: Good overall")
		})

		it("produces correct full output with filePath", () => {
			const annotations: PlanAnnotation[] = [{ id: "1", quote: "Step 1", note: "Fix step 1" }]
			const result = compilePlanReviewMessage(annotations, "Looks good", "plans/plan.md")
			const expected = [
				"I reviewed the plan in `plans/plan.md` and added notes on specific parts. Each quoted block is the part of the plan the note refers to.",
				"",
				"> Step 1",
				"",
				"Note: Fix step 1",
				"",
				"Overall: Looks good",
				"",
				"Please address these notes and update the plan.",
			].join("\n")
			expect(result).toBe(expected)
		})
	})
})
