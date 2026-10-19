import * as os from "os"
import * as path from "path"

import { worktreeService } from "@tumble-code/core"
import {
	DEFAULT_PARALLEL_TASKS_MAX_CONCURRENCY,
	isCompactProfile,
	isParallelTasksEnabled,
	subagentSlotsForProfile,
	TumbleCodeEventName,
	type HistoryItem,
	type SubagentSummary,
} from "@tumble-code/types"

import { Task, type AutoApprovalOverride } from "../task/Task"
import { buildSubagentApprovalPolicy, type ApprovalState } from "../task/subagentApproval"
import { queuedSubagentId } from "../webview/SubagentRegistry"
import type { SubagentInfo, SubagentProfile } from "../webview/BackgroundTaskRunner"
import type { BackgroundSubagents } from "../webview/BackgroundSubagents"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import { compactSubagentsOffError } from "./helpers/compactSubagents"
import type { ParallelSubtaskResult } from "./helpers/subagentResults"
import { waitForSubagents } from "./WaitForSubagentsTool"
import type { ToolResponse, ToolUse } from "../../shared/tools"
import { logger } from "../../utils/logging"

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

const DEFAULT_MODE = "code"
const DEFAULT_MAX_CONCURRENCY = DEFAULT_PARALLEL_TASKS_MAX_CONCURRENCY

/**
 * Modes that are never allowed for a parallel subtask. Subtasks are small
 * one-shot jobs; architecture/planning and orchestration are serious,
 * long-horizon work that belongs in the parent task itself.
 */
export const DISALLOWED_SUBTASK_MODES = ["architect", "orchestrator"] as const

/**
 * Validate & normalize the raw tool args. Returns either normalized subtasks +
 * concurrency, or an error string describing what's wrong.
 *
 * `maxConcurrencyCap` is the user's configured hard limit
 * (`parallelTasksMaxConcurrency`): the model-supplied `maxConcurrency` may
 * lower concurrency below it but never exceed it.
 */
export function validateParallelParams(
	params: Partial<RunParallelTasksParams> | undefined,
	maxConcurrencyCap: number = DEFAULT_MAX_CONCURRENCY,
): { ok: true; subtasks: NormalizedSubtask[]; maxConcurrency: number } | { ok: false; error: string } {
	const raw = params?.subtasks
	// One subtask is fine: it is how a follow-up job starts after a result,
	// while the other subagents keep running.
	if (!Array.isArray(raw) || raw.length === 0) {
		return {
			ok: false,
			error: "run_parallel_tasks requires a non-empty `subtasks` array (one subtask or more).",
		}
	}
	const subtasks: NormalizedSubtask[] = []
	for (let i = 0; i < raw.length; i++) {
		const message = raw[i]?.message
		if (typeof message !== "string" || message.trim().length === 0) {
			return { ok: false, error: `Subtask #${i + 1} is missing a non-empty \`message\`.` }
		}
		const mode = raw[i]?.mode || DEFAULT_MODE
		if ((DISALLOWED_SUBTASK_MODES as readonly string[]).includes(mode)) {
			return {
				ok: false,
				error:
					`Subtask #${i + 1} uses mode "${mode}", which is not allowed for parallel subtasks. ` +
					`Planning and orchestration stay in this task: do the ${mode} work yourself here and give ` +
					`subagents the self-contained jobs it produces (questions, research, test runs, edits).`,
			}
		}
		subtasks.push({ message, mode })
	}
	const cap =
		Number.isFinite(maxConcurrencyCap) && maxConcurrencyCap >= 1
			? Math.floor(maxConcurrencyCap)
			: DEFAULT_MAX_CONCURRENCY
	// No value means the user's cap: the settings (and each profile's
	// maxConcurrentRequests) decide how many subagents run, not the model.
	let maxConcurrency = params?.maxConcurrency ?? cap
	// Below 2 is treated as invalid, not honored: "parallel with concurrency 1"
	// defeats the tool's purpose, so a nonsensical request falls back to the
	// cap instead of degrading the fan-out to a sequential queue.
	if (typeof maxConcurrency !== "number" || !Number.isFinite(maxConcurrency) || maxConcurrency < 2) {
		maxConcurrency = cap
	}
	return { ok: true, subtasks, maxConcurrency: Math.min(Math.floor(maxConcurrency), cap, subtasks.length) }
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

/** A fresh id for one run_parallel_tasks call, so a retry never reuses a name. */
export function newFanOutRunId(): string {
	return Date.now().toString(36)
}

/**
 * Worktree dir + branch for a subtask of one fan-out run. The run id keeps a
 * second fan-out of the same parent clear of worktrees the first one left
 * behind (kept for review, or orphaned by a crash).
 */
export function worktreeNamesFor(
	cwd: string,
	parentTaskId: string,
	runId: string,
	index: number,
): { worktreePath: string; branch: string } {
	const project = path.basename(cwd) || "project"
	const shortId = parentTaskId.slice(0, 8)
	const tag = `${project}-${shortId}-${runId}-${index + 1}`
	return {
		worktreePath: path.join(os.homedir(), ".roo", "worktrees", tag),
		branch: `worktree/parallel-${shortId}-${runId}-${index + 1}`,
	}
}

const SUBTASK_LOCK_PREFIX = "tumble-code parallel subtask, pid "

/**
 * Git lock reason of a subagent worktree while its worker runs. The worker
 * unlocks it in {@link finalize}; a lock that outlives the process that took
 * it marks a worktree orphaned by a crash or a killed extension host.
 */
export function subtaskLockReason(pid: number = process.pid): string {
	return `${SUBTASK_LOCK_PREFIX}${pid}`
}

/** The pid that owns a subagent worktree lock, or undefined for any other lock. */
export function subtaskLockOwner(lockReason: string | undefined): number | undefined {
	if (!lockReason?.startsWith(SUBTASK_LOCK_PREFIX)) return undefined
	const pid = Number(lockReason.slice(SUBTASK_LOCK_PREFIX.length))
	return Number.isInteger(pid) && pid > 0 ? pid : undefined
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		// EPERM: the process exists but belongs to another user.
		return (error as NodeJS.ErrnoException).code === "EPERM"
	}
}

