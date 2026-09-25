import type { ClineMessage, TodoItem } from "@roo-code/types"

import { getLatestTodo } from "@roo/todo"

import { parseToolCached } from "./rows/parseToolCached"

/**
 * The todo list the chat shows: the latest updateTodoList payload in the
 * history, or the todos the task started with (a new subtask) while the
 * history has none yet.
 *
 * Runs on every streamed token, so it parses through the row pipeline's cache:
 * an unchanged tool message is never parsed twice.
 */
export function selectLatestTodos(messages: ClineMessage[], currentTaskTodos: TodoItem[] | undefined) {
	const messageBasedTodos = getLatestTodo(messages, parseToolCached)
	// Todos from the history take precedence (the model or the user updated them).
	if (messageBasedTodos.length > 0) {
		return messageBasedTodos
	}
	// Otherwise the todos a new subtask started with, when there are any.
	if (currentTaskTodos && currentTaskTodos.length > 0) {
		return currentTaskTodos
	}
	return messageBasedTodos
}
