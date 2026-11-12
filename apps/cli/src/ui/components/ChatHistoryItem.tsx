import { memo } from "react"

import type { TUIMessage } from "../types.js"

import TodoDisplay from "./TodoDisplay.js"
import { getToolRenderer } from "./tools/index.js"
import { GenericTool } from "./tools/GenericTool.js"

import AssistantMessage from "./messages/AssistantMessage.js"
import SystemMessage from "./messages/SystemMessage.js"
import ThinkingMessage from "./messages/ThinkingMessage.js"
import UserMessage from "./messages/UserMessage.js"

interface ChatHistoryItemProps {
	message: TUIMessage
	/**
	 * Verbose rendering: lift the tool renderers' preview caps and print the
	 * reasoning body. `<Static>` items set it freely. `DynamicTailMessage`
	 * sets it only on a message whose growing body it has already cut to the
	 * tail's row budget (plans: 2026-09-21 answer lost in dynamic tail, I1;
	 * 2026-09-23 cli live block under ctrl+o).
	 */
	expanded?: boolean
}

/**
 * Thin dispatcher: role → component. Tool messages route to the todo
 * special-case, a structured toolData renderer, or the GenericTool fallback.
 */
function ChatHistoryItem({ message, expanded = false }: ChatHistoryItemProps) {
	switch (message.role) {
		case "user":
			return <UserMessage content={message.content} />
		case "assistant":
			return <AssistantMessage content={message.content} addMargin={true} />
		case "thinking":
			return <ThinkingMessage content={message.content} expanded={expanded} />
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
				return (
					<ToolRenderer
						toolData={message.toolData}
						rawContent={message.content}
						message={message}
						expanded={expanded}
					/>
				)
			}

			// The reducer attaches toolData to every tool row it ships
			return (
				<GenericTool
					toolData={{ tool: message.toolName || "unknown", content: message.content }}
					rawContent={message.content}
					message={message}
					expanded={expanded}
				/>
			)
		}
		default:
			return null
	}
}

export default memo(ChatHistoryItem)
