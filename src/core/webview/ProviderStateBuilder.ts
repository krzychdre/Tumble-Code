import * as vscode from "vscode"

import {
	type CloudOrganizationMembership,
	type CloudUserInfo,
	type ExtensionState,
	type HistoryItem,
	type McpServer,
	type ModeConfig,
	type OrganizationAllowList,
	type ProviderName,
	type RooCodeSettings,
	type SubagentSummary,
	ORGANIZATION_ALLOW_ALL,
	SETTINGS_DEFAULT_KEYS,
	isRetiredProvider,
	resolveSettings,
} from "@roo-code/types"
import { CloudService, getRooCodeApiUrl } from "@roo-code/cloud"

import { Package } from "../../shared/package"
import { defaultModeSlug } from "../../shared/modes"
import { experimentDefault } from "../../shared/experiments"
import { formatLanguage } from "../../shared/language"
import { EMBEDDING_MODEL_PROFILES } from "../../shared/embeddingModels"
import { resolveCustomSoundUri } from "../../integrations/misc/custom-sounds"

import type { ContextProxy } from "../config/ContextProxy"
import type { Task } from "../task/Task"
import type { TaskHistoryStore } from "../task-persistence"
import { sanitizeCommandList } from "../auto-approval/sanitizeCommandList"

/** What `ClineProvider.getState()` returns: the settings accessor of the extension host. */
export type ProviderState = Omit<
	ExtensionState,
	"clineMessages" | "renderContext" | "hasOpenedModeSelector" | "version" | "shouldShowAnnouncement"
>

/** Settings that `getState()` exposes as stored, without a default. */
const PASSTHROUGH_SETTING_KEYS = [
	"lastShownAnnouncementId",
	"customInstructions",
	"apiModelId",
	"allowedMaxRequests",
	"allowedMaxCost",
	// "" means "use the current profile" (decision 18); it is posted as "" so
	// the Settings view shows the cleared value.
	"autoCondenseContextApiConfigId",
	"memoryWriterApiConfigId",
	// The Memory tab edits these. Without them in the push it showed its own
	// defaults and Save sent those back over the stored values. The migration
	// in ContextProxy gives the flags and thresholds their defaults; an unset
	// or "" autoMemoryDirectory means the default folder.
	"autoMemoryEnabled",
	"autoMemoryDirectory",
	"autoMemoryShareWithClaudeCode",
	"memoryRecallEnabled",
	"autoDreamEnabled",
	"autoDreamMinHours",
	"autoDreamMinSessions",
	"terminalProfile",
	"enhancementApiConfigId",
	"disabledTools",
	"customCondensingPrompt",
	"imageGenerationProvider",
	"openRouterImageApiKey",
	"openRouterImageGenerationSelectedModel",
] as const satisfies readonly (keyof RooCodeSettings)[]

/**
 * Keys `getState()` carries for host code that the webview state never had.
 * Kept out of the posted state so its shape stays what the webview knows.
 */
const HOST_ONLY_KEYS = ["lastShownAnnouncementId", "apiModelId", "diagnosticsEnabled", "modeApiConfigs"] as const

const CLOUD_ORGANIZATIONS_CACHE_DURATION_MS = 5 * 1000

const pick = <T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> => {
	const picked = {} as Pick<T, K>
	for (const key of keys) {
		picked[key] = source[key]
	}
	return picked
}

/**
 * The settings with every default applied: the static table from
 * `@roo-code/types` plus the defaults only the extension host knows (the
 * first built-in mode, the VS Code display language, the experiment and
 * embedding-model registries).
 */
const resolveHostSettings = <T extends Partial<RooCodeSettings>>(values: T) => {
	const settings = resolveSettings(values)
	return {
		settings,
		mode: values.mode ?? defaultModeSlug,
		language: values.language ?? formatLanguage(vscode.env.language),
		experiments: values.experiments ?? experimentDefault,
		codebaseIndexModels: values.codebaseIndexModels ?? EMBEDDING_MODEL_PROFILES,
	}
}

interface CloudFacts {
	cloudUserInfo: CloudUserInfo | null
	cloudIsAuthenticated: boolean
	sharingEnabled: boolean
	publicSharingEnabled: boolean
	organizationAllowList: OrganizationAllowList
	organizationSettingsVersion: number
	taskSyncEnabled: boolean
}

/**
 * Reads what the cloud service knows, one fact at a time: a missing or
 * failing CloudService leaves the signed-out value of that fact and logs why.
 */
