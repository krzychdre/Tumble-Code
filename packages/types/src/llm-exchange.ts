import { z } from "zod"

/**
 * LLM exchanges: one request to the model and its answer, recorded so that a
 * training dataset can be built from real agent runs and every request can be
 * reconstructed exactly as it was sent. Sent to the user's own cloud as
 * `POST /api/llm-exchanges`, only while the user is signed in to it AND has
 * switched recording on there (`GET /api/llm-exchanges/config`).
 *
 * The conversation is stored incrementally: an exchange names the earlier
 * exchange of the same task it builds on (`baseId`) and carries only what
 * changed. Large texts that rarely change (the system prompt, the tool
 * definitions) travel as blobs addressed by their SHA-256, with the text
 * included the first time a chain uses them. An exchange without `baseId` is a
 * full snapshot.
 *
 * The wire shape is fixed with the cloud API (camelCase, optional fields
 * omitted, never null). See ai_plans/2026-10-02_llm-exchange-dataset.md.
 */

/** Largest gzip-compressed body the server accepts, in bytes. */
export const LLM_EXCHANGE_MAX_COMPRESSED_BYTES = 32 * 1024 * 1024

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/)

/** A large text by its SHA-256; `text` is present the first time a chain sends it. */
export const llmBlobRefSchema = z.object({
	sha256: sha256Schema,
	text: z.string().optional(),
})

export type LlmBlobRef = z.infer<typeof llmBlobRefSchema>

/** An array as "the first `keep` elements of the base exchange's array, then `append`". */
export const llmArrayDeltaSchema = z.object({
	keep: z.number().int().min(0),
	append: z.array(z.unknown()),
})

export type LlmArrayDelta = z.infer<typeof llmArrayDeltaSchema>

/** One top-level field of the wire body, in its original position. */
export const llmWireFieldSchema = z.discriminatedUnion("kind", [
	z.object({ key: z.string(), kind: z.literal("value"), value: z.unknown() }),
	z.object({ key: z.string(), kind: z.literal("blob"), blob: llmBlobRefSchema }),
	z.object({ key: z.string(), kind: z.literal("array"), delta: llmArrayDeltaSchema }),
])

export type LlmWireField = z.infer<typeof llmWireFieldSchema>

export const LLM_WIRE_FORMATS = ["openai-chat", "anthropic-messages", "openai-responses", "other"] as const

/** The HTTP body exactly as the provider SDK sent it, split into fields. */
export const llmWireRequestSchema = z.object({
	/** Origin and path only; the query string can carry a key. */
	url: z.string(),
	format: z.enum(LLM_WIRE_FORMATS),
	/** SHA-256 and byte length of the original body, to verify a reconstruction. */
	bodySha256: sha256Schema,
	bodyBytes: z.number().int().min(0),
	/** Absent when the body was not a JSON object; then only the hash is kept. */
	fields: z.array(llmWireFieldSchema).optional(),
})

export type LlmWireRequest = z.infer<typeof llmWireRequestSchema>

export const llmToolCallSchema = z.object({
	id: z.string().optional(),
	name: z.string(),
	/** The arguments exactly as the model streamed them, unparsed. */
	arguments: z.string(),
})

export const llmUsageSchema = z.object({
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	cacheReadTokens: z.number().optional(),
	cacheWriteTokens: z.number().optional(),
	totalCost: z.number().optional(),
})

export type LlmUsage = z.infer<typeof llmUsageSchema>

export const LLM_EXCHANGE_STATUSES = ["completed", "error", "aborted"] as const

export const llmExchangeSchema = z.object({
	/** A uuid v4 made by the extension; the server ignores a duplicate. */
	id: z.string(),
	/** The earlier exchange of the same task this one is a delta of; absent for a full snapshot. */
	baseId: z.string().optional(),
	taskId: z.string(),
	parentTaskId: z.string().optional(),
	rootTaskId: z.string().optional(),
	/** Increases by one per exchange of the task within one extension session. */
	sequence: z.number().int().min(0),
	/** Epoch milliseconds when the request was built. */
	occurredAt: z.number(),
	durationMs: z.number().optional(),
	retryAttempt: z.number().int().min(0),
	mode: z.string().optional(),
	provider: z.string().optional(),
	modelId: z.string(),
	appVersion: z.string().optional(),
	editorName: z.string().optional(),
	platform: z.string().optional(),
	workspacePath: z.string().optional(),
	request: z.object({
		system: llmBlobRefSchema,
		/** The tools array (OpenAI function format) as JSON text; "[]" when none were offered. */
		tools: llmBlobRefSchema,
		messages: llmArrayDeltaSchema,
		/** keep + append.length: a cross-check for the reconstruction. */
		messageCount: z.number().int().min(0),
		params: z.record(z.string(), z.unknown()),
		wire: llmWireRequestSchema.optional(),
	}),
	response: z.object({
		text: z.string().optional(),
		reasoning: z.string().optional(),
		toolCalls: z.array(llmToolCallSchema).optional(),
		finishReason: z.string().optional(),
		usage: llmUsageSchema.optional(),
	}),
	status: z.enum(LLM_EXCHANGE_STATUSES),
	error: z
		.object({
			message: z.string(),
			httpStatus: z.number().optional(),
			body: z.string().optional(),
		})
		.optional(),
})

export type LlmExchange = z.infer<typeof llmExchangeSchema>

export const LLM_TOOL_OUTCOME_STATUSES = [
	"ok",
	"invalid_tool_call",
	"tool_error",
	"diff_error",
	"mistake_limit",
	"rejected",
] as const

export const llmToolOutcomeSchema = z.object({
	toolCallId: z.string().optional(),
	toolName: z.string(),
	status: z.enum(LLM_TOOL_OUTCOME_STATUSES),
	/** The failure as the extension noted it, cut to 2000 characters. */
	note: z.string().max(2_000).optional(),
})

export type LlmToolOutcome = z.infer<typeof llmToolOutcomeSchema>

/** What happened after the answer: `POST /api/llm-exchanges/outcome`. */
export const llmExchangeOutcomeSchema = z.object({
	exchangeId: z.string(),
	taskId: z.string(),
	toolResults: z.array(llmToolOutcomeSchema),
	/** The final usage, when the background drain completed it after the exchange was sent. */
	usage: llmUsageSchema.optional(),
})

export type LlmExchangeOutcome = z.infer<typeof llmExchangeOutcomeSchema>
