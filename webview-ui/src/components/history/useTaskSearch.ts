import { useState, useEffect, useMemo } from "react"
import { Fzf } from "fzf"

import type { HistoryItem, RunningTaskStatus } from "@tumble-code/types"

import { highlightFzfMatch } from "@/utils/highlight"
import { useExtensionSelector } from "@/context/ExtensionStateContext"

import type { DisplayHistoryItem, SubtreeUsage } from "./types"

type SortOption = "newest" | "oldest" | "mostExpensive" | "mostTokens" | "mostRelevant"

// Stable fallback so a state without the map does not change the memo inputs.
const NO_RUNNING_TASKS: Record<string, RunningTaskStatus> = {}

/**
 * The host reports the tasks that work themselves; a parent that delegated
 * waits for its subtask and is absent. Each working task also marks its
 * ancestors up to the root, so the root row shows that its tree works.
 * A subtask waiting for the user wins over one that only runs.
 */
function withAncestors(
	runningTasks: Record<string, RunningTaskStatus>,
	taskHistory: HistoryItem[],
): Record<string, RunningTaskStatus> {
	const parentOf = new Map<string, string>()
	for (const item of taskHistory) {
		if (item.parentTaskId) {
			parentOf.set(item.id, item.parentTaskId)
		}
	}
	const marked = { ...runningTasks }
	for (const [taskId, status] of Object.entries(runningTasks)) {
		const seen = new Set([taskId])
		for (let id = parentOf.get(taskId); id && !seen.has(id); id = parentOf.get(id)) {
			seen.add(id)
			if (marked[id] !== "awaiting_input") {
				marked[id] = status
			}
		}
	}
	return marked
}

const NO_USAGE: SubtreeUsage = { cost: 0, tokensIn: 0, tokensOut: 0 }

const ownUsage = (item: HistoryItem): SubtreeUsage => ({
	cost: item.totalCost || 0,
	tokensIn: item.tokensIn || 0,
	tokensOut: item.tokensOut || 0,
})

/**
 * A task saves only the cost and tokens of its own API requests. The usage of
 * a task that delegated is its own plus that of every descendant, at any
 * depth, so this sums the tree from the full history (the workspace filter
 * must not cut a subtree). Only tasks with children get an entry.
 */
function subtreeUsages(taskHistory: HistoryItem[]): Map<string, SubtreeUsage> {
	const childrenOf = new Map<string, HistoryItem[]>()
	for (const item of taskHistory) {
		if (item.parentTaskId && item.parentTaskId !== item.id) {
			const siblings = childrenOf.get(item.parentTaskId) ?? []
			siblings.push(item)
			childrenOf.set(item.parentTaskId, siblings)
		}
	}
	const totals = new Map<string, SubtreeUsage>()
	const visiting = new Set<string>()
	const sum = (item: HistoryItem): SubtreeUsage => {
		const known = totals.get(item.id)
		if (known !== undefined) {
			return known
		}
		// A parent cycle in corrupt history: the task is already counted further up.
		if (visiting.has(item.id)) {
			return NO_USAGE
		}
		const children = childrenOf.get(item.id)
		if (!children) {
			return ownUsage(item)
		}
		visiting.add(item.id)
		const total = ownUsage(item)
		for (const child of children) {
			const usage = sum(child)
			total.cost += usage.cost
			total.tokensIn += usage.tokensIn
			total.tokensOut += usage.tokensOut
		}
		visiting.delete(item.id)
		totals.set(item.id, total)
		return total
	}
	for (const item of taskHistory) {
		sum(item)
	}
	return totals
}

/**
 * The tasks shown for workspace `cwd`: those of the workspace and every
 * descendant of one, whatever workspace the descendant recorded, so a subtask
 * never vanishes from under its parent. Each task is judged once (memoized up
 * the parent chain from the full history), so this stays linear.
 */
function inWorkspace(taskHistory: HistoryItem[], cwd: string | undefined): (item: HistoryItem) => boolean {
	const byId = new Map(taskHistory.map((item) => [item.id, item]))
	const known = new Map<string, boolean>()
	const judge = (item: HistoryItem): boolean => {
		const chain = new Set<string>()
		let verdict = false
		for (let current: HistoryItem | undefined = item; current; ) {
			const memo = known.get(current.id)
			if (memo !== undefined) {
				verdict = memo
				break
			}
			if (current.workspace === cwd) {
				verdict = true
				chain.add(current.id)
				break
			}
			// A parent cycle in corrupt history ends the walk.
			if (chain.has(current.id)) {
				break
			}
			chain.add(current.id)
			current = current.parentTaskId ? byId.get(current.parentTaskId) : undefined
		}
		for (const id of chain) {
			known.set(id, verdict)
		}
		return verdict
	}
	return judge
}

