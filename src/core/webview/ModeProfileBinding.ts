import * as vscode from "vscode"

import {
	type CliModeProviderSettings,
	type GlobalState,
	type HistoryItem,
	type ModeConfig,
	type ProviderSettings,
	type ProviderSettingsEntry,
	RooCodeEventName,
	getModelId,
	readCliRuntimeEnv,
	TelemetryEventName,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { type Mode, defaultModeSlug, getModeBySlug } from "../../shared/modes"
import { t } from "../../i18n"
import type { ContextProxy } from "../config/ContextProxy"
import type { ProviderSettingsManager } from "../config/ProviderSettingsManager"
import type { Task } from "../task/Task"
import type { TaskHistoryStore } from "../task-persistence"

/**
 * What the mode and profile binding needs from its provider. The member names
 * match ClineProvider's, so the provider hands in closures over itself (which
 * also pick up methods that tests replace or spy on) and a test can hand in a
 * plain object.
 */
export interface ModeProfileBindingHost {
	readonly contextProxy: Pick<ContextProxy, "setValue" | "setProviderSettings">
	readonly providerSettingsManager: Pick<
		ProviderSettingsManager,
		"getModeConfigId" | "listConfig" | "getProfile" | "activateProfile" | "setModeConfig" | "saveConfig"
	>
	isApiConfigLockedAcrossModes(): boolean
	getCustomModes(): Promise<ModeConfig[] | undefined>
	getState(): Promise<{ mode: string }>
	updateGlobalState<K extends keyof GlobalState>(key: K, value: GlobalState[K]): Promise<void>
	getGlobalState<K extends keyof GlobalState>(key: K): GlobalState[K]
	getCurrentTask(): Task | undefined
	getTaskHistoryStore(): Promise<Pick<TaskHistoryStore, "get">>
	updateTaskHistory(item: HistoryItem): Promise<unknown>
	activateProviderProfile(
		args: { name: string } | { id: string },
		options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean },
	): Promise<void>
	postStateToWebview(): Promise<void>
	emitModeChanged(mode: Mode): void
	emitProviderProfileChanged(profile: { name: string; provider: string }): void
	/** A profile save succeeded: storage is writable again. */
	clearStorageError(): void
	/** A profile save failed: show the persistent storage-error banner. */
	reportStorageError(error: unknown): void
	log(message: string): void
}

/**
 * Where the provider settings of a mode come from, most specific source
 * first:
 *
 * - `cli`: the CLI's per-mode settings file (`modes[mode] ?? base`). While
 *   present it replaces the profile store for mode switches, mode-scoped
 *   subagents and resumed tasks, and wins over the workspace lock.
 * - `locked`: the workspace locks one API profile across modes
 *   (`lockApiConfigAcrossModes`); the current profile stays.
 * - `store`: the "use a specific configuration for this mode" binding of the
 *   profile store, with the profile list read on the way (callers publish
 *   it as `listApiConfigMeta`).
 */
export type ModeProfileResolution =
	| { source: "cli"; apiConfiguration: ProviderSettings }
	| { source: "locked" }
	| { source: "store"; profiles: ProviderSettingsEntry[]; binding: StoredModeBinding }

/**
 * The profile-store binding of a mode. Only `usable` names a profile that may
 * be activated. `empty` is a profile without `apiProvider` (the placeholder
 * profiles the CLI's profile store contains): activating it would wipe the
 * working settings. `unreadable` carries the read error so each caller keeps
 * its own error policy.
 */
export type StoredModeBinding =
	| { status: "unbound" }
	| { status: "missing"; configId: string }
	| { status: "empty"; configId: string; name: string }
	| { status: "unreadable"; configId: string; name: string; error: unknown }
	| { status: "usable"; configId: string; name: string }

/**
 * Binds modes to provider profiles and activates profiles (CORE-R6 c): the
 * one resolution of "which settings does this mode use" ({@link resolve}),
 * applied by the three callers that used to carry drifted copies of it
 * (a mode switch, a task reopened from history and a mode-scoped subagent),
 * plus profile activation and the current task's sticky profile.
 */
export class ModeProfileBinding {
	private cliModeProviderSettings?: CliModeProviderSettings

	constructor(private readonly host: ModeProfileBindingHost) {}

