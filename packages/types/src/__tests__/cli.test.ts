import { rooCliFinalOutputSchema, rooCliStreamEventSchema } from "../cli.js"

describe("CLI types", () => {
	describe("rooCliStreamEventSchema", () => {
		it("accepts passthrough fields for forward compatibility", () => {
			const result = rooCliStreamEventSchema.safeParse({
				type: "assistant",
				id: 42,
				content: "partial",
				customField: "future",
			})

			expect(result.success).toBe(true)
		})
	})

	describe("rooCliFinalOutputSchema", () => {
		it("validates final json output shape", () => {
			const result = rooCliFinalOutputSchema.safeParse({
				type: "result",
				success: true,
				content: "done",
				events: [],
			})

			expect(result.success).toBe(true)
		})
	})
})
