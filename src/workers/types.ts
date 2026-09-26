import { z } from "zod"

export const countTokensResultSchema = z.discriminatedUnion("success", [
	z.object({
		success: z.literal(true),
		count: z.number(),
	}),
	z.object({ success: z.literal(false), error: z.string() }),
])

export type CountTokensResult = z.infer<typeof countTokensResultSchema>

export const countTokensPerBlockResultSchema = z.discriminatedUnion("success", [
	z.object({
		success: z.literal(true),
		counts: z.array(z.number()),
	}),
	z.object({ success: z.literal(false), error: z.string() }),
])

export type CountTokensPerBlockResult = z.infer<typeof countTokensPerBlockResultSchema>
