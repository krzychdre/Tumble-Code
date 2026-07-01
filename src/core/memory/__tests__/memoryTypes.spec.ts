import {
	MEMORY_TYPES,
	parseMemoryType,
	TYPES_SECTION_INDIVIDUAL,
	WHAT_NOT_TO_SAVE_SECTION,
	WHEN_TO_ACCESS_SECTION,
	TRUSTING_RECALL_SECTION,
	MEMORY_DRIFT_CAVEAT,
} from "../memoryTypes"

describe("memoryTypes", () => {
	describe("parseMemoryType", () => {
		it("accepts the four canonical types", () => {
			for (const t of MEMORY_TYPES) {
				expect(parseMemoryType(t)).toBe(t)
			}
		})

		it("returns undefined for unknown / non-string types", () => {
			expect(parseMemoryType("team")).toBeUndefined()
			expect(parseMemoryType("")).toBeUndefined()
			expect(parseMemoryType(undefined)).toBeUndefined()
			expect(parseMemoryType(42)).toBeUndefined()
			expect(parseMemoryType(null)).toBeUndefined()
		})

		it("is case-sensitive (matches Claude Code's behavior)", () => {
			expect(parseMemoryType("User")).toBeUndefined()
			expect(parseMemoryType("FEEDBACK")).toBeUndefined()
		})
	})

	describe("TYPES_SECTION_INDIVIDUAL", () => {
		it("covers all four types with name/description/when_to_save", () => {
			const blob = TYPES_SECTION_INDIVIDUAL.join("\n")
			for (const t of MEMORY_TYPES) {
				expect(blob).toContain(`name="${t}"`)
			}
			expect(blob).toContain("<when_to_save>")
			expect(blob).toContain("<description>")
		})
	})

	describe("WHAT_NOT_TO_SAVE_SECTION", () => {
		it("lists the canonical exclusions", () => {
			const blob = WHAT_NOT_TO_SAVE_SECTION.join("\n")
			expect(blob).toContain("Code patterns")
			expect(blob).toContain("Git history")
			expect(blob).toContain("Debugging solutions")
			expect(blob).toContain("Ephemeral task details")
		})
	})

	describe("WHEN_TO_ACCESS_SECTION", () => {
		it("includes the drift caveat and the ignore-memory rule", () => {
			const blob = WHEN_TO_ACCESS_SECTION.join("\n")
			expect(blob).toContain(MEMORY_DRIFT_CAVEAT)
			expect(blob).toContain("ignore")
			expect(blob).toContain("MEMORY.md were empty")
		})
	})

	describe("TRUSTING_RECALL_SECTION", () => {
		it("tells the model to verify before recommending", () => {
			const blob = TRUSTING_RECALL_SECTION.join("\n")
			expect(blob).toContain("file path")
			expect(blob).toContain("function or flag")
			expect(blob).toContain("X exists now")
		})
	})
})
