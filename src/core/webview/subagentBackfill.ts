import type { ClineMessage, HistoryItem, SubagentSummary } from "@tumble-code/types"

import { subagentDescription } from "../tools/RunParallelTasksTool"

/**
 * Rebuilding the subagent panel rows of a reopened task that its sidecar
 * (`subagents.json`) does not cover. Until 2026-10-18 every fan-out
 * overwrote the sidecar, so a task that fanned out several times kept only
 * its last run there; its `parallelChildIds` and the children's own history
 * items still name every subagent. Old rows carry no run id either: it is
 * worked out from the parent's `runParallelTasks` approval asks.
 */

/** Creation time (ms) of a UUIDv7 task id (its first 48 bits), or undefined for another id. */
export function uuidv7Time(id: string): number | undefined {
	const hex = id.replace(/-/g, "")
	if (!/^[0-9a-f]{32}$/i.test(hex) || hex[12] !== "7") return undefined
	return parseInt(hex.slice(0, 12), 16)
}

/** When each `run_parallel_tasks` call of a task started: the ts of its approval asks, ascending. */
export function fanOutStartTimes(messages: readonly ClineMessage[]): number[] {
	const starts: number[] = []
	for (const message of messages) {
		if (message.type !== "ask" || message.ask !== "tool" || !message.text) continue
		try {
			if (JSON.parse(message.text)?.tool === "runParallelTasks") starts.push(message.ts)
		} catch {
			// Not a tool payload.
		}
	}
	return starts.sort((a, b) => a - b)
}

/**
 * The run id of a subagent created at `createdAt`: the latest fan-out that
 * started before it. Uses the scheme of `newFanOutRunId` (start time in base
 * 36), so worked-out ids sort with real ones.
 */
function runIdAt(createdAt: number, fanOutStarts: readonly number[]): string | undefined {
	let start: number | undefined
	for (const candidate of fanOutStarts) {
		if (candidate > createdAt) break
		start = candidate
	}
	return start === undefined ? undefined : start.toString(36)
}

/** A panel row for a finished subagent from its history item. */
function summaryFromHistoryItem(item: HistoryItem, parentTaskId: string): SubagentSummary {
	const startedAt = uuidv7Time(item.id) ?? item.ts
	return {
		taskId: item.id,
		parentTaskId,
		index: 0,
		mode: item.mode ?? "code",
		description: subagentDescription(item.task),
		// The history keeps whether it finished, not how it ended otherwise.
		status: item.outcome === "completed" ? "completed" : "failed",
		apiConfigName: item.apiConfigName,
		tokensIn: item.tokensIn,
		tokensOut: item.tokensOut,
		totalCost: item.totalCost,
		startedAt,
		lastActivityAt: item.ts,
	}
}

/**
 * The rows of every subagent of `parentTaskId`: the `saved` ones, plus one
 * from the history item of each child in `childHistoryItems` (the children
 * the sidecar lacks). Rows without a run id get the run they were created
 * in; a rebuilt row's index is its place among its run's rows.
 */
export function completeSubagentRows(
	parentTaskId: string,
	saved: readonly SubagentSummary[],
	childHistoryItems: readonly HistoryItem[],
	fanOutStarts: readonly number[],
): SubagentSummary[] {
	const withRun = (row: SubagentSummary): SubagentSummary =>
		row.runId !== undefined
			? row
			: { ...row, runId: runIdAt(uuidv7Time(row.taskId) ?? row.startedAt, fanOutStarts) }
	const rows = saved.map(withRun)
	const rebuilt = childHistoryItems
		.map((item) => withRun(summaryFromHistoryItem(item, parentTaskId)))
		.sort((a, b) => a.startedAt - b.startedAt)
	const nextIndex = new Map<string | undefined, number>()
	for (const row of rows) {
		nextIndex.set(row.runId, Math.max(nextIndex.get(row.runId) ?? 0, row.index + 1))
	}
	for (const row of rebuilt) {
		const index = nextIndex.get(row.runId) ?? 0
		nextIndex.set(row.runId, index + 1)
		rows.push({ ...row, index })
	}
	return rows
}
