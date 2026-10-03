import * as vscode from "vscode"

import {
	type CloudAppProperties,
	type DynamicAppProperties,
	type GitProperties,
	type StaticAppProperties,
	type TaskProperties,
	type TelemetryProperties,
	isRetiredProvider,
	readCliRuntimeEnv,
} from "@tumble-code/types"
import { CloudService } from "@tumble-code/cloud"

import { Package } from "../../shared/package"
import { getWorkspaceGitInfo } from "../../utils/git"
import { logger } from "../../utils/logging"

import type { ProviderState } from "./ProviderStateBuilder"
import type { Task } from "../task/Task"

/**
 * What {@link TelemetryPropertiesSource} needs from its host (ClineProvider),
 * following the "declare what I touch" seam convention. Extends the R3-8
 * shared member groups where they fit; `subagentParentOf` is its own
 * one-member group (only this module touches it).
 */
export interface TelemetryPropertiesSourceHost {
	/** The settings accessor; its `language`/`mode`/`apiConfiguration` feed the event. */
	getState(): Promise<ProviderState>
	/** The current foreground task, if any. */
	getCurrentTask(): Task | undefined
	/** Live parallel-subagent registry lookup: the parent that fanned out `taskId`. */
	subagentParentOf(taskId: string): string | undefined
	/** The shared task-history store (lookup by id, for a non-current task's lineage). */
	getTaskHistoryStore(): Promise<{ get(taskId: string): { parentTaskId?: string } | undefined }>
	/**
	 * The host extension's `packageJSON` (name/version fallbacks for the app
	 * facts); the CLI bundle may carry different values than the host VSIX.
	 */
	readonly extensionPackageJSON: { name?: string; version?: string } | undefined
}

/**
 * The provider's telemetry-properties cluster (R3-12 cluster 2; was inline in
 * ClineProvider): the static app facts (cached), the cloud auth fact, the
 * per-event task facts and the workspace git facts (cached), composed by
 * {@link getTelemetryProperties}.
 *
 * ClineProvider keeps thin delegating members (`appProperties`,
 * `gitProperties`, `getTelemetryProperties`) because `TaskProviderLike` /
 * `TelemetryPropertiesProvider` pin them on the provider and consumers
 * (ErrorReporter, ExchangeRecorder, the telemetry clients) read them through
 * the provider.
 */
export class TelemetryPropertiesSource {
	private _appProperties?: StaticAppProperties
	private _gitProperties?: GitProperties

	constructor(private readonly host: TelemetryPropertiesSourceHost) {}

	/** The app facts; computed on first use and cached (they never change). */
	getAppProperties(): StaticAppProperties {
		if (!this._appProperties) {
			const packageJSON = this.host.extensionPackageJSON
			// The CLI hosts this same bundle; the cloud tells the clients apart by this.
			const { isCliRuntime, cliVersion } = readCliRuntimeEnv(process.env)

			this._appProperties = {
				appName: packageJSON?.name ?? Package.name,
				appVersion: packageJSON?.version ?? Package.version,
				vscodeVersion: vscode.version,
				platform: process.platform,
				editorName: vscode.env.appName,
				clientKind: isCliRuntime ? "cli" : "vscode",
				...(isCliRuntime && cliVersion ? { clientVersion: cliVersion } : {}),
			}
		}

		return this._appProperties
	}

	private getCloudProperties(): CloudAppProperties {
		let cloudIsAuthenticated: boolean | undefined

		try {
			if (CloudService.hasInstance()) {
				cloudIsAuthenticated = CloudService.instance.isAuthenticated()
			}
		} catch (error) {
			// Silently handle errors to avoid breaking telemetry collection.
			logger.warn(`[getTelemetryProperties] Failed to get cloud auth state: ${error}`)
		}

		return {
			cloudIsAuthenticated,
		}
	}

	private async getTaskProperties(eventTaskId?: string): Promise<DynamicAppProperties & TaskProperties> {
		const { language = "en", mode, apiConfiguration } = await this.host.getState()

		const task = this.host.getCurrentTask()
		if (eventTaskId && eventTaskId !== task?.taskId) {
			return { language, mode, ...(await this.getOtherTaskLineage(eventTaskId)) }
		}
		const todoList = task?.todoList
		let todos: { total: number; completed: number; inProgress: number; pending: number } | undefined

		if (todoList && todoList.length > 0) {
			todos = {
				total: todoList.length,
				completed: todoList.filter((todo) => todo.status === "completed").length,
				inProgress: todoList.filter((todo) => todo.status === "in_progress").length,
				pending: todoList.filter((todo) => todo.status === "pending").length,
			}
		}

		const apiProvider = apiConfiguration?.apiProvider

		return {
			language,
			mode,
			taskId: task?.taskId,
			parentTaskId: task?.parentTaskId,
			apiProvider: apiProvider && !isRetiredProvider(apiProvider) ? apiProvider : undefined,
			modelId: task?.api?.getModel().id,
			diffStrategy: task?.diffStrategy?.getName(),
			isSubtask: task ? !!task.parentTaskId : undefined,
			...(todos && { todos }),
		}
	}

	private async getGitProperties(): Promise<GitProperties> {
		if (!this._gitProperties) {
			this._gitProperties = await getWorkspaceGitInfo()
		}

		return this._gitProperties
	}

	/** The git facts, when already computed; undefined before the first event. */
	getGitPropertiesIfComputed(): GitProperties | undefined {
		return this._gitProperties
	}

	/**
	 * Lineage of a task that is not the current one: a parallel subagent
	 * (never the current task, its parent is the task that fanned it out) or a
	 * task from history (a backfill upload). The current task's model, todos
	 * and lineage do not describe it, so they are left out.
	 */
	private async getOtherTaskLineage(taskId: string): Promise<TaskProperties> {
		let parentTaskId = this.host.subagentParentOf(taskId)
		if (!parentTaskId) {
			try {
				parentTaskId = (await this.host.getTaskHistoryStore()).get(taskId)?.parentTaskId
			} catch {
				// History unavailable: report no parent rather than a wrong one.
			}
		}
		return { taskId, parentTaskId, isSubtask: parentTaskId !== undefined }
	}

	/** The per-event properties: app + cloud + task + git facts. */
	async getTelemetryProperties(taskId?: string): Promise<TelemetryProperties> {
		return {
			...this.getAppProperties(),
			...this.getCloudProperties(),
			...(await this.getTaskProperties(taskId)),
			...(await this.getGitProperties()),
		}
	}
}
