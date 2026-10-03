import { z } from "zod"

import { clientKindSchema } from "./telemetry.js"

/**
 * Error reports: the detailed record of one failure in a task (a failed API
 * request, an empty answer, a broken tool call, a failing tool), sent to the
 * user's own cloud as `POST /api/error-reports`, and only while the user is
 * signed in to it. Without a cloud session nothing is built or stored.
 *
 * The wire shape is fixed with the cloud API (camelCase, optional fields
 * omitted, never null); the limits below are the ones the extension enforces
 * before sending. See ai_plans/2026-10-02_error-reports-extension.md.
 */

export const ERROR_REPORT_CATEGORIES = [
	"api_error",
	"empty_response",
	"context_overflow",
	"invalid_tool_call",
	"tool_error",
	"diff_error",
	"mistake_limit",
	"exception",
] as const

export const errorReportCategorySchema = z.enum(ERROR_REPORT_CATEGORIES)

export type ErrorReportCategory = z.infer<typeof errorReportCategorySchema>

/** Longest one-line summary. */
export const ERROR_REPORT_MAX_SUMMARY_CHARS = 500
/** Longest `errorMessage` and `toolResult`. */
export const ERROR_REPORT_MAX_TEXT_CHARS = 8_000
/** Longest single conversation message in `request.messages` (its JSON). */
export const ERROR_REPORT_MAX_MESSAGE_CHARS = 16_000
/** How many of the last conversation messages a report carries. */
export const ERROR_REPORT_MAX_MESSAGES = 6
/** The whole JSON body, in bytes. The server accepts up to 1 MB. */
export const ERROR_REPORT_MAX_BODY_BYTES = 256 * 1024

export const errorReportMessageSchema = z.object({
	role: z.enum(["user", "assistant", "system", "tool"]),
	content: z.string(),
})

export type ErrorReportMessage = z.infer<typeof errorReportMessageSchema>

export const errorReportToolCallSchema = z.object({
	id: z.string().optional(),
	name: z.string(),
	/** The arguments exactly as the model streamed them, unparsed. */
	arguments: z.string(),
})

export type ErrorReportToolCall = z.infer<typeof errorReportToolCallSchema>

export const errorReportRequestSchema = z.object({
	systemPromptChars: z.number().optional(),
	systemPromptSha256: z.string().optional(),
	toolNames: z.array(z.string()).optional(),
	params: z.record(z.string(), z.unknown()).optional(),
	messages: z.array(errorReportMessageSchema).optional(),
})

export const errorReportResponseSchema = z.object({
	text: z.string().optional(),
	reasoning: z.string().optional(),
	toolCalls: z.array(errorReportToolCallSchema).optional(),
	stopReason: z.string().optional(),
	errorBody: z.string().optional(),
	usage: z.record(z.string(), z.unknown()).optional(),
})

export const errorReportSchema = z.object({
	/** A uuid v4 made by the extension; the server ignores a duplicate. */
	id: z.string(),
	/** Epoch milliseconds. */
	occurredAt: z.number(),
	category: errorReportCategorySchema,
	summary: z.string().max(ERROR_REPORT_MAX_SUMMARY_CHARS),
	errorMessage: z.string().max(ERROR_REPORT_MAX_TEXT_CHARS).optional(),
	taskId: z.string().optional(),
	mode: z.string().optional(),
	appVersion: z.string().optional(),
	editorName: z.string().optional(),
	clientKind: clientKindSchema.optional(),
	clientVersion: z.string().optional(),
	platform: z.string().optional(),
	provider: z.string().optional(),
	modelId: z.string().optional(),
	contextWindow: z.number().optional(),
	maxOutputTokens: z.number().optional(),
	contextTokens: z.number().optional(),
	messageCount: z.number().optional(),
	toolName: z.string().optional(),
	httpStatus: z.number().optional(),
	retryAttempt: z.number().optional(),
	request: errorReportRequestSchema.optional(),
	response: errorReportResponseSchema.optional(),
	/** What the model was told about the failure. */
	toolResult: z.string().max(ERROR_REPORT_MAX_TEXT_CHARS).optional(),
})

export type ErrorReport = z.infer<typeof errorReportSchema>
