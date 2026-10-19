import * as path from "path"
import * as vscode from "vscode"

import { type ExtensionMessage, type ProviderSettings, type TodoItem, TumbleCodeEventName } from "@tumble-code/types"

import { buildApiHandler } from "../../api"
import { Task, type AutoApprovalOverride } from "../task/Task"
import { type SideQuery } from "../memory"
import { makeSideQuery } from "../memory/memoryTaskIntegration"

import type { ClineProvider } from "./ClineProvider"
import type { ProviderState } from "./ProviderStateBuilder"
import type { SubagentRegistry } from "./SubagentRegistry"
import { profileTaskOptions } from "./profileTaskOptions"
import { subagentActivity } from "./subagentActivity"
import { logger } from "../../utils/logging"
import type { PostMessageHostMember } from "./host-groups"

/** Options of {@link BackgroundTaskRunner.createBackgroundTask}. */
export interface BackgroundTaskOptions {
	taskMode?: string
	workspacePath?: string
	autoApprovalOverride?: AutoApprovalOverride
	initialTodos?: TodoItem[]
	apiConfiguration?: ProviderSettings
	/** The name of the profile `apiConfiguration` came from (history and panel show it). */
	apiConfigName?: string
	/**
	 * Registers the child in the subagent registry so it is visible in
	 * the webview subagents panel, and writes its history item as a subtask
	 * of `parentTaskId` (see TaskHistoryLineage). `rootTaskId` and
	 * `workspace` are the fan-out parent's root task and working directory.
	 */
	subagentInfo?: SubagentInfo
}

/** Panel and history placement of a parallel subagent, see {@link BackgroundTaskOptions.subagentInfo}. */
export interface SubagentInfo {
	parentTaskId: string
	rootTaskId: string
	workspace: string
	/** The fan-out the subagent belongs to, see SubagentSummary.runId. */
	runId: string
	index: number
	description: string
}

/** The API profile a background task runs on, see {@link BackgroundTaskRunner.resolveSubagentProfile}. */
export interface SubagentProfile {
	apiConfiguration: ProviderSettings
	/** The profile's name; undefined when the state has no current profile name. */
	name?: string
}

/** The terminal state of a background task, see {@link BackgroundTaskRunner.awaitTaskCompletion}. */
export interface BackgroundTaskOutcome {
	completed: boolean
	lastMessage?: string
	writtenPaths: string[]
	abortReason?: string
	/**
	 * Why the task stopped, in one line: its API request failed for good
	 * (Task#apiFailureMessage: status, reason, provider and model), or it was
	 * stopped as stuck (Task#stuckMessage, `abortReason` "stuck").
	 */
	failureMessage?: string
}

/** Live memory-system activity counters ("recalling/writing memory..." badge). */
export interface MemoryActivityCounts {
	recall: number
	write: number
}

/**
 * What the background task runner needs from its provider. The member names
 * match ClineProvider's, so the provider hands in closures over itself and a
 * test can hand in a plain object.
 */
export interface BackgroundTaskHost extends PostMessageHostMember {
	/** The provider every background Task is created for. */
	readonly provider: ClineProvider
	readonly subagentRegistry: Pick<SubagentRegistry, "register" | "update">
	/** Attaches the provider's task-event forwarding to a new Task. */
	readonly taskCreationCallback: (task: Task) => void
	getState(): Promise<
		Pick<
			ProviderState,
			"apiConfiguration" | "currentApiConfigName" | "experiments" | "organizationAllowList" | "mode"
		>
	>
	getApiConfigurationForMode(mode: string): Promise<{ apiConfiguration: ProviderSettings; name: string } | undefined>
	/** The `memoryWriterApiConfigId` setting. */
	getMemoryWriterApiConfigId(): string | undefined
	/** Read a stored profile without making it the active one. */
	getProfile(params: { id: string }): Promise<ProviderSettings & { name: string }>
}

/**
 * Runs HEADLESS background tasks (the `run_parallel_tasks` subagents) and
 * the one-shot completions of the memory background writers (extraction and
 * dream). Background tasks are kept off the provider's task stack, so the
 * current task and the webview stay bound to the foreground task. A user
 * cancel of the foreground task never reaches this class: the cancelled task
 * skips its memory writers and the writer drain (see
 * TaskLifecycle.prepareAbort / drainAbort), and running background tasks are
 * neither awaited nor aborted by it.
 */
/** A background task that fails to abort cleanly has nothing left to report to. */
function logAbortFailure(error: unknown): void {
	logger.debug(`[BackgroundTaskRunner] abortTask failed: ${String(error)}`)
}

