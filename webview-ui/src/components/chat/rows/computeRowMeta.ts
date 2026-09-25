import type { ClineMessage, TodoItem } from "@roo-code/types"

import { parseToolCached } from "./parseToolCached"

/** What a row needs to know about the history around it. */
export interface RowMetaEntry {
	/** ts of the next message in the history: the end time of the row's block. */
	nextTs: number | undefined
	/** Todos of the latest updateTodoList ask with an earlier ts ([] when none). */
	previousTodos: readonly TodoItem[]
	/** For a newTask ask: its position among the newTask asks, which indexes the task's childIds. */
	newTaskIndex: number | undefined
	/** The next message in the history is a subtask_result. */
	followedBySubtaskResult: boolean
}

export interface RowMeta {
	/** Indices into `rows` of the checkpoint_saved rows, in order. */
	checkpointIndices: number[]
	/** Meta per row, by the row's ts. */
	byTs: ReadonlyMap<number, RowMetaEntry>
}

const NO_TODOS: readonly TodoItem[] = []

/**
 * Derive the per-row meta ChatRow needs from the history around it, once for
 * all rows instead of each row scanning `clineMessages`. `history` is the full `clineMessages` array
 * (task message included, nothing combined), `rows` is what the list renders.
 * Messages are looked up by ts; when two share a ts the first one counts.
 */
export function computeRowMeta(history: readonly ClineMessage[], rows: readonly ClineMessage[]): RowMeta {
	const indexByTs = new Map<number, number>()
	const newTaskIndexByTs = new Map<number, number>()
	const todoUpdates: { ts: number; todos: readonly TodoItem[] }[] = []
	let newTaskCount = 0

	history.forEach((message, index) => {
		if (!indexByTs.has(message.ts)) {
			indexByTs.set(message.ts, index)
		}
		if (message.type !== "ask" || message.ask !== "tool") {
			return
		}
		const tool = parseToolCached(message)
		if (tool?.tool === "updateTodoList") {
			todoUpdates.push({ ts: message.ts, todos: (tool.todos as TodoItem[] | undefined) || NO_TODOS })
		} else if (tool?.tool === "newTask") {
			if (!newTaskIndexByTs.has(message.ts)) {
				newTaskIndexByTs.set(message.ts, newTaskCount)
			}
			newTaskCount++
		}
	})

	const previousTodosBefore = (ts: number): readonly TodoItem[] => {
		// Todo updates are few; walk them from the latest back.
		for (let i = todoUpdates.length - 1; i >= 0; i--) {
			if (todoUpdates[i].ts < ts) {
				return todoUpdates[i].todos
			}
		}
		return NO_TODOS
	}

	const checkpointIndices: number[] = []
	const byTs = new Map<number, RowMetaEntry>()

	rows.forEach((row, rowIndex) => {
		if (row.say === "checkpoint_saved") {
			checkpointIndices.push(rowIndex)
		}
		const index = indexByTs.get(row.ts)
		const next = index === undefined ? undefined : history[index + 1]
		byTs.set(row.ts, {
			nextTs: next?.ts,
			previousTodos: previousTodosBefore(row.ts),
			newTaskIndex: newTaskIndexByTs.get(row.ts),
			followedBySubtaskResult: next?.type === "say" && next.say === "subtask_result",
		})
	})

	return { checkpointIndices, byTs }
}