	/** Read on every use: tests (and a settings reset) may replace it. */
	private get providerSettingsManager() {
		return this.host.providerSettingsManager
	}

	/**
	 * Provider settings per mode from the CLI's settings file. While set, mode
	 * switches, mode-scoped subagents and resumed tasks take their provider
	 * settings from here (`modes[mode] ?? base`) instead of the profile store.
	 * The value lives in memory only: the CLI sends it on every start, and the
	 * profile store is never touched.
	 */
	setCliModeProviderSettings(settings: CliModeProviderSettings | undefined) {
		this.cliModeProviderSettings = settings
	}

	get hasCliModeProviderSettings(): boolean {
		return this.cliModeProviderSettings !== undefined
	}

	private getCliProviderSettingsForMode(mode: string): ProviderSettings | undefined {
		const settings = this.cliModeProviderSettings
		return settings ? (settings.modes[mode] ?? settings.base) : undefined
	}

	/**
	 * Resolve where `mode` takes its provider settings from. Reads the profile
	 * store only when neither CLI settings nor the lock apply. A failure to
	 * read the bound profile is returned as `unreadable`; a failure to read
	 * the binding or the profile list is thrown.
	 */
	async resolve(mode: string): Promise<ModeProfileResolution> {
		const cliSettings = this.getCliProviderSettingsForMode(mode)
		if (cliSettings) {
			return { source: "cli", apiConfiguration: cliSettings }
		}

		if (this.host.isApiConfigLockedAcrossModes()) {
			return { source: "locked" }
		}

		const configId = await this.providerSettingsManager.getModeConfigId(mode)
		const profiles = await this.providerSettingsManager.listConfig()

		if (!configId) {
			return { source: "store", profiles, binding: { status: "unbound" } }
		}

		const entry = profiles.find(({ id }) => id === configId)
		if (!entry?.name) {
			return { source: "store", profiles, binding: { status: "missing", configId } }
		}

		const { name } = entry
		try {
			const fullProfile = await this.providerSettingsManager.getProfile({ name })
			const status = fullProfile.apiProvider ? "usable" : "empty"
			return { source: "store", profiles, binding: { status, configId, name } }
		} catch (error) {
			return { source: "store", profiles, binding: { status: "unreadable", configId, name, error } }
		}
	}

	/**
	 * Switch to `newMode`: record it on the current task and in global state,
	 * then apply the mode's provider settings. With no stored binding yet,
	 * the current profile becomes the mode's binding.
	 */
	async handleModeSwitch(newMode: Mode) {
		const task = this.host.getCurrentTask()

		if (task) {
			TelemetryService.instance.capture(TelemetryEventName.MODE_SWITCH, { taskId: task.taskId, newMode })
			task.emit(RooCodeEventName.TaskModeSwitched, task.taskId, newMode)

			try {
				// Update the task history with the new mode first.
				const taskHistoryStore = await this.host.getTaskHistoryStore()
				const taskHistoryItem = taskHistoryStore.get(task.taskId)

				if (taskHistoryItem) {
					await this.host.updateTaskHistory({ ...taskHistoryItem, mode: newMode })
				}

				// Only update the task's mode after successful persistence.
				task.setTaskMode(newMode)
			} catch (error) {
				// If persistence fails, log the error but don't update the in-memory state.
				this.host.log(
					`Failed to persist mode switch for task ${task.taskId}: ${error instanceof Error ? error.message : String(error)}`,
				)

				// This ensures the in-memory state remains consistent with persisted state.
				throw error
			}
		}

		await this.host.updateGlobalState("mode", newMode)

		this.host.emitModeChanged(newMode)

		const resolution = await this.resolve(newMode)

		// The CLI resolves provider settings per mode from its own settings
		// file; they replace the profile store's mode bindings, which the CLI
		// never configures (every mode may still point at an unrelated profile).
		if (resolution.source === "cli") {
			await this.host.contextProxy.setProviderSettings(resolution.apiConfiguration)
			this.updateTaskApiHandlerIfNeeded(resolution.apiConfiguration, { forceRebuild: true })
			await this.host.postStateToWebview()
			return
		}

		// If workspace lock is on, keep the current API config: don't load mode-specific config.
		if (resolution.source === "locked") {
			await this.host.postStateToWebview()
			return
		}

		const { profiles, binding } = resolution

		// Update listApiConfigMeta first to ensure UI has latest data.
		await this.host.updateGlobalState("listApiConfigMeta", profiles)

		if (binding.status === "usable") {
			await this.host.activateProviderProfile({ name: binding.name })
		} else if (binding.status === "unreadable") {
			// A mode switch surfaces a failed profile read to its caller.
			throw binding.error
		} else if (binding.status === "unbound") {
			// If no saved config for this mode, save current config as default.
			const currentApiConfigName = this.host.getGlobalState("currentApiConfigName")

			if (currentApiConfigName) {
				const config = profiles.find((c) => c.name === currentApiConfigName)

				if (config?.id) {
					await this.providerSettingsManager.setModeConfig(newMode, config.id)
				}
			}
		}
		// "missing" and "empty": the task continues with the current configuration.

		await this.host.postStateToWebview()
	}