export class BackgroundTaskRunner {
	// Headless background tasks (parallel subagents). Keyed by
	// taskId; entries are removed on completion/abort.
	private readonly backgroundTasks = new Map<string, Task>()
	// Subagent id -> the task that fanned it out. Kept for the whole session
	// (a few ids per fan-out): telemetry of a child can be sent after the
	// child left `backgroundTasks`.
	private readonly subagentParents = new Map<string, string>()
	private readonly memoryActivityCounts: MemoryActivityCounts = { recall: 0, write: 0 }

	constructor(private readonly host: BackgroundTaskHost) {}

	/** The live memory-activity counters (read by the state builder). */
	public get memoryActivity(): MemoryActivityCounts {
		return this.memoryActivityCounts
	}

	/**
	 * Create and start a HEADLESS background task: the primitive behind the
	 * `run_parallel_tasks` subagents.
	 *
	 * Unlike `ClineProvider.createTask`, a background task:
	 * - is **never** installed as the current task, so `getCurrentTask()` and the
	 *   webview stay bound to the foreground task;
	 * - runs autonomously via `autoApprovalOverride` (interactive asks never block
	 *   it: the task isn't the current task, so no webview response would arrive);
	 * - runs until it completes, is cancelled, or is stopped as stuck (see
	 *   Task#stopStuckBackgroundTask) or by an API failure;
	 * - can run in its own `workspacePath` (a git worktree) and `taskMode`
	 *   (e.g. a write-sandboxed mode).
	 *
	 * Pair with {@link awaitTaskCompletion} to await its result.
	 */
	public async createBackgroundTask(text: string, options: BackgroundTaskOptions = {}): Promise<Task> {
		const state = await this.host.getState()
		// Model resolution, most specific wins: explicit apiConfiguration from
		// the caller (run_parallel_tasks resolves it before it takes a slot),
		// then the subtask mode's pinned API profile, then the currently active
		// profile. Mode resolution is scoped to panel-visible subagents so
		// other background tasks keep their explicit/current config.
		let apiConfiguration = options.apiConfiguration
		let apiConfigName = options.apiConfiguration ? options.apiConfigName : state.currentApiConfigName
		if (!apiConfiguration && options.subagentInfo && options.taskMode) {
			const resolved = await this.resolveSubagentProfile(options.taskMode)
			apiConfiguration = resolved.apiConfiguration
			apiConfigName = resolved.name
		}
		apiConfiguration ??= state.apiConfiguration
		const { experiments, organizationAllowList } = state

		const task = new Task({
			provider: this.host.provider,
			// Same profile rules as a foreground task (allow list + mistake
			// limit), checked on the profile the background task will run on.
			...profileTaskOptions(apiConfiguration, organizationAllowList),
			// Background tasks don't participate in checkpoints (no shadow git per
			// memory write); keeps them cheap and side-effect-free.
			enableCheckpoints: false,
			experiments,
			task: text,
			taskMode: options.taskMode,
			workspacePath: options.workspacePath,
			isBackground: true,
			...(options.subagentInfo && {
				historyLineage: {
					parentTaskId: options.subagentInfo.parentTaskId,
					rootTaskId: options.subagentInfo.rootTaskId,
					workspace: options.subagentInfo.workspace,
				},
				// The default -1 would end up in the history item's number.
				taskNumber: 1,
			}),
			autoApprovalOverride: options.autoApprovalOverride,
			initialTodos: options.initialTodos,
			// Start explicitly below (after registry insert), never via the stack.
			startTask: false,
			onCreated: this.host.taskCreationCallback,
		})

		this.backgroundTasks.set(task.taskId, task)
		if (options.subagentInfo) {
			// A Task created with a taskMode leaves its profile name unset; the
			// history item shows the profile the subagent actually ran on.
			task.setTaskApiConfigName(apiConfigName)
			this.subagentParents.set(task.taskId, options.subagentInfo.parentTaskId)
			// Register BEFORE start() so a tail subscribed on the queued
			// placeholder streams the child's first messages.
			const now = Date.now()
			this.host.subagentRegistry.register({
				taskId: task.taskId,
				parentTaskId: options.subagentInfo.parentTaskId,
				runId: options.subagentInfo.runId,
				index: options.subagentInfo.index,
				mode: options.taskMode ?? state.mode,
				description: options.subagentInfo.description,
				status: "running",
				apiConfigName,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				startedAt: now,
				lastActivityAt: now,
			})
			// The row says what the subagent is doing (a command, a tool). The
			// listener goes with the task: it is disposed when it ends.
			task.on(TumbleCodeEventName.Message, ({ message }) => {
				const activity = subagentActivity(message)
				if (activity) {
					this.host.subagentRegistry.update(task.taskId, { activity })
				}
			})
		}
		logger.info(`[createBackgroundTask] started background task ${task.taskId}.${task.instanceId}`)
		task.start()
		return task
	}