/**
 * Reclaim subagent worktrees whose owning process died before its workers
 * could clean up. Their lock is lifted; the empty ones are removed with
 * their branch, the ones with changes stay for the user to review. Locks
 * held by a live process (this one included) belong to a running fan-out
 * and are left alone. Best-effort: never throws.
 */
export async function sweepOrphanedSubtaskWorktrees(cwd: string): Promise<void> {
	try {
		for (const worktree of await worktreeService.listWorktrees(cwd)) {
			const owner = subtaskLockOwner(worktree.lockReason)
			if (owner === undefined || isProcessAlive(owner)) continue
			await worktreeService.unlockWorktree(cwd, worktree.path)
			if (worktree.branch) {
				await cleanupSubtaskWorktreeIfEmpty({ cwd, worktreePath: worktree.path, branch: worktree.branch })
			}
		}
	} catch (error) {
		logger.warn(
			`[run_parallel_tasks] Orphaned worktree sweep failed in ${cwd}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}
}

/**
 * Remove a subtask's worktree + branch when nothing reviewable was produced.
 * Non-forced remove is a second safety net: git refuses uncommitted changes.
 */
async function cleanupSubtaskWorktreeIfEmpty({
	cwd,
	worktreePath,
	branch,
}: {
	cwd: string
	worktreePath: string
	branch: string
}): Promise<boolean> {
	try {
		if (await worktreeService.hasUncommittedChanges(worktreePath)) return false
		if (await worktreeService.branchHasCommits(cwd, branch)) return false
		const removed = await worktreeService.deleteWorktree(cwd, worktreePath)
		return removed.success
	} catch {
		return false
	}
}

/** Registry surface the fan-out reports lifecycle changes to (webview panel). */
export interface SubtaskRegistry {
	beginFanOut(parentTaskId: string): void
	endFanOut(parentTaskId: string): void
	registerQueued(summary: {
		parentTaskId: string
		runId: string
		index: number
		mode: string
		description: string
		tokensIn: number
		tokensOut: number
		totalCost: number
		startedAt: number
		lastActivityAt: number
	}): void
	markTerminal(taskId: string, status: "completed" | "failed" | "cancelled", finalMessage?: string): void
	get(taskId: string): { status: string } | undefined
	/** Snapshot of one parent's summaries in panel order (for sidecar persistence). */
	snapshot(parentTaskId: string): SubagentSummary[]
}

/** Provider surface needed by a single subtask worker. */
interface SubtaskProvider {
	createBackgroundTask(
		text: string,
		options: {
			taskMode?: string
			workspacePath?: string
			autoApprovalOverride?: AutoApprovalOverride
			subagentInfo?: SubagentInfo
			apiConfiguration?: SubagentProfile["apiConfiguration"]
			apiConfigName?: string
		},
	): Promise<Task>
	/** The profile a subagent in `taskMode` runs on (see BackgroundTaskRunner.resolveSubagentProfile). */
	resolveSubagentProfile(taskMode: string): Promise<SubagentProfile>
	awaitTaskCompletion(
		task: Task,
		options: { signal?: AbortSignal },
	): Promise<{
		completed: boolean
		lastMessage?: string
		writtenPaths: string[]
		abortReason?: string
		failureMessage?: string
	}>
	getState(): Promise<ApprovalState & { parallelTasksMaxConcurrency?: number; currentApiConfigName?: string }>
	subagentRegistry: SubtaskRegistry
	/** The running subagents per parent and the provider-wide slot pool. */
	readonly backgroundSubagents: BackgroundSubagents
	/**
	 * Atomically read the parent's `HistoryItem`, apply `updater`, and write
	 * it back. Used to record `parallelChildIds` as each child is spawned.
	 * Mirrors `TaskHistoryStore.atomicReadAndUpdate`; the tool never imports
	 * the store directly so the fan-out stays testable with a fake provider.
	 */
	atomicReadAndUpdateHistoryItem(taskId: string, updater: (current: HistoryItem) => HistoryItem): Promise<HistoryItem>
	/**
	 * Absolute path of the extension global storage directory (the parent of
	 * `tasks/<id>/`). Used to resolve the `subagents.json` sidecar path.
	 */
	readonly globalStoragePath: string
}

/** Truncate a subtask message for panel display. */
export function subagentDescription(message: string): string {
	const firstLine = message.split("\n", 1)[0] ?? message
	return firstLine.length > 200 ? `${firstLine.slice(0, 200)}…` : firstLine
}

/** Where a subagent runs: its profile and how many subagents that profile takes at once. */
export interface SubagentPlacement {
	profile: SubagentProfile
	/** The profile's name, the key of its slots in the SubagentSlotPool. */
	profileKey: string
	/** Subagent slots of the profile (see subagentSlotsForProfile); unset = no per-profile cap. */
	profileLimit?: number
}

/**
 * Resolve the profile of every subtask before the fan-out starts, so each
 * subagent waits for a slot of its own profile, and so a fan-out that could
 * never start is refused up front. The parent takes one request of its
 * profile's `maxConcurrentRequests`, because it keeps working (and answering
 * the user) while the subagents run. Returns the error text for the model
 * when a profile leaves no slot for subagents.
 */
export async function placeSubtasks(
	provider: Pick<SubtaskProvider, "resolveSubagentProfile">,
	parentProfileName: string | undefined,
	subtasks: ReadonlyArray<NormalizedSubtask>,
): Promise<{ ok: true; placements: SubagentPlacement[] } | { ok: false; error: string }> {
	const placements: SubagentPlacement[] = []
	for (const subtask of subtasks) {
		const profile = await provider.resolveSubagentProfile(subtask.mode)
		const profileKey = profile.name ?? ""
		const maxConcurrentRequests = profile.apiConfiguration.maxConcurrentRequests
		const profileLimit = subagentSlotsForProfile(maxConcurrentRequests, profileKey === (parentProfileName ?? ""))
		if (profileLimit === 0) {
			const name = profile.name ? `"${profile.name}"` : "of this task"
			return {
				ok: false,
				error:
					`No subagent can run in ${subtask.mode} mode: the API profile ${name} allows ` +
					`${maxConcurrentRequests} request(s) at once and this task already uses it. ` +
					"Do this work directly in this task.",
			}
		}
		placements.push({ profile, profileKey, profileLimit })
	}
	return { ok: true, placements }
}

/** Arguments for {@link runOneSubtask}. */
interface RunOneSubtaskArgs {
	provider: SubtaskProvider
	cwd: string
	parentTaskId: string
	/** The fan-out parent's root task: the subagent's history item sits in its tree. */
	rootTaskId: string
	/** Id of this run_parallel_tasks call, see {@link worktreeNamesFor}. */
	runId: string
	subtask: NormalizedSubtask
	index: number
	signal: AbortSignal
	/** `parallelTasksMaxConcurrency`: the provider-wide cap on running subagents. */
	globalLimit: number
	/** The profile the subagent runs on and its subagent slots, see {@link SubagentPlacement}. */
	placement: SubagentPlacement
}

/**
 * Run a single subtask: wait for a free slot, create its worktree, spawn a
 * headless child, and await completion. Checks `signal.aborted` before each
 * side-effecting step so that a parent abort cancels pending workers without
 * orphaning children.
 */
async function runOneSubtask({
	provider,
	cwd,
	parentTaskId,
	rootTaskId,
	runId,
	subtask,
	index,
	signal,
	globalLimit,
	placement,
}: RunOneSubtaskArgs): Promise<ParallelSubtaskResult> {
	const { worktreePath, branch } = worktreeNamesFor(cwd, parentTaskId, runId, index)
	const registry = provider.subagentRegistry
	// Until the child Task exists, panel updates target the queued placeholder.
	let registryId = queuedSubagentId(parentTaskId, runId, index)
	const cancelled = (): ParallelSubtaskResult => {
		registry.markTerminal(registryId, "cancelled")
		return { index, mode: subtask.mode, status: "cancelled" }
	}

	if (signal.aborted) {
		return cancelled()
	}

	const { profile, profileKey, profileLimit } = placement
	let releaseSlot: () => void
	try {
		releaseSlot = await provider.backgroundSubagents.slots.acquire(
			{ globalLimit, profileKey, profileLimit },
			signal,
		)
	} catch (error) {
		if (signal.aborted) {
			return cancelled()
		}
		const errorMessage = error instanceof Error ? error.message : String(error)
		registry.markTerminal(registryId, "failed", errorMessage)
		return { index, mode: subtask.mode, status: "failed", error: errorMessage }
	}

	try {
		const created = await worktreeService.createWorktree(cwd, {
			path: worktreePath,
			branch,
			createNewBranch: true,
			lockReason: subtaskLockReason(),
		})
		if (!created.success) {
			const error = `worktree creation failed: ${created.message}`
			registry.markTerminal(registryId, "failed", error)
			return { index, mode: subtask.mode, status: "failed", error }
		}

		if (signal.aborted) {
			registry.markTerminal(registryId, "cancelled")
			return await finalize(cwd, { index, mode: subtask.mode, status: "cancelled", worktreePath, branch })
		}

		const child = await provider.createBackgroundTask(subtask.message, {
			taskMode: subtask.mode,
			workspacePath: worktreePath,
			// Subagents follow the user's auto-approval settings; worktree
			// writes and reads are pre-approved; anything that would ask the
			// user is denied (a headless child has no user to ask).
			autoApprovalOverride: buildSubagentApprovalPolicy({
				getState: () => provider.getState(),
				worktreePath,
			}),
			// History placement: the parent's cwd, not the worktree, so the
			// history list (filtered by workspace) shows the subagent.
			subagentInfo: {
				parentTaskId,
				rootTaskId,
				workspace: cwd,
				runId,
				index,
				description: subagentDescription(subtask.message),
			},
			apiConfiguration: profile.apiConfiguration,
			apiConfigName: profile.name,
		})
		registryId = child.taskId
		// Persist the parent→child relation on the parent's HistoryItem so
		// rehydration from history can discover this fan-out's children.
		// Mirror of `delegateParentAndOpenChild`'s `atomicReadAndUpdate`, but
		// WITHOUT setting `status: "delegated"` / `awaitingChildId`: the
		// parent is NOT delegated to a parallel subagent, it keeps working
		// and collects the result with wait_for_subagents. Best-effort: a failure to persist the relation
		// must not break the fan-out (the sidecar write below and the live
		// panel still work; only rehydration of this run would be affected).
		await persistParallelChildId(provider, parentTaskId, child.taskId)
		const outcome = await provider.awaitTaskCompletion(child, { signal })

		// Cancellation shows up two ways: the fan-out signal (parent aborted)
		// or a per-subagent cancel from the panel (registry already terminal
		// "cancelled" via the cancelSubagent handler).
		const wasCancelledIndividually = registry.get(registryId)?.status === "cancelled"
		if (!outcome.completed && (signal.aborted || wasCancelledIndividually)) {
			registry.markTerminal(registryId, "cancelled")
			return await finalize(cwd, { index, mode: subtask.mode, status: "cancelled", worktreePath, branch })
		}
		const error = outcome.completed ? undefined : describeSubtaskFailure(outcome)
		registry.markTerminal(
			registryId,
			outcome.completed ? "completed" : "failed",
			outcome.completed ? outcome.lastMessage : error,
		)
		return await finalize(cwd, {
			index,
			mode: subtask.mode,
			status: outcome.completed ? "completed" : "failed",
			worktreePath,
			branch,
			message: outcome.lastMessage,
			error,
		})
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		registry.markTerminal(registryId, "failed", errorMessage)
		return await finalize(cwd, {
			index,
			mode: subtask.mode,
			status: "failed",
			worktreePath,
			branch,
			error: errorMessage,
		})
	} finally {
		releaseSlot()
	}
}

/**
 * The parent's view of a child that ended without completing, with what to
 * do next so a weak parent model does not just start the same subtask again.
 * A child stopped as stuck says what it kept doing; one that hit 401, 403 or
 * 404, or kept failing until the background retry cap, says why (TaskApiLoop).
 */
export function describeSubtaskFailure(outcome: { abortReason?: string; failureMessage?: string }): string {
	const { abortReason, failureMessage } = outcome
	if (abortReason === "stuck") {
		return (
			`Stopped as stuck: ${failureMessage ?? "it kept making mistakes."} Its partial work is in its ` +
			"worktree: check it, then finish the rest yourself or start a subtask with narrower, clearer instructions."
		)
	}
	if (failureMessage) {
		return (
			`${failureMessage} Retrying will not help now (the API key, model or profile needs fixing, ` +
			"or the provider is down): do this work yourself in this task, or tell the user."
		)
	}
	return (
		"Stopped before finishing (its task was torn down, for example by an editor restart). " +
		"Its partial work is in its worktree: check it before you redo anything."
	)
}

/** Attach cleanup outcome to a terminal subtask result. */
async function finalize(cwd: string, result: ParallelSubtaskResult): Promise<ParallelSubtaskResult> {
	const { worktreePath, branch } = result
	if (!worktreePath || !branch) return result
	// A kept worktree is the user's to review, so it is unlocked either way.
	await worktreeService.unlockWorktree(cwd, worktreePath)
	const cleaned = await cleanupSubtaskWorktreeIfEmpty({ cwd, worktreePath, branch })
	return cleaned ? { ...result, cleaned: true } : result
}

/**
 * Best-effort persistence of the parent→child relation for a parallel
 * fan-out: appends `childTaskId` to the parent HistoryItem's
 * `parallelChildIds` (deduped, order-preserving) via the provider's atomic
 * read-modify-write. Never throws: a failure is logged and the fan-out
 * continues (only historical rehydration of this run would be affected; the
 * live panel and tool result are independent).
 */
async function persistParallelChildId(
	provider: SubtaskProvider,
	parentTaskId: string,
	childTaskId: string,
): Promise<void> {
	try {
		await provider.atomicReadAndUpdateHistoryItem(parentTaskId, (current) => ({
			...current,
			parallelChildIds: Array.from(new Set([...(current.parallelChildIds ?? []), childTaskId])),
		}))
	} catch (error) {
		// Non-fatal: the live fan-out and panel still work. Only rehydration
		// from history of this specific run would lack the child relation.
		logger.warn(
			`[run_parallel_tasks] Failed to persist parallelChildIds for parent ${parentTaskId} (child ${childTaskId}): ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}
}

/**
 * Best-effort persistence of the terminal subagent summaries to the parent
 * task's sidecar (`tasks/<parentTaskId>/subagents.json`). Called after each
 * subagent ends (the parent keeps working meanwhile, so there is no single
 * "fan-out settled" moment it waits for) so rehydration can repopulate the
 * panel without re-reading each child's messages. Merged into the rows already saved, so
 * the sidecar keeps every fan-out of the task. Never throws: rehydration
 * rebuilds a row the sidecar lacks from the child's history item.
 */
async function persistSubagentSummariesSidecar(provider: SubtaskProvider, parentTaskId: string): Promise<void> {
	try {
		const { mergeSubagentSummaries } = await import("../task-persistence/subagentSummariesStore")
		const summaries = provider.subagentRegistry.snapshot(parentTaskId)
		await mergeSubagentSummaries(provider.globalStoragePath, parentTaskId, summaries)
	} catch (error) {
		// Non-fatal: see persistParallelChildId. The live panel is unaffected.
		logger.warn(
			`[run_parallel_tasks] Failed to persist subagents sidecar for parent ${parentTaskId}: ${
				error instanceof Error ? error.message : String(error)
			}`,
		)
	}
}

export class RunParallelTasksTool extends BaseTool<"run_parallel_tasks"> {
	readonly name = "run_parallel_tasks" as const

	async execute(params: RunParallelTasksParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			// No nested fan-outs: a subtask is a small one-shot job. The tool
			// is already stripped from background tasks' tool lists; this
			// guards hallucinated calls and prompt-listed protocols.
			if (task.isBackground) {
				task.recordToolError("run_parallel_tasks")
				pushToolResult(
					formatResponse.toolError(
						"run_parallel_tasks is not available inside a parallel subtask. Subtasks are " +
							"one-shot jobs and cannot spawn further subtasks: do the work directly in this " +
							"task and finish with attempt_completion so the parent task can continue.",
					),
				)
				return
			}

			// A compact profile (a very small local model) runs without subagents,
			// while the concurrency cap below is a global setting. Its toolset
			// hides this tool, but dispatch is tolerant, so a call made anyway is
			// refused here and counted as a mistake (without failing the turn), so
			// a model that keeps retrying reaches the mistake limit.
			if (isCompactProfile(task.apiConfiguration)) {
				this.recordFailure(task, "run_parallel_tasks")
				pushToolResult(formatResponse.toolError(compactSubagentsOffError("run_parallel_tasks")))
				return
			}

			const provider = task.providerRef.deref()
			if (!provider) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			// The user's configured hard cap bounds whatever concurrency the
			// model asked for; below 2 it disables the feature entirely.
			const maxConcurrencyCap =
				(await provider.getState()).parallelTasksMaxConcurrency ?? DEFAULT_PARALLEL_TASKS_MAX_CONCURRENCY
			if (!isParallelTasksEnabled(maxConcurrencyCap)) {
				task.recordToolError("run_parallel_tasks")
				pushToolResult(
					formatResponse.toolError(
						"run_parallel_tasks is disabled: the user's 'Max parallel subagents' setting is Off. " +
							"Do the work directly in this task, or delegate it via new_task if it needs a " +
							"different specialist mode.",
					),
				)
				return
			}

			const validated = validateParallelParams(params, maxConcurrencyCap)
			if (!validated.ok) {
				this.recordFailure(task, "run_parallel_tasks", { failTurn: true })
				pushToolResult(formatResponse.toolError(validated.error))
				return
			}
			task.consecutiveMistakeCount = 0

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
			// A task started in a mode without a pinned profile has no profile
			// name of its own and runs on the current one.
			await task.taskApiConfigReady
			const parentProfileName = task.taskApiConfigName ?? (await provider.getState()).currentApiConfigName
			const placed = await placeSubtasks(provider, parentProfileName, subtasks)
			if (!placed.ok) {
				this.recordFailure(task, "run_parallel_tasks")
				pushToolResult(formatResponse.toolError(placed.error))
				return
			}
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

			await sweepOrphanedSubtaskWorktrees(cwd)
			const started = startFanOut({
				provider,
				task,
				subtasks,
				maxConcurrency,
				globalLimit: maxConcurrencyCap,
				placements: placed.placements,
			})
			// The subagents run in the background. Wait the way
			// wait_for_subagents does: return on the first result or on a user
			// message, so the user never waits for the slowest subagent.
			const waited = await waitForSubagents(task, provider.backgroundSubagents)
			pushToolResult(prependText(`${started}\n\n`, waited))
		} catch (error) {
			await handleError("running parallel tasks", error, this.name)
		}
	}

	override async handlePartial(_task: Task, _block: ToolUse<"run_parallel_tasks">): Promise<void> {
		// No streaming card: the fan-out only acts once args are complete.
	}
}

/** `text` in front of a tool result, which may carry images. */
function prependText(text: string, result: ToolResponse): ToolResponse {
	if (typeof result === "string") {
		return text + result
	}
	return [{ type: "text", text }, ...result]
}

/** Arguments for {@link startFanOut}. */
interface StartFanOutArgs {
	provider: SubtaskProvider
	task: Task
	subtasks: NormalizedSubtask[]
	/** The model's per-call bound (`maxConcurrency`), at most the global cap. */
	maxConcurrency: number
	/** `parallelTasksMaxConcurrency`: the cap on running subagents across the provider. */
	globalLimit: number
	/** One per subtask, in order, see {@link placeSubtasks}. */
	placements: SubagentPlacement[]
}

/**
 * Start the subagents of one run_parallel_tasks call in the background and
 * return the line that tells the model they started. Each result goes to
 * the provider's BackgroundSubagents the moment its subagent ends; the
 * parent reads it with wait_for_subagents.
 */
function startFanOut({ provider, task, subtasks, maxConcurrency, globalLimit, placements }: StartFanOutArgs): string {
	const parentTaskId = task.taskId
	const cwd = task.cwd
	const runId = newFanOutRunId()
	const subagents = provider.backgroundSubagents
	const registry = provider.subagentRegistry

	// Seed the webview subagents panel: every subtask appears immediately as
	// "queued" (next to the rows of the parent's earlier fan-outs) and
	// transitions as its worker picks it up.
	const fanOutStartedAt = Date.now()
	registry.beginFanOut(parentTaskId)
	const refs = subtasks.map((subtask, i) => {
		const description = subagentDescription(subtask.message)
		registry.registerQueued({
			parentTaskId,
			runId,
			index: i,
			mode: subtask.mode,
			description,
			tokensIn: 0,
			tokensOut: 0,
			totalCost: 0,
			startedAt: fanOutStartedAt,
			lastActivityAt: fanOutStartedAt,
		})
		return subagents.start(parentTaskId, { description, mode: subtask.mode })
	})

	const controller = new AbortController()
	const onParentAborted = () => {
		// Only an EXPLICIT user cancel cascades to the children. Abandonment
		// aborts (task switch via history, in-place rehydrate on cancel of
		// another op, streaming-failure rehydrate) detach the fan-out
		// instead: the children keep running, stay visible in the panel
		// (individually cancellable), and their results reach the parent's
		// rehydrated instance through BackgroundSubagents.
		if (task.abortReason === "user_cancelled") {
			controller.abort()
		}
	}
	task.on(TumbleCodeEventName.TaskAborted, onParentAborted)

	const runAll = runWithConcurrency(subtasks, maxConcurrency, async (subtask, index) => {
		const result = await runOneSubtask({
			provider,
			cwd,
			parentTaskId,
			rootTaskId: task.rootTaskId ?? parentTaskId,
			runId,
			subtask,
			index,
			signal: controller.signal,
			globalLimit,
			placement: placements[index],
		})
		// A user-cancelled parent gets no results: nobody should be woken up
		// to read the cancellations it asked for.
		subagents.finish(parentTaskId, refs[index].number, controller.signal.aborted ? undefined : result)
		// Best-effort, never throws (see helper). Written per subagent so a
		// rehydrated parent sees every finished row.
		await persistSubagentSummariesSidecar(provider, parentTaskId)
		return result
	})
	void runAll
		.catch((error) => {
			logger.error(
				`[run_parallel_tasks] Fan-out of ${parentTaskId} failed: ${error instanceof Error ? error.message : String(error)}`,
			)
		})
		.finally(() => {
			task.off(TumbleCodeEventName.TaskAborted, onParentAborted)
			registry.endFanOut(parentTaskId)
		})

	const numbers = refs.map((ref) => `#${ref.number}`).join(", ")
	return `Started ${refs.length} subagent(s) in the background: ${numbers}.`
}

export const runParallelTasksTool = new RunParallelTasksTool()