	/**
	 * Restore the mode and provider profile a task was saved with, before the
	 * task is rebuilt from history. The mode falls back to the default mode
	 * when it no longer exists. The item's own profile (`apiConfigName`) wins
	 * over the mode's binding. In the CLI (runtime flag or per-mode settings)
	 * the profile store is left alone and the mode's CLI settings apply.
	 * Failures to read or activate a profile are logged, never thrown.
	 */
	async restoreForHistoryItem(historyItem: HistoryItem) {
		const isCliRuntime = readCliRuntimeEnv(process.env).isCliRuntime
		// CLI injects runtime provider settings from command flags/env at startup.
		// Restoring provider profiles from task history can overwrite those
		// runtime settings with stale/incomplete persisted profiles. The CLI's
		// per-mode settings replace the profile store the same way, even when
		// ROO_CLI_RUNTIME is not set.
		const skipProfileRestoreFromHistory = isCliRuntime || this.hasCliModeProviderSettings

		// If the history item has a saved mode, restore it and its associated API configuration.
		if (historyItem.mode) {
			// Validate that the mode still exists
			const customModes = await this.host.getCustomModes()
			const modeExists = getModeBySlug(historyItem.mode, customModes) !== undefined

			if (!modeExists) {
				// Mode no longer exists, fall back to default mode.
				this.host.log(
					`Mode '${historyItem.mode}' from history no longer exists. Falling back to default mode '${defaultModeSlug}'.`,
				)
				historyItem.mode = defaultModeSlug
			}

			await this.host.updateGlobalState("mode", historyItem.mode)

			// Load the saved API config for the restored mode if it exists.
			// Skip mode-based profile activation if historyItem.apiConfigName exists,
			// since the task's specific provider profile will override it anyway.
			if (!historyItem.apiConfigName && !skipProfileRestoreFromHistory) {
				const resolution = await this.resolve(historyItem.mode)

				// "locked" keeps the current profile; "cli" cannot occur here
				// (per-mode settings skip the restore above).
				if (resolution.source === "store") {
					const { profiles, binding } = resolution

					// Update listApiConfigMeta first to ensure UI has latest data.
					await this.host.updateGlobalState("listApiConfigMeta", profiles)

					if (binding.status === "usable" || binding.status === "unreadable") {
						try {
							if (binding.status === "unreadable") {
								throw binding.error
							}
							await this.host.activateProviderProfile({ name: binding.name })
						} catch (error) {
							// Log the error but continue with task restoration.
							this.host.log(
								`Failed to restore API configuration for mode '${historyItem.mode}': ${
									error instanceof Error ? error.message : String(error)
								}. Continuing with default configuration.`,
							)
						}
					}
					// Otherwise the task continues with the current/default configuration.
				}
			}
		}

		// If the history item has a saved API config name (provider profile), restore it.
		// This overrides any mode-based config restoration above, because the task's
		// specific provider profile takes precedence over mode defaults.
		if (historyItem.apiConfigName && !skipProfileRestoreFromHistory) {
			const listApiConfig = await this.providerSettingsManager.listConfig()
			// Keep global state/UI in sync with latest profiles for parity with mode restoration above.
			await this.host.updateGlobalState("listApiConfigMeta", listApiConfig)
			const profile = listApiConfig.find(({ name }) => name === historyItem.apiConfigName)

			if (profile?.name) {
				try {
					await this.host.activateProviderProfile(
						{ name: profile.name },
						{ persistModeConfig: false, persistTaskHistory: false },
					)
				} catch (error) {
					// Log the error but continue with task restoration.
					this.host.log(
						`Failed to restore API configuration '${historyItem.apiConfigName}' for task: ${
							error instanceof Error ? error.message : String(error)
						}. Continuing with current configuration.`,
					)
				}
			} else {
				// Profile no longer exists, log warning but continue
				this.host.log(
					`Provider profile '${historyItem.apiConfigName}' from history no longer exists. Using current configuration.`,
				)
			}
		} else if (historyItem.apiConfigName && skipProfileRestoreFromHistory) {
			this.host.log(
				`Skipping restore of provider profile '${historyItem.apiConfigName}' for task ${historyItem.id} in CLI runtime.`,
			)
		}

		// A task resumed in the CLI (including a parent returning from its
		// subtask) runs with the provider settings of its own mode.
		const cliProviderSettings = historyItem.mode ? this.getCliProviderSettingsForMode(historyItem.mode) : undefined
		if (cliProviderSettings) {
			await this.host.contextProxy.setProviderSettings(cliProviderSettings)
		}
	}