async function readCloudFacts(): Promise<CloudFacts> {
	// Synchronous facts are read without an await, so a state build takes as
	// many microtask turns as before CORE-R1 (timing-sensitive callers exist).
	const logFailure = (what: string, error: unknown) =>
		console.error(`[getState] failed to get ${what}: ${error instanceof Error ? error.message : String(error)}`)

	let organizationAllowList: OrganizationAllowList = ORGANIZATION_ALLOW_ALL
	try {
		organizationAllowList = await CloudService.instance.getAllowList()
	} catch (error) {
		logFailure("organization allow list", error)
	}

	let cloudUserInfo: CloudUserInfo | null = null
	try {
		cloudUserInfo = CloudService.instance.getUserInfo()
	} catch (error) {
		logFailure("cloud user info", error)
	}

	let cloudIsAuthenticated = false
	try {
		cloudIsAuthenticated = CloudService.instance.isAuthenticated()
	} catch (error) {
		logFailure("cloud authentication state", error)
	}

	let sharingEnabled = false
	try {
		sharingEnabled = await CloudService.instance.canShareTask()
	} catch (error) {
		logFailure("sharing enabled state", error)
	}

	let publicSharingEnabled = false
	try {
		publicSharingEnabled = await CloudService.instance.canSharePublicly()
	} catch (error) {
		logFailure("public sharing enabled state", error)
	}

	let organizationSettingsVersion = -1
	try {
		if (CloudService.hasInstance()) {
			organizationSettingsVersion = CloudService.instance.getOrganizationSettings()?.version ?? -1
		}
	} catch (error) {
		logFailure("organization settings version", error)
	}

	let taskSyncEnabled = false
	try {
		taskSyncEnabled = CloudService.instance.isTaskSyncEnabled()
	} catch (error) {
		logFailure("task sync enabled state", error)
	}

	return {
		cloudUserInfo,
		cloudIsAuthenticated,
		sharingEnabled,
		publicSharingEnabled,
		organizationAllowList,
		organizationSettingsVersion,
		taskSyncEnabled,
	}
}

/**
 * The allowed and denied command lists that apply: the global-state list
 * merged with the VS Code setting of the same name (global state first,
 * duplicates and invalid entries dropped). `getState()` returns them, so the
 * approval decision (`checkAutoApproval`) and the webview see the same lists.
 *
 * The scopes differ on purpose. A denied command counts from every scope,
 * including a workspace's `.vscode/settings.json`: denying is always safe. An
 * allowed command counts only from the user settings: a cloned repository
 * must not be able to grant itself auto-execution.
 */
function resolveCommandList(key: "allowedCommands" | "deniedCommands", globalStateCommands?: string[]): string[] {
	const fromGlobalState = sanitizeCommandList(globalStateCommands)
	try {
		const scopes = vscode.workspace.getConfiguration(Package.name).inspect<string[]>(key)
		const fromSettings =
			key === "deniedCommands"
				? [scopes?.globalValue, scopes?.workspaceValue, scopes?.workspaceFolderValue].flatMap(sanitizeCommandList)
				: sanitizeCommandList(scopes?.globalValue)
		return [...new Set([...fromGlobalState, ...fromSettings])]
	} catch (error) {
		console.error(`Error reading the ${key} setting:`, error)
		return [...new Set(fromGlobalState)]
	}
}

/** What the builder needs from the provider, as narrow read-only callbacks. */
interface ProviderStateSources {
	contextProxy: Pick<ContextProxy, "getValues" | "getProviderSettings" | "globalStorageUri">
	getCustomModes(): Promise<ModeConfig[]>
	getCwd(): string
	getMcpServers(): McpServer[]
	isApiConfigLockedAcrossModes(): boolean | undefined

	/** The provider's own `getState()`, so the webview state follows it (and test spies on it). */
	getState(): Promise<ProviderState>
	getTaskHistoryStore(): Promise<Pick<TaskHistoryStore, "get" | "getAll">>
	log(message: string): void
	getCurrentTask(): Pick<Task, "taskId" | "clineMessages" | "todoList" | "messageQueueService"> | undefined
	/** Advances and returns the clineMessages sequence number (see ClineProvider.clineMessagesSeq). */
	nextClineMessagesSeq(): number
	listSubagents(): SubagentSummary[]
	getMemoryActivity(): { recall: number; write: number }
	getWebview(): vscode.Webview | undefined
	getExtensionVersion(): string
	getStorageErrorMessage(): string
	getSettingsImportedAt(): number | undefined
	getCloudAuthSkipModel(): boolean | undefined
	getHasOpenedModeSelector(): boolean | undefined
	/** undefined without an MDM policy, otherwise whether the user complies with it. */
	getMdmCompliance(): boolean | undefined
	latestAnnouncementId: string
	renderContext: "sidebar" | "editor"
}

/**
 * Builds the two views of the provider state (CORE-R1):
 * `getState()` = the resolved settings plus the cloud facts, and
 * `getStateToPostToWebview()` = `getState()` plus the view-only fields.
 */
