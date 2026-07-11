import * as os from "os"
import * as path from "path"

import { worktreeService } from "@roo-code/core"
import { RooCodeEventName, type ExtensionState } from "@roo-code/types"

import { Task, type AutoApprovalOverride } from "../task/Task"
import { buildSubagentApprovalPolicy } from "../task/subagentApproval"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import type { AutoApprovalState, AutoApprovalStateOptions } from "../auto-approval"

/** One requested subtask. */
export interface ParallelSubtask {
	message: string
	mode?: string | null
}

/** A subtask after validation/normalization (mode resolved to a concrete slug). */
export interface NormalizedSubtask {
	message: string
	mode: string
}

interface RunParallelTasksParams {
	subtasks: ParallelSubtask[]
	maxConcurrency?: number | null
}

/** Outcome of a single subtask run, used for the aggregated report. */
export interface ParallelSubtaskResult {
	index: number
	mode: string
	status: "completed" | "failed" | "cancelled"
	worktreePath?: string
	branch?: string
	message?: string
	error?: string
}

const DEFAULT_MODE = "code"
const DEFAULT_MAX_CONCURRENCY = 3
/** Turn cap per subagent — a runaway backstop, generous enough for real work. */
export const SUBAGENT_MAX_TURNS = 50

/**
 * Validate & normalize the raw tool args. Returns either normalized subtasks +
 * concurrency, or an error string describing what's wrong.
 */
export function validateParallelParams(
	params: Partial<RunParallelTasksParams> | undefined,
): { ok: true; subtasks: NormalizedSubtask[]; maxConcurrency: number } | { ok: false; error: string } {
	const raw = params?.subtasks
	if (!Array.isArray(raw) || raw.length === 0) {
		return { ok: false, error: "run_parallel_tasks requires a non-empty `subtasks` array." }
	}
	const subtasks: NormalizedSubtask[] = []
	for (let i = 0; i < raw.length; i++) {
		const message = raw[i]?.message
		if (typeof message !== "string" || message.trim().length === 0) {
			return { ok: false, error: `Subtask #${i + 1} is missing a non-empty \`message\`.` }
		}
		subtasks.push({ message, mode: raw[i]?.mode || DEFAULT_MODE })
	}
	let maxConcurrency = params?.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
	if (typeof maxConcurrency !== "number" || !Number.isFinite(maxConcurrency) || maxConcurrency < 1) {
		maxConcurrency = DEFAULT_MAX_CONCURRENCY
	}
	return { ok: true, subtasks, maxConcurrency: Math.min(Math.floor(maxConcurrency), subtasks.length) }
}

/**
 * Run `items` through `worker` with at most `limit` running concurrently,
 * preserving input order in the returned results. A worker that throws yields
 * that slot's rejection via `onError` (never rejects the pool).
 */
export async function runWithConcurrency<T, R>(
	items: ReadonlyArray<T>,
	limit: number,
	worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length)
	let next = 0
	const runNext = async (): Promise<void> => {
		const current = next++
		if (current >= items.length) return
		results[current] = await worker(items[current], current)
		await runNext()
	}
	const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => runNext())
	await Promise.all(runners)
	return results
}

/** Render the per-subtask outcomes into a single delimited tool result. */
export function formatParallelResults(results: ReadonlyArray<ParallelSubtaskResult>): string {
	const completed = results.filter((r) => r.status === "completed").length
	const failed = results.filter((r) => r.status === "failed").length
	const cancelled = results.filter((r) => r.status === "cancelled").length

	const summaryParts = [`${completed} completed`, `${failed} failed`]
	if (cancelled > 0) summaryParts.push(`${cancelled} cancelled`)
	const lines: string[] = [
		`Ran ${results.length} parallel subtask(s): ${summaryParts.join(", ")}.`,
		"Worktrees and branches are left intact for review; nothing was merged.",
		"",
	]
	for (const r of results) {
		lines.push(`### Subtask ${r.index + 1} — ${r.status.toUpperCase()} (${r.mode} mode)`)
		if (r.worktreePath) lines.push(`- worktree: ${r.worktreePath}${r.branch ? ` (branch: ${r.branch})` : ""}`)
		if (r.status === "completed") {
			lines.push("", r.message?.trim() || "(no result message)")
		} else if (r.status === "cancelled") {
			lines.push("", "Cancelled before completion.")
		} else {
			lines.push("", `Failed: ${r.error ?? "unknown error"}`)
		}
		lines.push("", "---", "")
	}
	return lines.join("\n").trimEnd()
}

/** Deterministic worktree dir + branch for a given parent task and subtask index. */
export function worktreeNamesFor(
	cwd: string,
	parentTaskId: string,
	index: number,
): { worktreePath: string; branch: string } {
	const project = path.basename(cwd) || "project"
	const shortId = parentTaskId.slice(0, 8)
	const tag = `${project}-${shortId}-${index + 1}`
	return {
		worktreePath: path.join(os.homedir(), ".roo", "worktrees", tag),
		branch: `worktree/parallel-${shortId}-${index + 1}`,
	}
}

/** State slice consumed by `checkAutoApproval` via the subagent approval policy. */
type ApprovalState = Pick<ExtensionState, AutoApprovalState | AutoApprovalStateOptions>