	/**
	 * Resolve the API profile pinned to `mode` for a mode-scoped subagent,
	 * without changing the foreground profile. Returns undefined (meaning "use
	 * the current profile") when no binding exists, the profile is an empty
	 * CLI placeholder (no apiProvider), the workspace locks its API config
	 * across modes, or resolution fails for any reason.
	 */
	async getApiConfigurationForMode(
		mode: string,
	): Promise<{ apiConfiguration: ProviderSettings; name: string } | undefined> {
		try {
			const resolution = await this.resolve(mode)

			if (resolution.source === "cli") {
				return {
					apiConfiguration: resolution.apiConfiguration,
					name: this.host.getGlobalState("currentApiConfigName") ?? "default",
				}
			}
			if (resolution.source === "locked") {
				return undefined
			}

			const { binding } = resolution
			if (binding.status === "unreadable") {
				throw binding.error
			}
			if (binding.status !== "usable") {
				return undefined
			}

			// activateProfile also rejects retired and unknown providers.
			const { name, ...profile } = await this.providerSettingsManager.activateProfile({
				id: binding.configId,
			})
			return { apiConfiguration: profile, name }
		} catch (error) {
			this.host.log(
				`[getApiConfigurationForMode] failed for mode "${mode}": ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
			return undefined
		}
	}

	/**
	 * Updates the current task's API handler.
	 * Rebuilds when:
	 * - provider or model changes, OR
	 * - explicitly forced (e.g., user-initiated profile switch/save to apply changed settings like headers/baseUrl/tier).
	 * Always synchronizes task.apiConfiguration with latest provider settings.
	 * @param providerSettings The new provider settings to apply
	 * @param options.forceRebuild Force rebuilding the API handler regardless of provider/model equality
	 */
	private updateTaskApiHandlerIfNeeded(
		providerSettings: ProviderSettings,
		options: { forceRebuild?: boolean } = {},
	): void {
		const task = this.host.getCurrentTask()
		if (!task) return

		const { forceRebuild = false } = options

		// Determine if we need to rebuild using the previous configuration snapshot
		const prevConfig = task.apiConfiguration
		const prevProvider = prevConfig?.apiProvider
		const prevModelId = prevConfig ? getModelId(prevConfig) : undefined
		const newProvider = providerSettings.apiProvider
		const newModelId = getModelId(providerSettings)

		const needsRebuild = forceRebuild || prevProvider !== newProvider || prevModelId !== newModelId

		if (needsRebuild) {
			// Use updateApiConfiguration which handles both API handler rebuild and parser sync.
			// Note: updateApiConfiguration is declared async but has no actual async operations,
			// so we can safely call it without awaiting.
			task.updateApiConfiguration(providerSettings)
		} else {
			// No rebuild needed, just sync apiConfiguration
			task.apiConfiguration = providerSettings
		}
	}

	async upsertProviderProfile(
		name: string,
		providerSettings: ProviderSettings,
		activate: boolean = true,
	): Promise<string | undefined> {
		try {
			// TODO: Do we need to be calling `activateProfile`? It's not
			// clear to me what the source of truth should be; in some cases
			// we rely on the `ContextProxy`'s data store and in other cases
			// we rely on the `ProviderSettingsManager`'s data store. It might
			// be simpler to unify these two.
			const id = await this.providerSettingsManager.saveConfig(name, providerSettings)

			if (activate) {
				const { mode } = await this.host.getState()

				// These promises do the following:
				// 1. Adds or updates the list of provider profiles.
				// 2. Sets the current provider profile.
				// 3. Sets the current mode's provider profile.
				// 4. Copies the provider settings to the context.
				//
				// Note: 1, 2, and 4 can be done in one `ContextProxy` call:
				// this.contextProxy.setValues({ ...providerSettings, listApiConfigMeta: ..., currentApiConfigName: ... })
				// We should probably switch to that and verify that it works.
				// I left the original implementation in just to be safe.
				await Promise.all([
					this.host.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
					this.host.updateGlobalState("currentApiConfigName", name),
					this.providerSettingsManager.setModeConfig(mode, id),
					this.host.contextProxy.setProviderSettings(providerSettings),
				])

				// Change the provider for the current task.
				// TODO: We should rename `buildApiHandler` for clarity (e.g. `getProviderClient`).
				this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })

				// Keep the current task's sticky provider profile in sync with the newly-activated profile.
				await this.persistStickyProviderProfileToCurrentTask(name)
			} else {
				await this.host.updateGlobalState("listApiConfigMeta", await this.providerSettingsManager.listConfig())
			}

			await this.host.postStateToWebview()
			// A successful profile save proves storage is writable again, so
			// drop a previously reported storage error (the banner then
			// disappears on this state push).
			this.host.clearStorageError()
			return id
		} catch (error) {
			this.host.log(
				`Error create new api configuration: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
			)

			const message = error instanceof Error ? error.message : String(error)
			this.host.reportStorageError(error)
			vscode.window.showErrorMessage(t("common:errors.create_api_config") + ": " + message)
			return undefined
		}
	}

