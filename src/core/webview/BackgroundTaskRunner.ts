import * as path from "path"
import fs from "fs/promises"
import * as vscode from "vscode"

import { type ExtensionMessage, type ProviderSettings, type TodoItem, RooCodeEventName } from "@roo-code/types"

import { buildApiHandler } from "../../api"
import { Task, type AutoApprovalOverride } from "../task/Task"
import { type SideQuery } from "../memory"
import { makeSideQuery } from "../memory/memoryTaskIntegration"

import type { ClineProvider } from "./ClineProvider"
import type { ProviderState } from "./ProviderStateBuilder"
import type { SubagentRegistry } from "./SubagentRegistry"
import { profileTaskOptions } from "./profileTaskOptions"

/** Options of {@link BackgroundTaskRunner.createBackgroundTask}. */
export interface BackgroundTaskOptions {
	taskMode?: string
	workspacePath?: string
	maxAgentTurns?: number
	autoApprovalOverride?: AutoApprovalOverride
	silentWrites?: boolean
	initialTodos?: TodoItem[]
	apiConfiguration?: ProviderSettings
	/**
	 * Registers the child in the subagent registry so it is visible in
	 * the webview subagents panel.
	 */
	subagentInfo?: { parentTaskId: string; index: number; description: string }
}

/** The terminal state of a background task, see {@link BackgroundTaskRunner.awaitTaskCompletion}. */
export interface BackgroundTaskOutcome {
	completed: boolean
	lastMessage?: string
	writtenPaths: string[]
	abortReason?: string
	/**
	 * Why the task stopped when its API request failed with 401, 403 or 404
	 * (Task#apiFailureMessage): status, reason, provider and model in one line.
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
export interface BackgroundTaskHost {
	/** The provider every background Task is created for. */
	readonly provider: ClineProvider
	/** The extension global storage directory (the parent of `tasks/<id>/`). */
	readonly globalStoragePath: string
	readonly subagentRegistry: Pick<SubagentRegistry, "register">
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
	postMessageToWebview(message: ExtensionMessage): Promise<void>
	log(message: string): void
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
export class BackgroundTaskRunner {
	// Headless background tasks (parallel subagents). Keyed by
	// taskId; entries are removed on completion/abort.
	private readonly backgroundTasks = new Map<string, Task>()
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
	 * - is **never** pushed onto `clineStack`, so `getCurrentTask()` and the
	 *   webview stay bound to the foreground task;
	 * - runs autonomously via `autoApprovalOverride` (interactive asks never block
	 *   it: the task isn't the current task, so no webview response would arrive);
	 * - is bounded by `maxAgentTurns`;
	 * - can run in its own `workspacePath` (a git worktree) and `taskMode`
	 *   (e.g. a write-sandboxed mode).
	 *
	 * Pair with {@link awaitTaskCompletion} to await its result.
	 */
	public async createBackgroundTask(text: string, options: BackgroundTaskOptions = {}): Promise<Task> {
		const state = await this.host.getState()
		// Model resolution, most specific wins: explicit apiConfiguration from
		// the caller, then the subtask mode's pinned API profile (same binding a
		// foreground mode switch applies), then the currently active profile.
		// Mode resolution is scoped to panel-visible subagents so other
		// background tasks keep their explicit/current config.
		let apiConfiguration = options.apiConfiguration
		let apiConfigName = options.apiConfiguration ? undefined : state.currentApiConfigName
		if (!apiConfiguration && options.subagentInfo && options.taskMode) {
			const resolved = await this.host.getApiConfigurationForMode(options.taskMode)
			if (resolved) {
				apiConfiguration = resolved.apiConfiguration
				apiConfigName = resolved.name
			}
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
			maxAgentTurns: options.maxAgentTurns,
			autoApprovalOverride: options.autoApprovalOverride,
			silentWrites: options.silentWrites,
			initialTodos: options.initialTodos,
			// Start explicitly below (after registry insert), never via the stack.
			startTask: false,
			onCreated: this.host.taskCreationCallback,
		})

		this.backgroundTasks.set(task.taskId, task)
		if (options.subagentInfo) {
			// Register BEFORE start() so a tail subscribed on the queued
			// placeholder streams the child's first messages.
			const now = Date.now()
			this.host.subagentRegistry.register({
				taskId: task.taskId,
				parentTaskId: options.subagentInfo.parentTaskId,
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
		}
		this.host.log(`[createBackgroundTask] started background task ${task.taskId}.${task.instanceId}`)
		task.start()
		return task
	}

	/** Look up a live headless background task (parallel subagent) by id. */
	public getBackgroundTask(taskId: string): Task | undefined {
		return this.backgroundTasks.get(taskId)
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
			.catch(() => {})
	}

	/**
	 * Await a background task's terminal state. Resolves `{ completed: true,
	 * lastMessage }` on `TaskCompleted` (attempt_completion) or `{ completed:
	 * false, abortReason }` on `TaskAborted`. Removes the registry entry,
	 * disposes a completed task, and then deletes its on-disk directory
	 * (aborted tasks keep theirs for post-mortem). An optional `signal` aborts
	 * the task early.
	 *
	 * `abortReason` is propagated so callers can tell a provider failure
	 * (`"streaming_failed"`) from turn-budget exhaustion
	 * (`"max_turns_reached"`) and user cancellation (`"user_cancelled"`).
	 */
	public awaitTaskCompletion(task: Task, options: { signal?: AbortSignal } = {}): Promise<BackgroundTaskOutcome> {
		return new Promise((resolve) => {
			let settled = false

			const onSignalAbort = () => {
				void task.abortTask().catch(() => {})
			}

			const finish = (result: {
				completed: boolean
				lastMessage?: string
				abortReason?: string
				failureMessage?: string
			}) => {
				if (settled) return
				settled = true
				task.off(RooCodeEventName.TaskCompleted, onCompleted)
				task.off(RooCodeEventName.TaskAborted, onAborted)
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
				// Completed background tasks have no history item and are never
				// resumed: delete their on-disk directory once the dispose settles
				// (abortTask saves messages, which would re-create the directory).
				// Aborted/failed tasks keep their directory for post-mortem. No
				// ShadowCheckpointService cleanup is needed (background tasks are
				// created with enableCheckpoints: false).
				if (result.completed) {
					void task
						.abortTask(true)
						.catch(() => {})
						.then(() => this.cleanupBackgroundTaskFiles(task.taskId))
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
			// A background task that hit 401/403/404 records why (TaskApiLoop
			// ends it at once instead of retrying): pass that on too.
			const onAborted = () =>
				finish({
					completed: false,
					abortReason: task.abortReason,
					...(task.apiFailureMessage ? { failureMessage: task.apiFailureMessage } : {}),
				})

			task.on(RooCodeEventName.TaskCompleted, onCompleted)
			task.on(RooCodeEventName.TaskAborted, onAborted)

			if (options.signal) {
				if (options.signal.aborted) onSignalAbort()
				else options.signal.addEventListener("abort", onSignalAbort, { once: true })
			}
		})
	}

	/**
	 * Best-effort deletion of a completed background task's on-disk directory.
	 * Failure is logged and never thrown: the await result is already settled.
	 */
	private cleanupBackgroundTaskFiles(taskId: string): void {
		void (async () => {
			try {
				const { getTaskDirectoryPath } = await import("../../utils/storage")
				const dirPath = await getTaskDirectoryPath(this.host.globalStoragePath, taskId)
				await fs.rm(dirPath, { recursive: true, force: true })
				this.host.log(`[cleanupBackgroundTaskFiles] removed task directory for ${taskId}`)
			} catch (error) {
				this.host.log(
					`[cleanupBackgroundTaskFiles] failed to remove task directory for ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		})()
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
						this.host.log(
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
			this.host.log(
				`[memoryWriterQuery] failed to load writer profile ${id}, falling back to foreground: ${error instanceof Error ? error.message : String(error)}`,
			)
			return undefined
		}
	}
}
