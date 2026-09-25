/**
 * Processing of the Bedrock ConverseStream events, split out of AwsBedrockHandler.createMessage.
 * The chunk builders are pure; processBedrockStream walks the stream in the order createMessage
 * always used (usage metadata, prompt router trace, message start, content block start,
 * content block delta, message stop).
 */
import { logger } from "../../../utils/logging"
import type { ApiStream, ApiStreamChunk, ApiStreamUsageChunk } from "../../transform/stream"

// Content block event types covering the multiple structures returned by AWS SDK versions
interface ContentBlockStartEvent {
	start?: {
		text?: string
		thinking?: string
		toolUse?: {
			toolUseId?: string
			name?: string
		}
	}
	contentBlockIndex?: number
	// Alternative structure used by some AWS SDK versions
	content_block?: {
		type?: string
		thinking?: string
	}
	// Official AWS SDK structure for reasoning (as documented)
	contentBlock?: {
		type?: string
		thinking?: string
		reasoningContent?: {
			text?: string
		}
		// Tool use block start
		toolUse?: {
			toolUseId?: string
			name?: string
		}
	}
}

interface ContentBlockDeltaEvent {
	delta?: {
		text?: string
		thinking?: string
		type?: string
		// AWS SDK structure for reasoning content deltas
		reasoningContent?: {
			text?: string
		}
		// Tool use input delta
		toolUse?: {
			input?: string
		}
	}
	contentBlockIndex?: number
}

interface PromptRouterUsage {
	inputTokens: number
	outputTokens: number
	totalTokens?: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
	cacheReadInputTokenCount?: number
	cacheWriteInputTokenCount?: number
}

// Stream event types based on the AWS SDK
export interface StreamEvent {
	messageStart?: {
		role?: string
	}
	messageStop?: {
		stopReason?: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence"
		additionalModelResponseFields?: Record<string, unknown>
	}
	contentBlockStart?: ContentBlockStartEvent
	contentBlockDelta?: ContentBlockDeltaEvent
	metadata?: {
		usage?: {
			inputTokens: number
			outputTokens: number
			totalTokens?: number
			cacheReadInputTokens?: number
			cacheWriteInputTokens?: number
			cacheReadInputTokenCount?: number
			cacheWriteInputTokenCount?: number
		}
		metrics?: {
			latencyMs: number
		}
	}
	// Prompt router trace
	trace?: {
		promptRouter?: {
			invokedModelId?: string
			usage?: PromptRouterUsage
		}
	}
}

// Usage information in stream events
type UsageType = {
	inputTokens?: number
	outputTokens?: number
	cacheReadInputTokens?: number
	cacheWriteInputTokens?: number
	cacheReadInputTokenCount?: number
	cacheWriteInputTokenCount?: number
}

export interface BedrockStreamHooks {
	/** The prompt router reported the model it invoked (used to price the request). */
	onInvokedModelId(invokedModelId: string): void
}

/** Parses a JSON string chunk (tests send those); `undefined` means skip the chunk. */
export function parseBedrockStreamEvent(chunk: unknown): { event: StreamEvent } | undefined {
	try {
		return { event: typeof chunk === "string" ? JSON.parse(chunk) : (chunk as unknown as StreamEvent) }
	} catch (e) {
		logger.error("Failed to parse stream event", {
			ctx: "bedrock",
			error: e instanceof Error ? e : String(e),
			chunk: typeof chunk === "string" ? chunk : "binary data",
		})
		return undefined
	}
}

export function usageChunkFromMetadata(usage: UsageType): ApiStreamUsageChunk {
	return {
		type: "usage",
		inputTokens: usage.inputTokens || 0,
		outputTokens: usage.outputTokens || 0,
		// Check both field naming conventions for cache tokens
		cacheReadTokens: usage.cacheReadInputTokens || usage.cacheReadInputTokenCount || 0,
		cacheWriteTokens: usage.cacheWriteInputTokens || usage.cacheWriteInputTokenCount || 0,
	}
}

export function usageChunkFromPromptRouter(usage: PromptRouterUsage): ApiStreamUsageChunk {
	return {
		type: "usage",
		inputTokens: usage.inputTokens || 0,
		outputTokens: usage.outputTokens || 0,
		// Check both field naming conventions for cache tokens
		cacheReadTokens: usage.cacheReadTokens || usage.cacheReadInputTokenCount || 0,
		cacheWriteTokens: usage.cacheWriteTokens || usage.cacheWriteInputTokenCount || 0,
	}
}

