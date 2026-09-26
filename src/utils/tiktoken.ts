import { Anthropic } from "@anthropic-ai/sdk"
import { Tiktoken } from "tiktoken/lite"
import o200kBase from "tiktoken/encoders/o200k_base"

const TOKEN_FUDGE_FACTOR = 1.5

let encoder: Tiktoken | null = null

/**
 * Serializes a tool_use block to text for token counting.
 * Approximates how the API sees the tool call.
 */
function serializeToolUse(block: Anthropic.Messages.ToolUseBlockParam): string {
	const parts = [`Tool: ${block.name}`]
	if (block.input !== undefined) {
		try {
			parts.push(`Arguments: ${JSON.stringify(block.input)}`)
		} catch {
			parts.push(`Arguments: [serialization error]`)
		}
	}
	return parts.join("\n")
}

/**
 * Serializes a tool_result block to text for token counting.
 * Handles both string content and array content.
 */
function serializeToolResult(block: Anthropic.Messages.ToolResultBlockParam): string {
	const parts = [`Tool Result (${block.tool_use_id})`]

	if (block.is_error) {
		parts.push(`[Error]`)
	}

	const content = block.content
	if (typeof content === "string") {
		parts.push(content)
	} else if (Array.isArray(content)) {
		// Handle array of content blocks recursively
		for (const item of content) {
			if (item.type === "text") {
				parts.push(item.text || "")
			} else if (item.type === "image") {
				parts.push("[Image content]")
			} else {
				parts.push(`[Unsupported content block: ${String((item as { type?: unknown }).type)}]`)
			}
		}
	}

	return parts.join("\n")
}

/** The encoding every local count uses, whatever the model. Part of any cache key for counts. */
export const TIKTOKEN_ENCODING = "o200k_base"

function getEncoder(): Tiktoken {
	// Lazily create and cache the encoder if it doesn't exist.
	if (!encoder) {
		encoder = new Tiktoken(o200kBase.bpe_ranks, o200kBase.special_tokens, o200kBase.pat_str)
	}
	return encoder
}

/**
 * Raw token count of one block, before the fudge factor. A pure function of
 * the block's JSON-visible fields, so equal blocks always get equal counts.
 */
function rawBlockTokens(encoder: Tiktoken, block: Anthropic.Messages.ContentBlockParam): number {
	if (block.type === "text") {
		const text = block.text || ""
		return text.length > 0 ? encoder.encode(text, undefined, []).length : 0
	}
	if (block.type === "image") {
		// For images, calculate based on data size.
		const imageSource = block.source
		if (imageSource && typeof imageSource === "object" && "data" in imageSource) {
			const base64Data = imageSource.data as string
			return Math.ceil(Math.sqrt(base64Data.length))
		}
		return 300 // Conservative estimate for unknown images
	}
	if (block.type === "tool_use") {
		// Serialize tool_use block to text and count tokens
		const serialized = serializeToolUse(block as Anthropic.Messages.ToolUseBlockParam)
		return serialized.length > 0 ? encoder.encode(serialized, undefined, []).length : 0
	}
	if (block.type === "tool_result") {
		// Serialize tool_result block to text and count tokens
		const serialized = serializeToolResult(block as Anthropic.Messages.ToolResultBlockParam)
		return serialized.length > 0 ? encoder.encode(serialized, undefined, []).length : 0
	}
	return 0
}

/**
 * Everything `rawBlockTokens` reads from a block, as a list of strings, so
 * blocks with equal parts always get equal raw counts. A count cache uses
 * the parts as its key; the large strings are the block's own strings (not
 * copies), so a Map lookup reuses the hash V8 keeps on each string.
 *
 * Keep in step with rawBlockTokens and the serializers above. Throws where
 * rawBlockTokens would throw.
 */
export function blockCountKeyParts(block: Anthropic.Messages.ContentBlockParam): string[] {
	if (block.type === "text") {
		return ["text", block.text || ""]
	}
	if (block.type === "image") {
		const imageSource = block.source
		if (imageSource && typeof imageSource === "object" && "data" in imageSource) {
			// Only the length of the data is counted.
			return ["image", String((imageSource.data as string).length)]
		}
		return ["image"]
	}
	if (block.type === "tool_use") {
		return ["tool_use", serializeToolUse(block as Anthropic.Messages.ToolUseBlockParam)]
	}
	if (block.type === "tool_result") {
		const result = block as Anthropic.Messages.ToolResultBlockParam
		const parts = ["tool_result", String(result.tool_use_id), result.is_error ? "error" : ""]
		const content = result.content
		if (typeof content === "string") {
			parts.push("string", content)
		} else if (Array.isArray(content)) {
			parts.push("array")
			for (const item of content) {
				if (item.type === "text") {
					parts.push("text", item.text || "")
				} else if (item.type === "image") {
					parts.push("image")
				} else {
					parts.push("other", String((item as { type?: unknown }).type))
				}
			}
		} else {
			parts.push("none")
		}
		return parts
	}
	return ["other", String((block as { type?: unknown }).type)]
}

/**
 * Raw token count of each block, in order, without the fudge factor. Callers
 * that remember per-block counts sum these and apply `applyTokenFudge` once,
 * which gives exactly what `tiktoken` returns for the same blocks.
 */
export async function tiktokenPerBlock(content: Anthropic.Messages.ContentBlockParam[]): Promise<number[]> {
	if (content.length === 0) {
		return []
	}
	const encoder = getEncoder()
	return content.map((block) => rawBlockTokens(encoder, block))
}

/**
 * Adds a fudge factor to a summed raw count, because tiktoken is not always
 * accurate. Applied once to the total, never per block (rounding differs).
 */
export function applyTokenFudge(rawTokens: number): number {
	return Math.ceil(rawTokens * TOKEN_FUDGE_FACTOR)
}

export async function tiktoken(content: Anthropic.Messages.ContentBlockParam[]): Promise<number> {
	if (content.length === 0) {
		return 0
	}

	let totalTokens = 0
	for (const count of await tiktokenPerBlock(content)) {
		totalTokens += count
	}
	return applyTokenFudge(totalTokens)
}