export class ProviderStateBuilder {
	private cloudOrganizationsCache: CloudOrganizationMembership[] | null = null
	private cloudOrganizationsCacheTimestamp: number | null = null

	constructor(private readonly sources: ProviderStateSources) {}

	async getState(): Promise<ProviderState> {
		const stateValues = this.sources.contextProxy.getValues()
		const customModes = await this.sources.getCustomModes()

		// Retired providers fall back to the default provider.
		const apiProvider: ProviderName =
			stateValues.apiProvider && !isRetiredProvider(stateValues.apiProvider)
				? stateValues.apiProvider
				: "anthropic"

		const providerSettings = this.sources.contextProxy.getProviderSettings()

		if (!providerSettings.apiProvider) {
			providerSettings.apiProvider = apiProvider
		}

		const cloud = await readCloudFacts()
		const { settings, ...hostDefaults } = resolveHostSettings(stateValues)

		return {
			...pick(settings, SETTINGS_DEFAULT_KEYS),
			...pick(settings, PASSTHROUGH_SETTING_KEYS),
			...hostDefaults,
			allowedCommands: resolveCommandList("allowedCommands", settings.allowedCommands),
			deniedCommands: resolveCommandList("deniedCommands", settings.deniedCommands),
			maxInlineToolResultBytes: settings.maxInlineToolResultBytes,
			pruneBeforeCondense: settings.pruneBeforeCondense,
			pruneToolResultBudget: settings.pruneToolResultBudget,
			codebaseIndexConfig: settings.codebaseIndexConfig,
			...cloud,
			apiConfiguration: providerSettings,
			// The plan-review write gate (checkAutoApproval) resolves relative
			// tool paths against cwd; TaskAskSay and subagent approval read it here.
			cwd: this.sources.getCwd(),
			customModes,
			mcpServers: this.sources.getMcpServers(),
			// `getState` is a hot path (system prompt building, auto-approval,
			// retry, plan review) that never reads task history, so it never
			// materializes it. Callers that need the history use
			// `getTaskHistory` or `getStateToPostToWebview`.
			taskHistory: [],
			lockApiConfigAcrossModes: this.sources.isApiConfigLockedAcrossModes() ?? false,
		}
	}

