import type { ClineMessage, HistoryItem, SubagentSummary } from "@tumble-code/types"

import { readTaskMessages } from "../task-persistence"
import { loadSubagentSummaries } from "../task-persistence/subagentSummariesStore"
import { subagentDescription } from "../tools/RunParallelTasksTool"
import { logger } from "../../utils/logging"
import type { SubagentRegistry } from "./SubagentRegistry"

/**
 * Restoring the subagent panel of a reopened task, including the rows its
 * sidecar (`subagents.json`) does not cover. Until 2026-10-18 every fan-out
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

/** What {@link rehydrateSubagents} reads a reopened task's subagents from (the provider). */
export interface SubagentRehydrationHost {
	readonly subagentRegistry: SubagentRegistry
	readonly globalStoragePath: string
	getHistoryItem(id: string): Promise<HistoryItem>
	getCurrentTask(): { taskId: string; clineMessages: ClineMessage[] } | undefined
}

/** A task's chat messages: the live instance's when it is on screen, else from disk. */
async function readParentMessages(host: SubagentRehydrationHost, taskId: string): Promise<ClineMessage[]> {
	const current = host.getCurrentTask()
	if (current?.taskId === taskId && current.clineMessages.length > 0) {
		return current.clineMessages
	}
	return readTaskMessages({ taskId, globalStoragePath: host.globalStoragePath })
}

/**
 * Rehydrate the parallel-subagent panel for a parent task being restored
 * from history or put back on screen. Reads `parallelChildIds` from the
 * parent's history item (the persisted parent->child relation written by
 * `run_parallel_tasks`, one id per subagent of every fan-out), loads the
 * matching summaries from the parent's sidecar
 * (`tasks/<parentId>/subagents.json`), rebuilds a row from the child's own
 * history item for each subagent the sidecar lacks, and merges them into the
 * registry. Rows the registry already holds (a fan-out still running) are
 * kept as they are.
 *
 * Graceful degradation: if `parallelChildIds` is absent (pre-fix history
 * item) or the sidecar is missing/corrupt, the panel shows what can be
 * rebuilt; the task is NOT marked corrupt and no error is thrown.
 *
 * Broadcasts the restored list once. Called after the parent Task is on the
 * stack so the broadcast carries the parent's id as `sourceTaskId`.
 */
export async function rehydrateSubagents(host: SubagentRehydrationHost, historyItem: HistoryItem): Promise<void> {
	const parallelChildIds = historyItem.parallelChildIds
	if (!parallelChildIds || parallelChildIds.length === 0) {
		// Pre-fix history item or a task that never fanned out: nothing to
		// restore. The panel was already cleared at the task boundary.
		return
	}
	const registry = host.subagentRegistry
	try {
		const summaries = await loadSubagentSummaries(host.globalStoragePath, historyItem.id)
		// Only keep summaries whose taskId is in the persisted parent->child
		// list. The sidecar and `parallelChildIds` are written together, but a
		// partially-written sidecar from a crashed run could carry stale
		// entries; this guard keeps the panel honest.
		const allowed = new Set(parallelChildIds)
		const saved = summaries.filter((s) => allowed.has(s.taskId))
		const savedIds = new Set(saved.map((s) => s.taskId))
		const missingIds = parallelChildIds.filter((id) => !savedIds.has(id) && !registry.has(id))
		const childHistoryItems = (
			await Promise.all(missingIds.map((id) => host.getHistoryItem(id).catch(() => undefined)))
		).filter((item): item is HistoryItem => item !== undefined)
		const needsRuns = childHistoryItems.length > 0 || saved.some((s) => s.runId === undefined)
		const restored = completeSubagentRows(
			historyItem.id,
			saved,
			childHistoryItems,
			needsRuns ? fanOutStartTimes(await readParentMessages(host, historyItem.id)) : [],
		)
		registry.restore(historyItem.id, restored)
		registry.broadcast()
	} catch (error) {
		// Sidecar loading is best-effort. A missing/corrupt sidecar must never
		// break rehydration of the parent task itself.
		logger.warn(
			`[rehydrateSubagents] Failed to restore subagents for task ${historyItem.id} (non-fatal): ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}
}
