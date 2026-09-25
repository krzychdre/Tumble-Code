import type { ClineMessage, TodoItem } from "@roo-code/types"

import { getLatestTodo } from "@roo/todo"

/**
 * The todo list the chat shows: the latest updateTodoList payload in the
 * history, or the todos the task started with (a new subtask) while the
 * history has none yet.
 */
export function selectLatestTodos(messages: ClineMessage[], currentTaskTodos: TodoItem[] | undefined) {
	// First check if we have initial todos from the state (for new subtasks)
	if (currentTaskTodos && currentTaskTodos.length > 0) {
		// Check if there are any todo updates in messages
		const messageBasedTodos = getLatestTodo(messages)
		// If there are message-based todos, they take precedence (user has updated them)
		if (messageBasedTodos && messageBasedTodos.length > 0) {
			return messageBasedTodos
		}
		// Otherwise use the initial todos from state
		return currentTaskTodos
	}
	// Fall back to extracting from messages
	return getLatestTodo(messages)
}
