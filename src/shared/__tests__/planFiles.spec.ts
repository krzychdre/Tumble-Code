import { isPlanFilePath } from "../planFiles"

describe("isPlanFilePath", () => {
	describe("plans/ and ai_plans/ directory segments", () => {
		it("nested dirs docs/plans/x.md → true", () => {
			expect(isPlanFilePath("/project/docs/plans/x.md", "/project")).toBe(true)
		})

		it("ai_plans/2026.md → true", () => {
			expect(isPlanFilePath("/project/ai_plans/2026.md", "/project")).toBe(true)
		})

		it("plans/plan.md → true", () => {
			expect(isPlanFilePath("/project/plans/plan.md", "/project")).toBe(true)
		})

		it("deeply nested ai_plans/sub/dir/plan.md → true", () => {
			expect(isPlanFilePath("/project/ai_plans/sub/dir/plan.md", "/project")).toBe(true)
		})
	})

	describe("root plan.md / todo.md (relative to cwd)", () => {
		it("plan.md at cwd root → true", () => {
			expect(isPlanFilePath("/project/plan.md", "/project")).toBe(true)
		})

		it("todo.md at cwd root → true", () => {
			expect(isPlanFilePath("/project/todo.md", "/project")).toBe(true)
		})

		it("src/plan.md → false (plan.md only at cwd root)", () => {
			expect(isPlanFilePath("/project/src/plan.md", "/project")).toBe(false)
		})

		it("src/todo.md → false", () => {
			expect(isPlanFilePath("/project/src/todo.md", "/project")).toBe(false)
		})
	})

	describe("non-plan files", () => {
		it("plans.md → false (file name, not a directory segment)", () => {
			expect(isPlanFilePath("/project/plans.md", "/project")).toBe(false)
		})

		it("README.md → false", () => {
			expect(isPlanFilePath("/project/README.md", "/project")).toBe(false)
		})

		it("non-.md file in plans dir → false", () => {
			expect(isPlanFilePath("/project/plans/notes.txt", "/project")).toBe(false)
		})

		it("src/app.ts → false", () => {
			expect(isPlanFilePath("/project/src/app.ts", "/project")).toBe(false)
		})
	})

	describe("case variations", () => {
		it("PLANS/Plan.MD → true (case-insensitive)", () => {
			expect(isPlanFilePath("/project/PLANS/Plan.MD", "/project")).toBe(true)
		})

		it("AI_Plans/plan.md → true (case-insensitive segment)", () => {
			expect(isPlanFilePath("/project/AI_Plans/plan.md", "/project")).toBe(true)
		})

		it("PLAN.md at root → true (case-insensitive file name)", () => {
			expect(isPlanFilePath("/project/PLAN.md", "/project")).toBe(true)
		})

		it("TODO.MD at root → true", () => {
			expect(isPlanFilePath("/project/TODO.MD", "/project")).toBe(true)
		})
	})

	describe("windows separators", () => {
		it("windows plans\\plan.md with windows cwd → true", () => {
			expect(isPlanFilePath("C:\\project\\plans\\plan.md", "C:\\project")).toBe(true)
		})

		it("windows ai_plans\\plan.md → true", () => {
			expect(isPlanFilePath("C:\\project\\ai_plans\\plan.md", "C:\\project")).toBe(true)
		})

		it("windows plan.md at root → true", () => {
			expect(isPlanFilePath("C:\\project\\plan.md", "C:\\project")).toBe(true)
		})

		it("windows src\\plan.md → false", () => {
			expect(isPlanFilePath("C:\\project\\src\\plan.md", "C:\\project")).toBe(false)
		})

		it("mixed separators plans/plan.md with windows cwd → true", () => {
			expect(isPlanFilePath("C:\\project/plans/plan.md", "C:\\project")).toBe(true)
		})
	})

	describe("absPath outside cwd", () => {
		it("absPath outside cwd containing an ai_plans segment → true", () => {
			expect(isPlanFilePath("/other/ai_plans/plan.md", "/project")).toBe(true)
		})

		it("absPath outside cwd containing a plans segment → true", () => {
			expect(isPlanFilePath("/other/plans/x.md", "/project")).toBe(true)
		})

		it("absPath outside cwd with plan.md at its own root → true (relative to its own segments)", () => {
			// When absPath is outside cwd, we use absPath's own segments.
			// /other/plan.md has 2 segments relative to nothing, so plan.md is not at root.
			expect(isPlanFilePath("/other/plan.md", "/project")).toBe(false)
		})

		it("absPath outside cwd that is exactly plan.md (single segment) → true", () => {
			expect(isPlanFilePath("plan.md", "/project")).toBe(true)
		})
	})

	describe("no cwd", () => {
		it("no cwd, ai_plans segment → true", () => {
			expect(isPlanFilePath("/project/ai_plans/plan.md", undefined)).toBe(true)
		})

		it("no cwd, plans segment → true", () => {
			expect(isPlanFilePath("/project/plans/plan.md", undefined)).toBe(true)
		})

		it("no cwd, single segment plan.md → true", () => {
			expect(isPlanFilePath("plan.md", undefined)).toBe(true)
		})

		it("no cwd, two-segment path plan.md not at root → false", () => {
			expect(isPlanFilePath("src/plan.md", undefined)).toBe(false)
		})
	})
})