	/**
	 * The API profile a subagent in `taskMode` runs on: the profile pinned to
	 * that mode (the same binding a foreground mode switch applies), else the
	 * currently active one. run_parallel_tasks resolves it before the
	 * subagent waits for a slot, so the slot can depend on the profile.
	 */
	public async resolveSubagentProfile(taskMode: string): Promise<SubagentProfile> {
		const pinned = await this.host.getApiConfigurationForMode(taskMode)
		if (pinned) {
			return { apiConfiguration: pinned.apiConfiguration, name: pinned.name }
		}
		const state = await this.host.getState()
		return { apiConfiguration: state.apiConfiguration, name: state.currentApiConfigName }
	}

	/**
	 * The task that fanned out subagent `taskId`, also after the subagent
	 * finished. A subagent is not on the task stack, so it has no
	 * `parentTaskId` of its own.
	 */
	public subagentParentOf(taskId: string): string | undefined {
		return this.subagentParents.get(taskId)
	}

	/** Look up a live headless background task (parallel subagent) by id. */
	public getBackgroundTask(taskId: string): Task | undefined {
		return this.backgroundTasks.get(taskId)
	}

	/** The live parallel subagents (background tasks that a fan-out started). */
	public liveSubagents(): Task[] {
		return [...this.backgroundTasks.values()].filter((task) => this.subagentParents.has(task.taskId))
	}

	/**
	 * Aborts the live background tasks among `taskIds` (their history is being
	 * deleted). The abort settles {@link awaitTaskCompletion}, so the fan-out
	 * that waits on them reports them as failed instead of hanging.
	 */
	public async abortTasks(taskIds: Iterable<string>): Promise<void> {
		for (const taskId of taskIds) {
			const task = this.backgroundTasks.get(taskId)
			if (task) {
				await task.abortTask().catch(logAbortFailure)
			}
		}
	}

	/**
	 * Adjust a memory-activity counter and push the change to the webview.
	 * `active: true` opens an activity window, `false` closes it. Counters,
	 * not booleans: recall prefetches and background writers can overlap.
	 */
	public setMemoryActivity(kind: "recall" | "write", active: boolean): void {
		this.memoryActivityCounts[kind] = Math.max(0, this.memoryActivityCounts[kind] + (active ? 1 : -1))
		this.host
			.postMessageToWebview({
				type: "memoryActivity",
				memoryActivity: { ...this.memoryActivityCounts },
			})
			.catch((error) => logger.debug(`[BackgroundTaskRunner] memoryActivity not posted: ${String(error)}`))
	}

	/**
	 * Await a background task's terminal state. Resolves `{ completed: true,
	 * lastMessage }` on `TaskCompleted` (attempt_completion) or `{ completed:
	 * false, abortReason }` on `TaskAborted`. Removes the registry entry and
	 * disposes a completed task. The on-disk directory is kept: it holds the
	 * subagent's history item. An optional `signal` aborts the task early.
	 *
	 * `abortReason` is propagated so callers can tell a provider failure
	 * (`"streaming_failed"`) from a stuck task (`"stuck"`) and user
	 * cancellation (`"user_cancelled"`).
	 */
	public awaitTaskCompletion(task: Task, options: { signal?: AbortSignal } = {}): Promise<BackgroundTaskOutcome> {
		return new Promise((resolve) => {
			let settled = false

			const onSignalAbort = () => {
				void task.abortTask().catch(logAbortFailure)
			}

			const finish = (result: {
				completed: boolean
				lastMessage?: string
				abortReason?: string
				failureMessage?: string
			}) => {
				if (settled) return
				settled = true
				task.off(TumbleCodeEventName.TaskCompleted, onCompleted)
				task.off(TumbleCodeEventName.TaskAborted, onAborted)
				options.signal?.removeEventListener("abort", onSignalAbort)
				// Capture the set of files the task wrote/edited BEFORE disposing it
				// (dispose tears down the tracker). Resolve to absolute paths.
				let writtenPaths: string[] = []
				try {
					writtenPaths = (task.fileContextTracker?.getAndClearCheckpointPossibleFile?.() ?? []).map((p) =>
						path.isAbsolute(p) ? p : path.resolve(task.cwd, p),
					)
				} catch {
					// Non-fatal: no written-path reporting for this run.
				}
				this.backgroundTasks.delete(task.taskId)
				// Dispose a completed background task (aborted ones are already torn
				// down). `isBackground` makes this abort skip the memory writers.
				// The abort saves the messages, which writes the final history item
				// (outcome "completed"); the task directory stays, the history store
				// drops items whose directory is gone. No ShadowCheckpointService
				// cleanup is needed (background tasks are created with
				// enableCheckpoints: false).
				if (result.completed) {
					void task.abortTask(true).catch(logAbortFailure)
				}
				resolve({ ...result, writtenPaths })
			}

			const onCompleted = () => {
				// Last completion_result say carries the attempt_completion text.
				const last = [...task.clineMessages]
					.reverse()
					.find((m) => m.type === "say" && m.say === "completion_result")
				finish({ completed: true, lastMessage: last?.text })
			}
			// Capture the abortReason at abort time so the caller can classify
			// the failure (Claim 3). task.abortReason is set by TaskApiLoop
			// before abortTask() fires TaskAborted.
			// A background task that hit 401/403/404, or was stopped as stuck,
			// records why: pass that on too. Its last words tell the parent how
			// far the work got.
			const onAborted = () => {
				const failureMessage = task.stuckMessage ?? task.apiFailureMessage
				const lastText = [...task.clineMessages]
					.reverse()
					.find((m) => m.type === "say" && m.say === "text" && !m.partial && m.text?.trim())
				finish({
					completed: false,
					abortReason: task.abortReason,
					...(lastText ? { lastMessage: lastText.text } : {}),
					...(failureMessage ? { failureMessage } : {}),
				})
			}

			task.on(TumbleCodeEventName.TaskCompleted, onCompleted)
			task.on(TumbleCodeEventName.TaskAborted, onAborted)

			if (options.signal) {
				if (options.signal.aborted) onSignalAbort()
				else options.signal.addEventListener("abort", onSignalAbort, { once: true })
			}
		})
	}

