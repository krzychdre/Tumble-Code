import * as os from "os"
import { Anthropic } from "@anthropic-ai/sdk"

import type { ReasoningEffortExtended } from "@roo-code/types"

import { Package } from "../../../shared/package"
import type { ApiHandlerCreateMessageMetadata } from "../../index"
import { toStrictSchema } from "../../transform/strict-json-schema"
import { isMcpTool } from "../../../utils/mcp-name"
import { sanitizeOpenAiCallId } from "../../../utils/tool-id"
import { imageSourceToUrl } from "../../transform/image-source"

/** The User-Agent OpenAI Native and Codex send, for request tracking on OpenAI's side. */
export function responsesApiUserAgent(): string {
	return `roo-code/${Package.version} (${os.platform()} ${os.release()}; ${os.arch()}) node/${process.version.slice(1)}`
}

/**
 * One tool in the Responses API shape: the Chat Completions `function` wrapper is
 * flattened into the item.
 */
export interface ResponsesApiTool {
	type: "function"
	name: string
	description?: string
	parameters?: any
	strict?: boolean
}

/**
 * Converts the Chat Completions tool list of the request metadata to the Responses API
 * shape. Native tools are sent strict (every property required, additionalProperties:
 * false, `null` kept in union types); MCP tools are sent non-strict so their optional
 * parameters stay optional, but still get additionalProperties: false, which the
 * Responses API requires.
 */
export function toResponsesApiTools(tools: ApiHandlerCreateMessageMetadata["tools"]): ResponsesApiTool[] {
	return (tools ?? [])
		.filter((tool) => tool.type === "function")
		.map((tool) => {
			const isMcp = isMcpTool(tool.function.name)
			return {
				type: "function",
				name: tool.function.name,
				description: tool.function.description,
				parameters: toStrictSchema(tool.function.parameters, { mcp: isMcp }),
				strict: !isMcp,
			}
		})
}

/**
 * Converts the conversation to the Responses API input list (OpenAI Native and Codex).
 *
 * The system prompt is not part of it: the Responses API takes it in the top-level
 * `instructions` field. Encrypted reasoning items of earlier turns (`type: "reasoning"`)
 * are passed through as they are, tool results become `function_call_output` items and
 * tool uses `function_call` items, both after the message they came with. Call ids are
 * sanitized to the 64 characters OpenAI accepts.
 */
export function toResponsesApiInput(messages: Anthropic.Messages.MessageParam[]): any[] {
	const formattedInput: any[] = []

	for (const message of messages) {
		if ((message as any).type === "reasoning") {
			formattedInput.push(message)
			continue
		}

		if (message.role === "user") {
			const content: any[] = []
			const toolResults: any[] = []

			if (typeof message.content === "string") {
				content.push({ type: "input_text", text: message.content })
			} else if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block.type === "text") {
						content.push({ type: "input_text", text: block.text })
					} else if (block.type === "image") {
						const image = block as Anthropic.Messages.ImageBlockParam
						const imageUrl = imageSourceToUrl(image.source)
						content.push({ type: "input_image", image_url: imageUrl })
					} else if (block.type === "tool_result") {
						const result =
							typeof block.content === "string"
								? block.content
								: block.content?.map((c) => (c.type === "text" ? c.text : "")).join("") || ""
						toolResults.push({
							type: "function_call_output",
							call_id: sanitizeOpenAiCallId(block.tool_use_id),
							output: result,
						})
					}
				}
			}

			if (content.length > 0) {
				formattedInput.push({ role: "user", content })
			}
			if (toolResults.length > 0) {
				formattedInput.push(...toolResults)
			}
		} else if (message.role === "assistant") {
			const content: any[] = []
			const toolCalls: any[] = []

			if (typeof message.content === "string") {
				content.push({ type: "output_text", text: message.content })
			} else if (Array.isArray(message.content)) {
				for (const block of message.content) {
					if (block.type === "text") {
						content.push({ type: "output_text", text: block.text })
					} else if (block.type === "tool_use") {
						toolCalls.push({
							type: "function_call",
							call_id: sanitizeOpenAiCallId(block.id),
							name: block.name,
							arguments: JSON.stringify(block.input),
						})
					}
				}
			}

			if (content.length > 0) {
				formattedInput.push({ role: "assistant", content })
			}
			if (toolCalls.length > 0) {
				formattedInput.push(...toolCalls)
			}
		}
	}

	return formattedInput
}

export interface ResponsesApiRequestBodyParams {
	modelId: string
	input: any[]
	/** The system prompt. */
	instructions: string
	/** Undefined: no reasoning block and no encrypted reasoning in the answer. */
	reasoningEffort: ReasoningEffortExtended | undefined
	/** Ask for a reasoning summary (only sent together with an effort). */
	reasoningSummary: boolean
	/**
	 * Handler-specific fields (sampling, limits, tiers, cache retention). They are placed
	 * between the reasoning block and the tools, so the key order of the body stays the
	 * one each handler sent before the shared builder existed.
	 */
	settings?: Record<string, unknown>
	metadata?: ApiHandlerCreateMessageMetadata
}

/**
 * The streaming request body shared by OpenAI Native and Codex: stateless (`store: false`,
 * earlier reasoning comes back as encrypted items), the system prompt in `instructions`,
 * the tools in the Responses API shape and parallel tool calls on unless the task turns
 * them off.
 */
export function buildResponsesApiRequestBody(params: ResponsesApiRequestBodyParams): Record<string, any> {
	const { reasoningEffort } = params
	return {
		model: params.modelId,
		input: params.input,
		stream: true,
		store: false,
		instructions: params.instructions,
		...(reasoningEffort ? { include: ["reasoning.encrypted_content"] } : {}),
		...(reasoningEffort
			? {
					reasoning: {
						effort: reasoningEffort,
						...(params.reasoningSummary ? { summary: "auto" as const } : {}),
					},
				}
			: {}),
		...params.settings,
		tools: toResponsesApiTools(params.metadata?.tools),
		tool_choice: params.metadata?.tool_choice,
		parallel_tool_calls: params.metadata?.parallelToolCalls ?? true,
	}
}