export function chunksFromContentBlockStart(cbStart: ContentBlockStartEvent): ApiStreamChunk[] {
	const chunks: ApiStreamChunk[] = []

	// Reasoning block (AWS SDK structure)
	if (cbStart.contentBlock?.reasoningContent) {
		if (cbStart.contentBlockIndex && cbStart.contentBlockIndex > 0) {
			chunks.push({ type: "reasoning", text: "\n" })
		}
		chunks.push({ type: "reasoning", text: cbStart.contentBlock.reasoningContent.text || "" })
	}
	// Thinking block in either structure: contentBlock (newer) or content_block (some SDK versions)
	else if (cbStart.contentBlock?.type === "thinking" || cbStart.content_block?.type === "thinking") {
		const contentBlock = cbStart.contentBlock || cbStart.content_block
		if (cbStart.contentBlockIndex && cbStart.contentBlockIndex > 0) {
			chunks.push({ type: "reasoning", text: "\n" })
		}
		if (contentBlock?.thinking) {
			chunks.push({ type: "reasoning", text: contentBlock.thinking })
		}
	}
	// Tool use block start
	else if (cbStart.start?.toolUse || cbStart.contentBlock?.toolUse) {
		const toolUse = cbStart.start?.toolUse || cbStart.contentBlock?.toolUse
		if (toolUse) {
			chunks.push({
				type: "tool_call_partial",
				index: cbStart.contentBlockIndex ?? 0,
				id: toolUse.toolUseId,
				name: toolUse.name,
				arguments: undefined,
			})
		}
	} else if (cbStart.start?.text) {
		chunks.push({ type: "text", text: cbStart.start.text })
	}

	return chunks
}

/**
 * Multiple delta structures are supported for AWS SDK compatibility, first match wins:
 * delta.reasoningContent.text (AWS docs), delta.toolUse.input (tool arguments),
 * delta.thinking with type thinking_delta (older SDK versions), delta.text.
 */
export function chunksFromContentBlockDelta(cbDelta: ContentBlockDeltaEvent): ApiStreamChunk[] {
	const delta = cbDelta.delta
	if (!delta) {
		return []
	}
	if (delta.reasoningContent?.text) {
		return [{ type: "reasoning", text: delta.reasoningContent.text }]
	}
	if (delta.toolUse?.input) {
		return [
			{
				type: "tool_call_partial",
				index: cbDelta.contentBlockIndex ?? 0,
				id: undefined,
				name: undefined,
				arguments: delta.toolUse.input,
			},
		]
	}
	if (delta.type === "thinking_delta" && delta.thinking) {
		return [{ type: "reasoning", text: delta.thinking }]
	}
	if (delta.text) {
		return [{ type: "text", text: delta.text }]
	}
	return []
}

export async function* processBedrockStream(stream: AsyncIterable<unknown>, hooks: BedrockStreamHooks): ApiStream {
	for await (const chunk of stream) {
		const parsed = parseBedrockStreamEvent(chunk)
		if (!parsed) {
			continue
		}
		const streamEvent = parsed.event

		// Handle metadata events first
		if (streamEvent.metadata?.usage) {
			yield usageChunkFromMetadata((streamEvent.metadata?.usage || {}) as UsageType)
			continue
		}

		if (streamEvent?.trace?.promptRouter?.invokedModelId) {
			try {
				hooks.onInvokedModelId(streamEvent.trace.promptRouter.invokedModelId)

				// Handle metadata events for the promptRouter.
				if (streamEvent?.trace?.promptRouter?.usage) {
					yield usageChunkFromPromptRouter(streamEvent.trace.promptRouter.usage)
				}
			} catch (error) {
				logger.error("Error handling Bedrock invokedModelId", {
					ctx: "bedrock",
					error: error instanceof Error ? error : String(error),
				})
			} finally {
				// eslint-disable-next-line no-unsafe-finally
				continue
			}
		}

		if (streamEvent.messageStart) {
			continue
		}

		if (streamEvent.contentBlockStart) {
			yield* chunksFromContentBlockStart(streamEvent.contentBlockStart)
			continue
		}

		if (streamEvent.contentBlockDelta) {
			yield* chunksFromContentBlockDelta(streamEvent.contentBlockDelta)
			continue
		}

		if (streamEvent.messageStop) {
			continue
		}
	}
}
