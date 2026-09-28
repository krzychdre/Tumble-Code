import * as vscode from "vscode"
import { ZodError } from "zod"

import {
	PROVIDER_SETTINGS_KEYS,
	GLOBAL_SETTINGS_KEYS,
	SECRET_STATE_KEYS,
	GLOBAL_STATE_KEYS,
	GLOBAL_SECRET_KEYS,
	type ProviderSettings,
	type GlobalSettings,
	type SecretState,
	type GlobalState,
	type RooCodeSettings,
	providerSettingsSchema,
	globalSettingsSchema,
	isSecretStateKey,
	isProviderName,
	isRetiredProvider,
	TelemetryEventName,
} from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { logger } from "../../utils/logging"
import { validateMemoryPath } from "../memory/paths"
import { TaskHistoryStore } from "../task-persistence"

import { runStartupMigrations } from "./migrations/runner"
import { CONTEXT_PROXY_MIGRATIONS } from "./migrations/context-proxy/registry"

type GlobalStateKey = keyof GlobalState
type SecretStateKey = keyof SecretState
type RooCodeSettingsKey = keyof RooCodeSettings

const PASS_THROUGH_STATE_KEYS = [
	"autoMemoryEnabled",
	"autoDreamEnabled",
	"memoryRecallEnabled",
	"autoMemoryShareWithClaudeCode",
]

export const isPassThroughStateKey = (key: string) => PASS_THROUGH_STATE_KEYS.includes(key)

const globalSettingsExportSchema = globalSettingsSchema.omit({
	listApiConfigMeta: true,
	currentApiConfigName: true,
})

export class ContextProxy {
	private readonly originalContext: vscode.ExtensionContext

	private stateCache: GlobalState
	private secretCache: SecretState
	private _isInitialized = false

	constructor(context: vscode.ExtensionContext) {
		this.originalContext = context
		this.stateCache = {}
		this.secretCache = {}
		this._isInitialized = false
	}

	public get isInitialized() {
		return this._isInitialized
	}

