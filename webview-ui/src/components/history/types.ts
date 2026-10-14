import type { HistoryItem, RunningTaskStatus } from "@tumble-code/types"

/**
 * Extended HistoryItem with display-related fields for search highlighting and subtask indication
 */
export interface DisplayHistoryItem extends HistoryItem {
	/** HTML string with search match highlighting */
	highlight?: string
	/** Whether this task is a subtask (has a parent in the current task list) */
	isSubtask?: boolean
	/** Set while the task is working (`runningTasks` in the extension state); absent at rest */
	runningStatus?: RunningTaskStatus
	/** Own usage plus that of every subtask at any depth; set only on a task with subtasks */
	subtree?: SubtreeUsage
}

/** Cost and tokens of a task together with all of its subtasks. */
export interface SubtreeUsage {
	cost: number
	tokensIn: number
	tokensOut: number
}

/**
 * The list section a task row belongs to, above the plain rows. A task the
 * user pinned (`pinnedAt`) is "pinned", whether it works or not; otherwise a
 * task that works or waits for the user is "active". A root whose subtask
 * works counts too, because `useTaskSearch` marks every ancestor of a working
 * task.
 */
export type ListSection = "pinned" | "active"

export const listSection = (item: DisplayHistoryItem): ListSection | undefined =>
	item.pinnedAt !== undefined ? "pinned" : item.runningStatus ? "active" : undefined

/** The sections from the top of a list down; rows in no section come last. */
const SECTION_ORDER: readonly ListSection[] = ["pinned", "active"]

const sectionRank = (item: DisplayHistoryItem): number => {
	const section = listSection(item)
	return section ? SECTION_ORDER.indexOf(section) : SECTION_ORDER.length
}

/**
 * Comparator that moves the rows of a section in front of the others. The
 * pinned rows go most recently pinned first, so they never move while the
 * user pins nothing. Array sort is stable, so the other rows of one section
 * keep the order they had before (the chosen sort option).
 */
export const bySection = (a: DisplayHistoryItem, b: DisplayHistoryItem): number =>
	sectionRank(a) - sectionRank(b) || (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)

/**
 * A node in the subtask tree, representing a task and its recursively nested children.
 */
export interface SubtaskTreeNode {
	/** The task at this tree node */
	item: DisplayHistoryItem
	/** Recursively nested child subtasks */
	children: SubtaskTreeNode[]
	/** Whether this node's children are expanded in the UI */
	isExpanded: boolean
}

/**
 * Recursively counts all subtasks in a tree of SubtaskTreeNodes.
 */
export function countAllSubtasks(nodes: SubtaskTreeNode[]): number {
	let count = 0
	for (const node of nodes) {
		count += 1 + countAllSubtasks(node.children)
	}
	return count
}

/**
 * A group of tasks consisting of a parent task and its nested subtask tree
 */
export interface TaskGroup {
	/** The parent task */
	parent: DisplayHistoryItem
	/** Tree of subtasks (supports arbitrary nesting depth) */
	subtasks: SubtaskTreeNode[]
	/** Whether the subtask list is expanded */
	isExpanded: boolean
}

/**
 * Result from the useGroupedTasks hook
 */
export interface GroupedTasksResult {
	/** Groups of tasks (parent + subtasks) - used in normal view */
	groups: TaskGroup[]
	/** Flat list of tasks with isSubtask flag - used in search mode */
	flatTasks: DisplayHistoryItem[] | null
	/** Function to toggle expand/collapse state of a group */
	toggleExpand: (taskId: string) => void
	/** Whether search mode is active */
	isSearchMode: boolean
}
