import { memo } from "react"
import { Box, Text } from "ink"

import type { TodoItem } from "@roo-code/types"

import { figures } from "../figures.js"
import * as theme from "../theme.js"
import Bullet from "./primitives/Bullet.js"

interface TodoChangeDisplayProps {
	/** Previous TODO list for comparison */
	previousTodos: TodoItem[]
	/** New TODO list */
	newTodos: TodoItem[]
}

/**
 * TodoChangeDisplay — Claude-style checklist for the changed-items view.
 *
 *   ● TODO Updated  (1/3)
 *     ☒ Task 1  [done]
 *     ☐ Task 2  [started]
 */
function TodoChangeDisplay({ previousTodos, newTodos }: TodoChangeDisplayProps) {
	if (!newTodos || newTodos.length === 0) {
		return null
	}

	const isInitialState = previousTodos.length === 0

	let todosToDisplay: TodoItem[]

	if (isInitialState) {
		todosToDisplay = newTodos
	} else {
		todosToDisplay = newTodos.filter((newTodo) => {
			if (newTodo.status === "completed") {
				const previousTodo = previousTodos.find((p) => p.id === newTodo.id || p.content === newTodo.content)
				return !previousTodo || previousTodo.status !== "completed"
			}
			if (newTodo.status === "in_progress") {
				const previousTodo = previousTodos.find((p) => p.id === newTodo.id || p.content === newTodo.content)
				return !previousTodo || previousTodo.status !== "in_progress"
			}
			return false
		})
	}

	if (todosToDisplay.length === 0) {
		return null
	}

	const totalCount = newTodos.length
	const completedCount = newTodos.filter((t) => t.status === "completed").length
	const headerLabel = isInitialState ? "TODO List" : "TODO Updated"

	return (
		<Box flexDirection="column">
			{/* Header */}
			<Box>
				<Bullet status="plain" />
				<Box flexDirection="column" flexGrow={1}>
					<Box>
						<Text bold color={theme.text}>
							{headerLabel}
						</Text>
						<Text dimColor color={theme.secondaryText}>
							{" "}
							({completedCount}/{totalCount})
						</Text>
					</Box>
				</Box>
			</Box>

			{/* Changed items */}
			<Box flexDirection="column" paddingLeft={2}>
				{todosToDisplay.map((todo, index) => {
					const checkbox = todo.status === "completed" ? figures.checkboxOn : figures.checkboxOff

					// Determine what changed
					const previousTodo = previousTodos.find((p) => p.id === todo.id || p.content === todo.content)
					let changeLabel: string | null = null

					if (isInitialState) {
						changeLabel = null
					} else if (!previousTodo) {
						changeLabel = "new"
					} else if (todo.status === "completed" && previousTodo.status !== "completed") {
						changeLabel = "done"
					} else if (todo.status === "in_progress" && previousTodo.status !== "in_progress") {
						changeLabel = "started"
					}

					return (
						<Box key={todo.id || `todo-${index}`}>
							<Text>
								{checkbox}{" "}
								{todo.status === "completed" ? (
									<Text dimColor strikethrough color={theme.subtle}>
										{todo.content}
									</Text>
								) : todo.status === "in_progress" ? (
									<Text bold color={theme.warning}>
										{todo.content}
									</Text>
								) : (
									<Text color={theme.text}>{todo.content}</Text>
								)}
								{changeLabel && (
									<Text dimColor color={theme.secondaryText}>
										{" "}
										[{changeLabel}]
									</Text>
								)}
							</Text>
						</Box>
					)
				})}
			</Box>
		</Box>
	)
}

export default memo(TodoChangeDisplay)