/** Provider surface needed by a single subtask worker. */
interface SubtaskProvider {
	createBackgroundTask(
		text: string,
		options: {
			taskMode?: string
			workspacePath?: string
			maxAgentTurns?: number
			autoApprovalOverride?: AutoApprovalOverride
			silentWrites?: boolean
		},
	): Promise<Task>
	awaitTaskCompletion(
		task: Task,
		options: { signal?: AbortSignal },
	): Promise<{ completed: boolean; lastMessage?: string; writtenPaths: string[] }>
	getState(): Promise<ApprovalState>
}

/** Arguments for {@link runOneSubtask}. */
interface RunOneSubtaskArgs {
	provider: SubtaskProvider
	cwd: string
	parentTaskId: string
	subtask: NormalizedSubtask
	index: number
	signal: AbortSignal
}

/**
 * Run a single subtask: create its worktree, spawn a headless child, and await
 * completion. Checks `signal.aborted` before each side-effecting step so that
 * a parent abort cancels pending workers without orphaning children.
 */
async function runOneSubtask({
	provider,
	cwd,
	parentTaskId,
	subtask,
	index,
	signal,
}: RunOneSubtaskArgs): Promise<ParallelSubtaskResult> {
	const { worktreePath, branch } = worktreeNamesFor(cwd, parentTaskId, index)

	if (signal.aborted) {
		return { index, mode: subtask.mode, status: "cancelled" }
	}

	try {
		const created = await worktreeService.createWorktree(cwd, {
			path: worktreePath,
			branch,
			createNewBranch: true,
		})
		if (!created.success) {
			return {
				index,
				mode: subtask.mode,
				status: "failed",
				error: `worktree creation failed: ${created.message}`,
			}
		}

		if (signal.aborted) {
			return { index, mode: subtask.mode, status: "cancelled", worktreePath, branch }
		}

		const child = await provider.createBackgroundTask(subtask.message, {
			taskMode: subtask.mode,
			workspacePath: worktreePath,
			maxAgentTurns: SUBAGENT_MAX_TURNS,
			// Subagents follow the user's auto-approval settings; worktree
			// writes and reads are pre-approved; anything that would ask the
			// user is denied (a headless child has no user to ask).
			autoApprovalOverride: buildSubagentApprovalPolicy({
				getState: () => provider.getState(),
				worktreePath,
			}),
		})
		const outcome = await provider.awaitTaskCompletion(child, { signal })

		if (!outcome.completed && signal.aborted) {
			return { index, mode: subtask.mode, status: "cancelled", worktreePath, branch }
		}
		return {
			index,
			mode: subtask.mode,
			status: outcome.completed ? "completed" : "failed",
			worktreePath,
			branch,
			message: outcome.lastMessage,
			error: outcome.completed ? undefined : "subtask aborted before completion",
		}
	} catch (error) {
		return {
			index,
			mode: subtask.mode,
			status: "failed",
			worktreePath,
			branch,
			error: error instanceof Error ? error.message : String(error),
		}
	}
}

export class RunParallelTasksTool extends BaseTool<"run_parallel_tasks"> {
	readonly name = "run_parallel_tasks" as const

	async execute(params: RunParallelTasksParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			const validated = validateParallelParams(params)
			if (!validated.ok) {
				task.consecutiveMistakeCount++
				task.recordToolError("run_parallel_tasks")
				task.didToolFailInCurrentTurn = true
				pushToolResult(formatResponse.toolError(validated.error))
				return
			}
			task.consecutiveMistakeCount = 0

			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			const cwd = task.cwd
			if (!(await worktreeService.checkGitRepo(cwd))) {
				pushToolResult(
					formatResponse.toolError(
						"run_parallel_tasks requires a git repository (each subtask runs in its own worktree). " +
							"The current workspace is not a git repo.",
					),
				)
				return
			}

			const { subtasks, maxConcurrency } = validated
			const approvalMessage = JSON.stringify({
				tool: "runParallelTasks",
				count: subtasks.length,
				maxConcurrency,
				subtasks: subtasks.map((s) => ({ mode: s.mode, message: s.message })),
			})
			const didApprove = await askApproval("tool", approvalMessage)
			if (!didApprove) return

			if (task.abort) {
				pushToolResult(formatResponse.toolError("run_parallel_tasks cancelled."))
				return
			}

			const controller = new AbortController()
			const onParentAborted = () => controller.abort()
			task.on(RooCodeEventName.TaskAborted, onParentAborted)
			try {
				const results = await runWithConcurrency(subtasks, maxConcurrency, (subtask, index) =>
					runOneSubtask({
						provider,
						cwd,
						parentTaskId: task.taskId,
						subtask,
						index,
						signal: controller.signal,
					}),
				)
				pushToolResult(formatParallelResults(results))
			} finally {
				task.off(RooCodeEventName.TaskAborted, onParentAborted)
			}
		} catch (error) {
			await handleError("running parallel tasks", error)
		}
	}

	override async handlePartial(_task: Task, _block: ToolUse<"run_parallel_tasks">): Promise<void> {
		// No streaming card — the fan-out only acts once args are complete.
	}
}

export const runParallelTasksTool = new RunParallelTasksTool()
