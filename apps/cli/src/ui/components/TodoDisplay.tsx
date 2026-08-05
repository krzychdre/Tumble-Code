import { memo } from "react"
import { Box, Text } from "ink"

import type { TodoItem } from "@roo-code/types"

import { figures } from "../figures.js"
import * as theme from "../theme.js"
import ProgressBar from "./ProgressBar.js"
import Bullet from "./primitives/Bullet.js"

interface TodoDisplayProps {
	/** List of TODO items to display */
	todos: TodoItem[]
	/** Previous TODO list for diff comparison (optional) */
	previousTodos?: TodoItem[]
	/** Whether to show the progress bar (default: true) */
	showProgress?: boolean
	/** Whether to show only changed items (default: false) */
	showChangesOnly?: boolean
	/** Title to display in the header (default: "Update Todos") */
	title?: string
}

/**
 * TodoDisplay — Claude-style checklist grammar.
 *
 *   ● Update Todos  (2/5)  [████░░░░] 40%
 *     ☒ done task  [done]
 *     ☐ pending task  [new]
 *     ☐ current task
 */
function TodoDisplay({
	todos,
	previousTodos = [],
	showProgress = true,
	showChangesOnly = false,
	title = "Update Todos",
}: TodoDisplayProps) {
	if (!todos || todos.length === 0) {
		return null
	}

	// Determine which todos to display
	let displayTodos: TodoItem[]

	if (showChangesOnly && previousTodos.length > 0) {
		displayTodos = todos.filter((todo) => {
			const previousTodo = previousTodos.find((p) => p.id === todo.id || p.content === todo.content)
			if (!previousTodo) {
				return true
			}
			return previousTodo.status !== todo.status
		})
	} else {
		displayTodos = todos
	}

	if (showChangesOnly && displayTodos.length === 0) {
		return null
	}

	const totalCount = todos.length
	const completedCount = todos.filter((t) => t.status === "completed").length

	return (
		<Box flexDirection="column" marginBottom={1}>
			{/* Header line: bullet + title + count + progress bar */}
			<Box>
				<Bullet status="plain" />
				<Box flexDirection="column" flexGrow={1}>
					<Box>
						<Text bold color={theme.text}>
							{title}
						</Text>
						<Text dimColor color={theme.secondaryText}>
							{" "}
							({completedCount}/{totalCount})
						</Text>
						{showProgress && (
							<>
								<Text> </Text>
								<ProgressBar value={completedCount} max={totalCount} width={16} />
							</>
						)}
					</Box>
				</Box>
			</Box>

			{/* TODO items */}
			<Box flexDirection="column" paddingLeft={2}>
				{displayTodos.map((todo, index) => {
					const previousTodo = previousTodos.find((p) => p.id === todo.id || p.content === todo.content)
					const statusChanged = previousTodo && previousTodo.status !== todo.status
					const isNew = previousTodos.length > 0 && !previousTodo

					const checkbox = todo.status === "completed" ? figures.checkboxOn : figures.checkboxOff

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
								{statusChanged && (
									<Text dimColor color={theme.secondaryText}>
										{" "}
										[
										{todo.status === "completed"
											? "done"
											: todo.status === "in_progress"
												? "started"
												: "reset"}
										]
									</Text>
								)}
								{isNew && (
									<Text dimColor color={theme.secondaryText}>
										{" "}
										[new]
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

export default memo(TodoDisplay)