	public async initialize() {
		for (const key of GLOBAL_STATE_KEYS) {
			try {
				// Revert to original assignment
				this.stateCache[key] = this.originalContext.globalState.get(key)
			} catch (error) {
				logger.error(`Error loading global ${key}: ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		const promises = [
			...SECRET_STATE_KEYS.map(async (key) => {
				try {
					this.secretCache[key] = await this.originalContext.secrets.get(key)
				} catch (error) {
					logger.error(
						`Error loading secret ${key}: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}),
			...GLOBAL_SECRET_KEYS.map(async (key) => {
				try {
					this.secretCache[key] = await this.originalContext.secrets.get(key)
				} catch (error) {
					logger.error(
						`Error loading global secret ${key}: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}),
		]

		await Promise.all(promises)

		// One-shot legacy-state migrations (one dated file each under
		// ./migrations/context-proxy). Each detects its own legacy key and is a
		// no-op once that key is gone.
		await runStartupMigrations(CONTEXT_PROXY_MIGRATIONS, {
			globalState: this.originalContext.globalState,
			secrets: this.originalContext.secrets,
			stateCache: this.stateCache,
			secretCache: this.secretCache,
			storeSecret: (key, value) => this.storeSecret(key, value),
		})

		this._isInitialized = true
	}

	/**
	 * Reads the legacy `taskHistory` globalState array, if any.
	 *
	 * Used by `TaskHistoryGateway` (its legacy migration) to backfill
	 * per-task `history_item.json` files before clearing the legacy key.
	 * Returns `undefined` when the key is absent so callers can avoid
	 * materializing a potentially large array on every start.
	 */
	public getLegacyTaskHistory<T = unknown>(): T[] | undefined {
		const value = this.originalContext.globalState.get<T[]>(TaskHistoryStore.LEGACY_TASK_HISTORY_KEY)
		return Array.isArray(value) ? value : undefined
	}

	/**
	 * Clears the obsolete legacy `taskHistory` and `taskHistoryMigratedToFiles`
	 * globalState keys.
	 *
	 * Called by `ClineProvider` only after the legacy array has been
	 * successfully migrated into per-task files, so the next start is a
	 * no-op and we never lose data on a failed migration. Best-effort:
	 * a failure to clear one key does not prevent clearing the other and
	 * never throws.
	 */
	public async clearLegacyTaskHistoryKeys(): Promise<void> {
		for (const key of [TaskHistoryStore.LEGACY_TASK_HISTORY_KEY, TaskHistoryStore.LEGACY_MIGRATION_MARKER_KEY]) {
			try {
				await this.originalContext.globalState.update(key, undefined)
			} catch (error) {
				logger.error(
					`Error clearing legacy ${key} key: ${error instanceof Error ? error.message : String(error)}`,
				)
			}
		}
	}

	/**
	 * Reports whether the legacy `taskHistory` globalState key still holds a
	 * value that needs migrating. Used to skip the migration path entirely on
	 * subsequent starts once cleanup has run.
	 */
	public hasLegacyTaskHistory(): boolean {
		return this.originalContext.globalState.get(TaskHistoryStore.LEGACY_TASK_HISTORY_KEY) !== undefined
	}

	public get extensionUri() {
		return this.originalContext.extensionUri
	}

	public get extensionPath() {
		return this.originalContext.extensionPath
	}

	public get globalStorageUri() {
		return this.originalContext.globalStorageUri
	}

	public get logUri() {
		return this.originalContext.logUri
	}

	public get extension() {
		return this.originalContext.extension
	}

	public get extensionMode() {
		return this.originalContext.extensionMode
	}

	/**
	 * ExtensionContext.globalState
	 * https://code.visualstudio.com/api/references/vscode-api#ExtensionContext.globalState
	 */

	getGlobalState<K extends GlobalStateKey>(key: K): GlobalState[K]
	getGlobalState<K extends GlobalStateKey>(key: K, defaultValue: GlobalState[K]): GlobalState[K]
	getGlobalState<K extends GlobalStateKey>(key: K, defaultValue?: GlobalState[K]): GlobalState[K] {
		if (isPassThroughStateKey(key)) {
			const value = this.originalContext.globalState.get<GlobalState[K]>(key)
			return value === undefined || value === null ? defaultValue : value
		}

		const value = this.stateCache[key]
		return value !== undefined ? value : defaultValue
	}

	updateGlobalState<K extends GlobalStateKey>(key: K, value: GlobalState[K]) {
		if (isPassThroughStateKey(key)) {
			return this.originalContext.globalState.update(key, value)
		}

		this.stateCache[key] = value
		return this.originalContext.globalState.update(key, value)
	}

	private getAllGlobalState(): GlobalState {
		return Object.fromEntries(GLOBAL_STATE_KEYS.map((key) => [key, this.getGlobalState(key)]))
	}

	/**
	 * ExtensionContext.secrets
	 * https://code.visualstudio.com/api/references/vscode-api#ExtensionContext.secrets
	 */

	getSecret(key: SecretStateKey) {
		return this.secretCache[key]
	}

	storeSecret(key: SecretStateKey, value?: string) {
		// Update cache.
		this.secretCache[key] = value

		// Write directly to context.
		return value === undefined
			? this.originalContext.secrets.delete(key)
			: this.originalContext.secrets.store(key, value)
	}

	/**
	 * Refresh secrets from storage and update cache
	 * This is useful when you need to ensure the cache has the latest values
	 */
	async refreshSecrets(): Promise<void> {
		const promises = [
			...SECRET_STATE_KEYS.map(async (key) => {
				try {
					this.secretCache[key] = await this.originalContext.secrets.get(key)
				} catch (error) {
					logger.error(
						`Error refreshing secret ${key}: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}),
			...GLOBAL_SECRET_KEYS.map(async (key) => {
				try {
					this.secretCache[key] = await this.originalContext.secrets.get(key)
				} catch (error) {
					logger.error(
						`Error refreshing global secret ${key}: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}),
		]
		await Promise.all(promises)
	}

	private getAllSecretState(): SecretState {
		return Object.fromEntries([
			...SECRET_STATE_KEYS.map((key) => [key, this.getSecret(key as SecretStateKey)]),
			...GLOBAL_SECRET_KEYS.map((key) => [key, this.getSecret(key as SecretStateKey)]),
		])
	}

	/**
	 * GlobalSettings
	 */

	public getGlobalSettings(): GlobalSettings {
		const values = this.getValues()

		try {
			return globalSettingsSchema.parse(values)
		} catch (error) {
			if (error instanceof ZodError) {
				TelemetryService.instance.capture(TelemetryEventName.SCHEMA_VALIDATION_ERROR, {
					schemaName: "GlobalSettings",
					error: error.format(),
				})
			}

			return GLOBAL_SETTINGS_KEYS.reduce((acc, key) => ({ ...acc, [key]: values[key] }), {} as GlobalSettings)
		}
	}

	/**
	 * ProviderSettings
	 */

	public getProviderSettings(): ProviderSettings {
		const values = this.getValues()

		// Sanitize invalid/removed apiProvider values before parsing
		// This handles cases where a user had a provider selected that was later removed
		// from the extension (e.g., "glama"). We sanitize here to avoid repeated
		// schema validation errors that can cause infinite loops in telemetry.
		const sanitizedValues = this.sanitizeProviderValues(values)

		try {
			return providerSettingsSchema.parse(sanitizedValues)
		} catch (error) {
			if (error instanceof ZodError) {
				TelemetryService.instance.capture(TelemetryEventName.SCHEMA_VALIDATION_ERROR, {
					schemaName: "ProviderSettings",
					error: error.format(),
				})
			}

			return PROVIDER_SETTINGS_KEYS.reduce(
				(acc, key) => ({ ...acc, [key]: sanitizedValues[key] }),
				{} as ProviderSettings,
			)
		}
	}

	/**
	 * Sanitizes provider values by resetting unknown apiProvider values.
	 * Active and retired providers are preserved.
	 */
	private sanitizeProviderValues(values: RooCodeSettings): RooCodeSettings {
		// Remove legacy Claude Code CLI wrapper keys that may still exist in global state.
		// These keys were used by a removed local CLI runner and are no longer part of ProviderSettings.
		const legacyKeys = ["claudeCodePath", "claudeCodeMaxOutputTokens"] as const

		let sanitizedValues = values
		for (const key of legacyKeys) {
			if (key in sanitizedValues) {
				const copy = { ...sanitizedValues } as Record<string, unknown>
				delete copy[key as string]
				sanitizedValues = copy as RooCodeSettings
			}
		}

		const isKnownProvider =
			typeof values.apiProvider === "string" &&
			(isProviderName(values.apiProvider) || isRetiredProvider(values.apiProvider))

		if (values.apiProvider !== undefined && !isKnownProvider) {
			logger.info(`[ContextProxy] Sanitizing invalid provider "${values.apiProvider}" - resetting to undefined`)
			// Return a new values object without the invalid apiProvider
			const { apiProvider, ...restValues } = sanitizedValues
			return restValues as RooCodeSettings
		}
		return sanitizedValues
	}

	public async setProviderSettings(values: ProviderSettings) {
		// Explicitly clear out any old API configuration values before that
		// might not be present in the new configuration.
		// If a value is not present in the new configuration, then it is assumed
		// that the setting's value should be `undefined` and therefore we
		// need to remove it from the state cache if it exists.

		// Ensure openAiHeaders is always an object even when empty
		// This is critical for proper serialization/deserialization through IPC
		if (values.openAiHeaders !== undefined) {
			// Check if it's empty or null
			if (!values.openAiHeaders || Object.keys(values.openAiHeaders).length === 0) {
				values.openAiHeaders = {}
			}
		}

		await this.setValues({
			...PROVIDER_SETTINGS_KEYS.filter((key) => !isSecretStateKey(key))
				.filter((key) => !!this.stateCache[key])
				.reduce((acc, key) => ({ ...acc, [key]: undefined }), {} as ProviderSettings),
			...values,
		})
	}

	/**
	 * RooCodeSettings
	 */

	public async setValue<K extends RooCodeSettingsKey>(key: K, value: RooCodeSettings[K]) {
		// Trusted-source guard for the memory-directory override: validate the
		// path before persisting. An invalid path is rejected (cleared) rather
		// than stored, so a bad value can't redirect the write carve-out or
		// crash the path module. Project-scoped sourcing is the webview
		// handler's responsibility; here we only validate the value itself.
		if (key === "autoMemoryDirectory" && typeof value === "string" && value.trim() !== "") {
			try {
				value = validateMemoryPath(value) as RooCodeSettings[K]
			} catch (error) {
				logger.error(
					`[memory] rejected invalid autoMemoryDirectory "${value}": ${
						error instanceof Error ? error.message : String(error)
					}`,
				)
				value = undefined as RooCodeSettings[K]
			}
		}
		return isSecretStateKey(key)
			? this.storeSecret(key as SecretStateKey, value as string)
			: this.updateGlobalState(key as GlobalStateKey, value)
	}

	public getValue<K extends RooCodeSettingsKey>(key: K): RooCodeSettings[K] {
		return isSecretStateKey(key)
			? (this.getSecret(key as SecretStateKey) as RooCodeSettings[K])
			: (this.getGlobalState(key as GlobalStateKey) as RooCodeSettings[K])
	}

	public getValues(): RooCodeSettings {
		const globalState = this.getAllGlobalState()
		const secretState = this.getAllSecretState()

		// Simply merge all states - no nested secrets to handle
		return { ...globalState, ...secretState }
	}

	public async setValues(values: RooCodeSettings) {
		const entries = Object.entries(values) as [RooCodeSettingsKey, unknown][]
		await Promise.all(entries.map(([key, value]) => this.setValue(key, value)))
	}

	/**
	 * Import / Export
	 */

	public async export(): Promise<GlobalSettings | undefined> {
		try {
			const globalSettings = globalSettingsExportSchema.parse(this.getValues())

			// Exports should only contain global settings, so this skips project custom modes (those exist in the .roomode folder)
			globalSettings.customModes = globalSettings.customModes?.filter((mode) => mode.source === "global")

			return Object.fromEntries(Object.entries(globalSettings).filter(([_, value]) => value !== undefined))
		} catch (error) {
			if (error instanceof ZodError) {
				TelemetryService.instance.capture(TelemetryEventName.SCHEMA_VALIDATION_ERROR, {
					schemaName: "GlobalSettings",
					error: error.format(),
				})
			}

			return undefined
		}
	}

	/**
	 * Resets all global state, secrets, and in-memory caches.
	 * This clears all data from both the in-memory caches and the VSCode storage.
	 * @returns A promise that resolves when all reset operations are complete
	 */
	public async resetAllState() {
		// Clear in-memory caches
		this.stateCache = {}
		this.secretCache = {}

		await Promise.all([
			...GLOBAL_STATE_KEYS.map((key) => this.originalContext.globalState.update(key, undefined)),
			...SECRET_STATE_KEYS.map((key) => this.originalContext.secrets.delete(key)),
			...GLOBAL_SECRET_KEYS.map((key) => this.originalContext.secrets.delete(key)),
		])

		await this.initialize()
	}

	private static _instance: ContextProxy | null = null

	static get instance() {
		if (!this._instance) {
			throw new Error("ContextProxy not initialized")
		}

		return this._instance
	}

	static async getInstance(context: vscode.ExtensionContext) {
		if (this._instance) {
			return this._instance
		}

		this._instance = new ContextProxy(context)
		await this._instance.initialize()

		return this._instance
	}
}