export const useTaskSearch = () => {
	// P1: narrow slices.
	const taskHistory = useExtensionSelector((s) => s.taskHistory)
	const cwd = useExtensionSelector((s) => s.cwd)
	const runningTasks = useExtensionSelector((s) => s.runningTasks) ?? NO_RUNNING_TASKS
	const [searchQuery, setSearchQuery] = useState("")
	const [sortOption, setSortOption] = useState<SortOption>("newest")
	const [lastNonRelevantSort, setLastNonRelevantSort] = useState<SortOption | null>("newest")
	const [showAllWorkspaces, setShowAllWorkspaces] = useState(false)

	useEffect(() => {
		if (searchQuery && sortOption !== "mostRelevant" && !lastNonRelevantSort) {
			setLastNonRelevantSort(sortOption)
			setSortOption("mostRelevant")
		} else if (!searchQuery && sortOption === "mostRelevant" && lastNonRelevantSort) {
			setSortOption(lastNonRelevantSort)
			setLastNonRelevantSort(null)
		}
	}, [searchQuery, sortOption, lastNonRelevantSort])

	const presentableTasks = useMemo((): DisplayHistoryItem[] => {
		let tasks = taskHistory.filter((item) => item.ts && item.task)
		if (!showAllWorkspaces) {
			tasks = tasks.filter(inWorkspace(taskHistory, cwd))
		}
		const totals = subtreeUsages(taskHistory)
		return tasks.map((item) => {
			const subtree = totals.get(item.id)
			return subtree === undefined ? item : { ...item, subtree }
		})
	}, [taskHistory, showAllWorkspaces, cwd])

	const fzf = useMemo(() => {
		return new Fzf(presentableTasks, {
			selector: (item) => item.task,
		})
	}, [presentableTasks])

	const sortedTasks = useMemo(() => {
		let results = presentableTasks

		if (searchQuery) {
			const searchResults = fzf.find(searchQuery)
			results = searchResults.map((result) => {
				const positions = Array.from(result.positions)
				const taskEndIndex = result.item.task.length

				return {
					...result.item,
					highlight: highlightFzfMatch(
						result.item.task,
						positions.filter((p) => p < taskEndIndex),
					),
					workspace: result.item.workspace,
				}
			})
		}

		// Then sort the results
		return [...results].sort((a, b) => {
			switch (sortOption) {
				case "oldest":
					return (a.ts || 0) - (b.ts || 0)
				case "mostExpensive":
					return (b.subtree?.cost ?? (b.totalCost || 0)) - (a.subtree?.cost ?? (a.totalCost || 0))
				case "mostTokens": {
					const aTokens = (a.tokensIn || 0) + (a.tokensOut || 0) + (a.cacheWrites || 0) + (a.cacheReads || 0)
					const bTokens = (b.tokensIn || 0) + (b.tokensOut || 0) + (b.cacheWrites || 0) + (b.cacheReads || 0)
					return bTokens - aTokens
				}
				case "mostRelevant":
					// Keep fuse order if searching, otherwise sort by newest
					return searchQuery ? 0 : (b.ts || 0) - (a.ts || 0)
				case "newest":
				default:
					return (b.ts || 0) - (a.ts || 0)
			}
		})
	}, [presentableTasks, searchQuery, fzf, sortOption])

	// Kept apart from the sort so a status change does not search and sort again;
	// rows of tasks at rest keep their object identity.
	const tasks = useMemo((): DisplayHistoryItem[] => {
		if (Object.keys(runningTasks).length === 0) {
			return sortedTasks
		}
		const marked = withAncestors(runningTasks, taskHistory)
		return sortedTasks.map((item) => {
			const runningStatus = marked[item.id]
			return runningStatus ? { ...item, runningStatus } : item
		})
	}, [sortedTasks, runningTasks, taskHistory])

	return {
		tasks,
		searchQuery,
		setSearchQuery,
		sortOption,
		setSortOption,
		lastNonRelevantSort,
		setLastNonRelevantSort,
		showAllWorkspaces,
		setShowAllWorkspaces,
	}
}
