import { z } from "zod"

/**
 * Roo CLI stream-json output
 */

export const rooCliOutputFormats = ["text", "json", "stream-json"] as const

export const rooCliOutputFormatSchema = z.enum(rooCliOutputFormats)

export type RooCliOutputFormat = z.infer<typeof rooCliOutputFormatSchema>

export const rooCliEventTypes = [
	"system",
	"assistant",
	"user",
	"tool_use",
	"tool_result",
	"thinking",
	"error",
	"result",
] as const

export const rooCliEventTypeSchema = z.enum(rooCliEventTypes)

export type RooCliEventType = z.infer<typeof rooCliEventTypeSchema>

export const rooCliToolUseSchema = z.object({
	name: z.string(),
	input: z.record(z.string(), z.unknown()).optional(),
})

export type RooCliToolUse = z.infer<typeof rooCliToolUseSchema>

export const rooCliToolResultSchema = z.object({
	name: z.string(),
	output: z.string().optional(),
	error: z.string().optional(),
})

export type RooCliToolResult = z.infer<typeof rooCliToolResultSchema>

export const rooCliCostSchema = z.object({
	totalCost: z.number().optional(),
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	cacheWrites: z.number().optional(),
	cacheReads: z.number().optional(),
})

export type RooCliCost = z.infer<typeof rooCliCostSchema>

export const rooCliStreamEventSchema = z
	.object({
		type: rooCliEventTypeSchema.optional(),
		subtype: z.string().optional(),
		content: z.string().optional(),
		success: z.boolean().optional(),
		id: z.number().optional(),
		done: z.boolean().optional(),
		schemaVersion: z.number().optional(),
		protocol: z.string().optional(),
		tool_use: rooCliToolUseSchema.optional(),
		tool_result: rooCliToolResultSchema.optional(),
		cost: rooCliCostSchema.optional(),
	})
	.passthrough()

export type RooCliStreamEvent = z.infer<typeof rooCliStreamEventSchema>

export const rooCliFinalOutputSchema = z.object({
	type: z.literal("result"),
	success: z.boolean(),
	content: z.string().optional(),
	cost: rooCliCostSchema.optional(),
	events: z.array(rooCliStreamEventSchema),
})

export type RooCliFinalOutput = z.infer<typeof rooCliFinalOutputSchema>
