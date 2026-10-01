import { Anthropic } from "@anthropic-ai/sdk"

import { TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { type GroundingSource } from "../../api/transform/stream"
import { t } from "../../i18n"
import { sanitizeToolUseId } from "../../utils/tool-id"

import { type AssistantMessageContent } from "../assistant-message"
import { type TaskAskSay } from "./TaskAskSay"
import { type TaskMessageLog } from "./TaskMessageLog"
import { logger } from "../../utils/logging"

/**
 * The state the assembler reads and writes on the owning task. Mutable members
 * stay owned by the task (via `TaskStreamProcessorAccess`); this interface is
 * the typed read/write view, the same seam pattern as `TaskApiLoopAccess` (D3).
 */
export interface AssistantMessageAssemblerAccess {
	taskId: string
	assistantMessageContent: AssistantMessageContent[]
	assistantMessageSavedToHistory: boolean
	consecutiveNoAssistantMessagesCount: number
	pushToolResultToUserContent: (toolResult: Anthropic.ToolResultBlockParam) => boolean
	askSay: TaskAskSay
	history: TaskMessageLog
}

/** Snapshot of the streamed text, reasoning and grounding sources of a turn. */
export interface AssistantMessageDraft {
	text: string
	reasoning: string
	groundingSources: GroundingSource[]
}

/**
 * Assembles and saves the assistant message to API conversation history:
 * builds the assistant content array (text plus deduplicated tool_use blocks
 * with sanitized IDs), enforces new_task isolation, and persists the message
 * before tools execute. Extracted from `TaskStreamProcessor` (roadmap S2).
 */
export class AssistantMessageAssembler {
	constructor(private readonly access: AssistantMessageAssemblerAccess) {}

	/**
	 * Assemble and save the assistant message to API conversation history.
	 * Builds the assistant content array for API history, handles tool_use deduplication,
	 * and new_task isolation.
	 */
	async assembleAndSave(draft: AssistantMessageDraft): Promise<void> {
		const { text: assistantText, reasoning: reasoningMessage, groundingSources: pendingGroundingSources } = draft

		// Check if we have any content to process (text or tool uses)
		const hasTextContent = assistantText.length > 0

		const hasToolUses = this.access.assistantMessageContent.some(
			(block) => block.type === "tool_use" || block.type === "mcp_tool_use",
		)

		if (hasTextContent || hasToolUses) {
			// Reset counter when we get a successful response with content
			this.access.consecutiveNoAssistantMessagesCount = 0
			// Display grounding sources to the user if they exist
			if (pendingGroundingSources.length > 0) {
				const citationLinks = pendingGroundingSources.map((source, i) => `[${i + 1}](${source.url})`)
				const sourcesText = `${t("common:gemini.sources")} ${citationLinks.join(", ")}`

				await this.access.askSay.say("text", sourcesText, undefined, false, undefined, undefined, {
					isNonInteractive: true,
				})
			}

			// Build the assistant message content array
			const assistantContent: Array<Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam> = []

			// Add text content if present
			if (assistantText) {
				assistantContent.push({
					type: "text" as const,
					text: assistantText,
				})
			}

			// Add tool_use blocks with their IDs for native protocol
			// This handles both regular ToolUse and McpToolUse types
			// IMPORTANT: Track seen IDs to prevent duplicates in the API request.
			// Duplicate tool_use IDs cause Anthropic API 400 errors:
			// "tool_use ids must be unique"
			const seenToolUseIds = new Set<string>()
			const toolUseBlocks = this.access.assistantMessageContent.filter(
				(block) => block.type === "tool_use" || block.type === "mcp_tool_use",
			)
			for (const block of toolUseBlocks) {
				if (block.type === "mcp_tool_use") {
					// McpToolUse already has the original tool name (e.g., "mcp_serverName_toolName")
					// The arguments are the raw tool arguments (matching the simplified schema)
					const mcpBlock = block as import("../../shared/tools").McpToolUse
					if (mcpBlock.id) {
						const sanitizedId = sanitizeToolUseId(mcpBlock.id)
						// Pre-flight deduplication: Skip if we've already added this ID
						if (seenToolUseIds.has(sanitizedId)) {
							logger.warn(
								`[Task#${this.access.taskId}] Pre-flight deduplication: Skipping duplicate MCP tool_use ID: ${sanitizedId} (tool: ${mcpBlock.name})`,
							)
							continue
						}
						seenToolUseIds.add(sanitizedId)
						assistantContent.push({
							type: "tool_use" as const,
							id: sanitizedId,
							name: mcpBlock.name, // Original dynamic name
							input: mcpBlock.arguments, // Direct tool arguments
						})
					}
				} else {
					// Regular ToolUse
					const toolUse = block as import("../../shared/tools").ToolUse
					const toolCallId = toolUse.id
					if (toolCallId) {
						const sanitizedId = sanitizeToolUseId(toolCallId)
						// Pre-flight deduplication: Skip if we've already added this ID
						if (seenToolUseIds.has(sanitizedId)) {
							logger.warn(
								`[Task#${this.access.taskId}] Pre-flight deduplication: Skipping duplicate tool_use ID: ${sanitizedId} (tool: ${toolUse.name})`,
							)
							continue
						}
						seenToolUseIds.add(sanitizedId)
						// nativeArgs is already in the correct API format for all tools
						const input = toolUse.nativeArgs || toolUse.params

						// Use originalName (alias) if present for API history consistency.
						// When tool aliases are used (e.g., "edit_file" -> "search_and_replace" -> "edit" (current canonical name)),
						// we want the alias name in the conversation history to match what the model
						// was told the tool was named, preventing confusion in multi-turn conversations.
						const toolNameForHistory = toolUse.originalName ?? toolUse.name

						assistantContent.push({
							type: "tool_use" as const,
							id: sanitizedId,
							name: toolNameForHistory,
							input,
						})
					}
				}
			}

			// Enforce new_task isolation: if new_task is called alongside other tools,
			// truncate any tools that come after it and inject error tool_results.
			// This prevents orphaned tools when delegation disposes the parent task.
			const newTaskIndex = assistantContent.findIndex(
				(block) => block.type === "tool_use" && block.name === "new_task",
			)

			if (newTaskIndex !== -1 && newTaskIndex < assistantContent.length - 1) {
				// new_task found but not last - truncate subsequent tools
				const truncatedTools = assistantContent.slice(newTaskIndex + 1)
				assistantContent.length = newTaskIndex + 1 // Truncate API history array

				// ALSO truncate the execution array (assistantMessageContent) to prevent
				// tools after new_task from being executed by presentAssistantMessage().
				// Find new_task index in assistantMessageContent (may differ from assistantContent
				// due to text blocks being structured differently).
				const executionNewTaskIndex = this.access.assistantMessageContent.findIndex(
					(block) => block.type === "tool_use" && block.name === "new_task",
				)
				if (executionNewTaskIndex !== -1) {
					this.access.assistantMessageContent.length = executionNewTaskIndex + 1
				}

				// Pre-inject error tool_results for truncated tools
				for (const tool of truncatedTools) {
					if (tool.type === "tool_use" && (tool as Anthropic.ToolUseBlockParam).id) {
						this.access.pushToolResultToUserContent({
							type: "tool_result",
							tool_use_id: (tool as Anthropic.ToolUseBlockParam).id,
							content:
								"This tool was not executed because new_task was called in the same message turn. The new_task tool must be the last tool in a message.",
							is_error: true,
						})
					}
				}
			}

			// Save assistant message BEFORE executing tools
			// This is critical for new_task: when it triggers delegation, flushPendingToolResultsToHistory()
			// will save the user message with tool_results. The assistant message must already be in history
			// so that tool_result blocks appear AFTER their corresponding tool_use blocks.
			await this.access.history.addToApiConversationHistory(
				{ role: "assistant", content: assistantContent },
				reasoningMessage || undefined,
			)
			this.access.assistantMessageSavedToHistory = true

			TelemetryService.instance.capture(TelemetryEventName.TASK_CONVERSATION_MESSAGE, {
				taskId: this.access.taskId,
				source: "assistant",
			})
		}
	}
}