	/**
	 * Surface a non-blocking toast for background-task outcomes (memory writes).
	 */
	public notifyBackgroundOutcome(message: string): void {
		void vscode.window.showInformationMessage(message)
	}

	/**
	 * The one-shot completion the memory background writers (extraction and
	 * dream) ask, consumed by `TaskLifecycle.triggerMemoryBackgroundWriters`.
	 *
	 * The writers are not agents: each call is one small prompt answered in
	 * plain text, and the writers do the file work in code. So there is no
	 * Task, no tool list and no agent system prompt here, only a handler
	 * built for the call and disposed after it.
	 *
	 * The memory-writer profile (`memoryWriterApiConfigId`) is used when set,
	 * otherwise `foreground` (the finishing task's profile). A failed call on
	 * the writer profile is retried once on `foreground`: the cheap model may
	 * be offline, and a retry costs one small prompt. A cancel never retries.
	 */
	public memoryWriterQuery(foreground: ProviderSettings, taskId?: string): SideQuery {
		return async (system, user, signal) => {
			const writerConfig = await this.resolveMemoryWriterApiConfiguration()
			this.setMemoryActivity("write", true)
			try {
				if (writerConfig) {
					try {
						return await this.runMemoryWriterQuery(writerConfig, taskId, system, user, signal)
					} catch (error) {
						if (signal.aborted) throw error
						logger.warn(
							`[memoryWriterQuery] memory writer profile failed, retrying on foreground: ${error instanceof Error ? error.message : String(error)}`,
						)
					}
				}
				return await this.runMemoryWriterQuery(foreground, taskId, system, user, signal)
			} finally {
				this.setMemoryActivity("write", false)
			}
		}
	}

	private async runMemoryWriterQuery(
		apiConfiguration: ProviderSettings,
		taskId: string | undefined,
		system: string,
		user: string,
		signal: AbortSignal,
	): Promise<string> {
		const handler = buildApiHandler(apiConfiguration)
		try {
			const query = makeSideQuery(handler, taskId)
			if (!query) {
				throw new Error(`provider ${apiConfiguration.apiProvider} has no single-completion support`)
			}
			return await query(system, user, signal)
		} finally {
			handler.dispose?.()
		}
	}

	/**
	 * Resolve the configured memory-writer API profile. Returns undefined when
	 * no profile is configured or the configured id is stale: callers fall
	 * back to the foreground profile. Never throws.
	 */
	private async resolveMemoryWriterApiConfiguration(): Promise<ProviderSettings | undefined> {
		const id = this.host.getMemoryWriterApiConfigId()
		if (!id) return undefined
		try {
			// getProfile, not activateProfile: activating also stores the writer
			// profile as the user's current profile (`currentApiConfigName`).
			const { name: _name, ...profile } = await this.host.getProfile({ id })
			return profile
		} catch (error) {
			logger.warn(
				`[memoryWriterQuery] failed to load writer profile ${id}, falling back to foreground: ${error instanceof Error ? error.message : String(error)}`,
			)
			return undefined
		}
	}
}