	private async persistStickyProviderProfileToCurrentTask(apiConfigName: string): Promise<void> {
		const task = this.host.getCurrentTask()
		if (!task) {
			return
		}

		try {
			// Update in-memory state immediately so sticky behavior works even before the task has
			// been persisted into taskHistory (it will be captured on the next save).
			task.setTaskApiConfigName(apiConfigName)

			const taskHistoryStore = await this.host.getTaskHistoryStore()
			const taskHistoryItem = taskHistoryStore.get(task.taskId)

			if (taskHistoryItem) {
				await this.host.updateTaskHistory({ ...taskHistoryItem, apiConfigName })
			}
		} catch (error) {
			// If persistence fails, log the error but don't fail the profile switch.
			this.host.log(
				`Failed to persist provider profile switch for task ${task.taskId}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}
	}

	async activateProviderProfile(
		args: { name: string } | { id: string },
		options?: { persistModeConfig?: boolean; persistTaskHistory?: boolean },
	) {
		const { name, id, ...providerSettings } = await this.providerSettingsManager.activateProfile(args)

		const persistModeConfig = options?.persistModeConfig ?? true
		const persistTaskHistory = options?.persistTaskHistory ?? true

		// See `upsertProviderProfile` for a description of what this is doing.
		await Promise.all([
			this.host.contextProxy.setValue("listApiConfigMeta", await this.providerSettingsManager.listConfig()),
			this.host.contextProxy.setValue("currentApiConfigName", name),
			this.host.contextProxy.setProviderSettings(providerSettings),
		])

		const { mode } = await this.host.getState()

		if (id && persistModeConfig) {
			await this.providerSettingsManager.setModeConfig(mode, id)
		}

		// Change the provider for the current task.
		this.updateTaskApiHandlerIfNeeded(providerSettings, { forceRebuild: true })

		// Update the current task's sticky provider profile, unless this activation is
		// being used purely as a non-persisting restoration (e.g., reopening a task from history).
		if (persistTaskHistory) {
			await this.persistStickyProviderProfileToCurrentTask(name)
		}

		await this.host.postStateToWebview()

		if (providerSettings.apiProvider) {
			this.host.emitProviderProfileChanged({ name, provider: providerSettings.apiProvider })
		}
	}
}