	async getStateToPostToWebview(options: { includeTaskHistory?: boolean } = {}): Promise<ExtensionState> {
		const { includeTaskHistory = true } = options
		// Ensure the store is initialized before reading task history. Even
		// when `includeTaskHistory` is false we still await readiness so the
		// cache is populated for `currentTaskItem` lookups below.
		//
		// When the store is down, degrade instead of throwing: the state is
		// built with an EMPTY history so settings, profiles and chat keep
		// working when only the history store is unavailable. The failure was
		// already reported as a persistent storage error by the provider
		// (surfaced below via `storageErrorMessage`).
		let taskHistoryStore: Pick<TaskHistoryStore, "get" | "getAll"> | undefined
		try {
			taskHistoryStore = await this.sources.getTaskHistoryStore()
		} catch (error) {
			this.sources.log(
				`[state] TaskHistoryStore unavailable, sending empty history: ${error instanceof Error ? error.message : String(error)}`,
			)
		}

		const state = await this.sources.getState()
		// Resolve again: a no-op for the real getState(), and it keeps every
		// default in place when getState() is replaced (tests, partial states).
		const { settings, ...hostDefaults } = resolveHostSettings(state as Partial<RooCodeSettings>)
		const {
			lastShownAnnouncementId: _lastShownAnnouncementId,
			apiModelId: _apiModelId,
			diagnosticsEnabled: _diagnosticsEnabled,
			modeApiConfigs: _modeApiConfigs,
			...shared
		} = settings as typeof settings & Record<(typeof HOST_ONLY_KEYS)[number], unknown>

		const cloudOrganizations = await this.getCloudOrganizations()
		const currentTask = this.sources.getCurrentTask()
		const customSoundUris = await this.resolveCustomSoundUris(settings)

		return {
			...(shared as unknown as ExtensionState),
			...hostDefaults,
			version: this.sources.getExtensionVersion(),
			// Empty string means "no storage error" (postMessage drops
			// undefined keys, so only an explicit value can clear the
			// webview's banner).
			storageErrorMessage: this.sources.getStorageErrorMessage(),
			cloudIsAuthenticated: state.cloudIsAuthenticated ?? false,
			sharingEnabled: state.sharingEnabled ?? false,
			publicSharingEnabled: state.publicSharingEnabled ?? false,
			lockApiConfigAcrossModes: state.lockApiConfigAcrossModes ?? false,
			uriScheme: vscode.env.uriScheme,
			currentTaskId: currentTask?.taskId,
			currentTaskItem: currentTask?.taskId ? taskHistoryStore?.get(currentTask.taskId) : undefined,
			clineMessages: currentTask?.clineMessages || [],
			// Numbered here, synchronously with the read above (see ClineProvider.clineMessagesSeq).
			clineMessagesSeq: this.sources.nextClineMessagesSeq(),
			subagents: this.sources.listSubagents(),
			memoryActivity: { ...this.sources.getMemoryActivity() },
			currentTaskTodos: currentTask?.todoList || [],
			messageQueue: currentTask?.messageQueueService?.messages,
			// Only materialize the full history when the caller needs it. The
			// `postStateToWebviewWithout*` variants pass `includeTaskHistory:
			// false`, so this hot path (every chat message update, every
			// cloud or mode event) never calls `getAll()`; the webview keeps
			// its list in sync through the targeted history messages.
			taskHistory:
				includeTaskHistory && taskHistoryStore
					? taskHistoryStore.getAll().filter((item: HistoryItem) => item.ts && item.task)
					: [],
			customSoundUris,
			shouldShowAnnouncement:
				settings.telemetrySetting !== "unset" &&
				state.lastShownAnnouncementId !== this.sources.latestAnnouncementId,
			mcpServers: this.sources.getMcpServers(),
			telemetryKey: process.env.POSTHOG_API_KEY,
			machineId: vscode.env.machineId,
			renderContext: this.sources.renderContext,
			settingsImportedAt: this.sources.getSettingsImportedAt(),
			cloudAuthSkipModel: this.sources.getCloudAuthSkipModel() ?? false,
			cloudOrganizations,
			// No pre-filled embedding dimension: the code-index form sends every
			// field back on save, so a view-only default would be stored as if
			// the user had entered it (DEF-C42). Unset means "use the model's own
			// dimension"; the form shows its placeholder instead.
			codebaseIndexConfig: settings.codebaseIndexConfig,
			// undefined means no MDM policy, true compliant, false non-compliant.
			mdmCompliant: this.sources.getMdmCompliance(),
			cloudApiUrl: getRooCodeApiUrl(),
			hasOpenedModeSelector: this.sources.getHasOpenedModeSelector() ?? false,
			openAiCodexIsAuthenticated: await (async () => {
				try {
					const { openAiCodexOAuthManager } = await import("../../integrations/openai-codex/oauth")
					return await openAiCodexOAuthManager.getAuthenticationStatus()
				} catch {
					return false
				}
			})(),
			debug: vscode.workspace.getConfiguration(Package.name).get<boolean>("debug", false),
		}
	}

	/** Organization memberships for the account menu, cached for a few seconds. */
	private async getCloudOrganizations(): Promise<CloudOrganizationMembership[]> {
		try {
			if (CloudService.instance.isCloudAgent) {
				return []
			}

			const now = Date.now()

			if (
				this.cloudOrganizationsCache !== null &&
				this.cloudOrganizationsCacheTimestamp !== null &&
				now - this.cloudOrganizationsCacheTimestamp < CLOUD_ORGANIZATIONS_CACHE_DURATION_MS
			) {
				return this.cloudOrganizationsCache
			}

			const organizations = await CloudService.instance.getOrganizationMemberships()
			this.cloudOrganizationsCache = organizations
			this.cloudOrganizationsCacheTimestamp = now
			return organizations
		} catch {
			return []
		}
	}

	/** User-uploaded custom sound files as webview URIs (a missing entry means the built-in sound). */
	private async resolveCustomSoundUris(
		settings: Pick<
			RooCodeSettings,
			"customSoundCelebration" | "customSoundProgressLoop" | "customSoundNotification"
		>,
	): Promise<NonNullable<ExtensionState["customSoundUris"]>> {
		const customSoundUris: NonNullable<ExtensionState["customSoundUris"]> = {}
		const webview = this.sources.getWebview()

		if (webview) {
			const globalStoragePath = this.sources.contextProxy.globalStorageUri.fsPath
			const [celebrationUri, progressLoopUri, notificationUri] = await Promise.all([
				resolveCustomSoundUri(webview, globalStoragePath, settings.customSoundCelebration),
				resolveCustomSoundUri(webview, globalStoragePath, settings.customSoundProgressLoop),
				resolveCustomSoundUri(webview, globalStoragePath, settings.customSoundNotification),
			])
			if (celebrationUri) customSoundUris.celebration = celebrationUri
			if (progressLoopUri) customSoundUris.progress_loop = progressLoopUri
			if (notificationUri) customSoundUris.notification = notificationUri
		}

		return customSoundUris
	}
}
