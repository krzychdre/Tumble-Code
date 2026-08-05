import { memo } from "react"

import type { ToolData, TUIMessage } from "../types.js"
import { extractToolData } from "../utils/tools.js"

import TodoDisplay from "./TodoDisplay.js"
import { getToolRenderer } from "./tools/index.js"
import GenericTool from "./tools/GenericTool.js"

import AssistantMessage from "./messages/AssistantMessage.js"
import SystemMessage from "./messages/SystemMessage.js"
import ThinkingMessage from "./messages/ThinkingMessage.js"
import UserMessage from "./messages/UserMessage.js"

interface ChatHistoryItemProps {
	message: TUIMessage
}

/**
 * Try to parse raw JSON content into structured ToolData so legacy tool
 * messages (added without a pre-built toolData field) still render with
 * the correct specialized renderer and extracted path/badges.
 */
function tryExtractToolData(content: string, toolName?: string): ToolData | null {
	try {
		const parsed = JSON.parse(content) as Record<string, unknown>
		const data = extractToolData(parsed)
		// Prefer the message-level toolName when the JSON lacks one
		if (!data.tool || data.tool === "unknown") {
			data.tool = toolName || "unknown"
		}
		return data
	} catch {
		return null
	}
}

/**
 * Thin dispatcher: role → component. Tool messages route to the todo
 * special-case, a structured toolData renderer, or the GenericTool fallback.
 */
function ChatHistoryItem({ message }: ChatHistoryItemProps) {
	switch (message.role) {
		case "user":
			return <UserMessage content={message.content} />
		case "assistant":
			return <AssistantMessage content={message.content} addMargin={true} />
		case "thinking":
			return <ThinkingMessage />
		case "system":
			return <SystemMessage content={message.content} />
		case "tool": {
			// Special rendering for update_todo_list tool — show full TODO list
			if (
				(message.toolName === "update_todo_list" || message.toolName === "updateTodoList") &&
				message.todos &&
				message.todos.length > 0
			) {
				return <TodoDisplay todos={message.todos} previousTodos={message.previousTodos} showProgress={true} />
			}

			// Structured tool renderers when toolData is available
			if (message.toolData) {
				const ToolRenderer = getToolRenderer(message.toolData.tool)
				return <ToolRenderer toolData={message.toolData} rawContent={message.content} message={message} />
			}

			// Legacy fallback: try to extract toolData from raw JSON content,
			// then route through the specialized renderer if extraction succeeds.
			const extracted = tryExtractToolData(message.content, message.toolName)
			if (extracted) {
				const ToolRenderer = getToolRenderer(extracted.tool)
				return <ToolRenderer toolData={extracted} rawContent={message.content} message={message} />
			}

			// Final fallback for non-JSON content
			return (
				<GenericTool
					toolData={{ tool: message.toolName || "unknown", content: message.content }}
					rawContent={message.content}
					message={message}
				/>
			)
		}
		default:
			return null
	}
}

export default memo(ChatHistoryItem)
