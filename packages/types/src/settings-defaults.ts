import { resolveMaxInlineToolResultBytes } from "./artifact-spill.js"
import type { CodebaseIndexConfig } from "./codebase-index.js"
import {
	type GlobalSettings,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	DEFAULT_ENABLE_CHECKPOINTS,
	DEFAULT_PARALLEL_TASKS_MAX_CONCURRENCY,
	DEFAULT_SOUND_ENABLED,
	DEFAULT_SUBAGENT_FOLLOWUP_TIMEOUT_SEC,
	DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS,
	DEFAULT_WRITE_DELAY_MS,
} from "./global-settings.js"
import { isPruneBeforeCondenseEnabled, resolvePruneToolResultBudget } from "./prune-condense.js"
import { WEB_TOOLS_DEFAULTS } from "./web-tools.js"

/**
 * The value a setting takes when the user never set it. `null` is a real
 * value for the settings whose schema allows it (an unset custom sound): the
 * webview can only clear a slot through an explicit null, because
 * postMessage drops undefined keys.
 */
type SettingsDefaultsShape = { [K in keyof GlobalSettings]?: Exclude<GlobalSettings[K], undefined> }

const deepFreeze = <T>(value: T): T => {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) {
			deepFreeze(child)
		}
		Object.freeze(value)
	}
	return value
}

const settingsDefaults = {
	alwaysAllowReadOnly: false,
	alwaysAllowReadOnlyOutsideWorkspace: false,
	alwaysAllowWrite: false,
	alwaysAllowWriteOutsideWorkspace: false,
	alwaysAllowWriteProtected: false,
	alwaysAllowExecute: false,
	alwaysAllowMcp: false,
	alwaysAllowModeSwitch: false,
	alwaysAllowSubtasks: false,
	alwaysApprovePlan: false,
	alwaysAllowFollowupQuestions: false,
	followupAutoApproveTimeoutMs: 60_000,
	autoApprovalEnabled: false,
	autoApprovalMode: "default",

	diagnosticsEnabled: true,
	includeDiagnosticMessages: true,
	maxDiagnosticMessages: 50,
	writeDelayMs: DEFAULT_WRITE_DELAY_MS,

	autoCondenseContext: true,
	autoCondenseContextPercent: 100,

	webToolsEnabled: false,
	webSearchBackend: "searxng",
	searxngBaseUrl: "",
	webSearchMaxResults: WEB_TOOLS_DEFAULTS.DEFAULT_SEARCH_RESULTS,
	webFetchMaxBytes: WEB_TOOLS_DEFAULTS.DEFAULT_FETCH_BYTES,

	soundEnabled: DEFAULT_SOUND_ENABLED,
	soundVolume: 0.5,
	customSoundCelebration: null,
	customSoundCelebrationOriginal: null,
	customSoundProgressLoop: null,
	customSoundProgressLoopOriginal: null,
	customSoundNotification: null,
	customSoundNotificationOriginal: null,

	enableCheckpoints: DEFAULT_ENABLE_CHECKPOINTS,
	checkpointTimeout: DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,

	terminalShellIntegrationTimeout: DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS,
	terminalShellIntegrationDisabled: true,
	terminalCommandDelay: 0,
	terminalPowershellCounter: false,
	terminalZshClearEolMark: true,
	terminalZshOhMy: false,
	terminalZshP10k: false,
	terminalZdotdir: false,

	mcpEnabled: true,
	currentApiConfigName: "default",
	listApiConfigMeta: [],
	pinnedApiConfigs: {},
	modeApiConfigs: {},
	customModePrompts: {},
	customSupportPrompts: {},
	profileThresholds: {},

	maxOpenTabsContext: 20,
	maxWorkspaceFiles: 200,
	showRooIgnoredFiles: false,
	enableSubfolderRules: false,
	maxImageFileSize: 5,
	maxTotalImageSize: 20,
	maxGitStatusFiles: 0,
	includeTaskHistoryInEnhance: true,
	includeCurrentTime: true,
	includeCurrentCost: true,
	parallelTasksMaxConcurrency: DEFAULT_PARALLEL_TASKS_MAX_CONCURRENCY,
	subagentFollowupTimeoutSec: DEFAULT_SUBAGENT_FOLLOWUP_TIMEOUT_SEC,

	telemetrySetting: "unset",
	historyPreviewCollapsed: false,
	reasoningBlockCollapsed: true,
	enterBehavior: "send",
} satisfies SettingsDefaultsShape

/**
 * One table for the default of every setting that has a static one (CORE-R1).
 * The extension host builds its state from it (`resolveSettings`), and the
 * webview and the CLI are meant to read their fallbacks from here too, so a
 * user who never touched a setting sees the same value everywhere.
 *
 * Adding a setting with a default: add it to the settings schema and here.
 *
 * Not in the table, because their default is only known at runtime in the
 * extension host: `mode` (the first built-in mode), `language` (the VS Code
 * display language), `experiments` and `codebaseIndexModels` (built from
 * extension-side registries). Settings resolved by a clamping function are
 * handled in `resolveSettings` below (`maxInlineToolResultBytes`,
 * `pruneBeforeCondense`, `pruneToolResultBudget`, `codebaseIndexConfig`).
 */
export const SETTINGS_DEFAULTS: Readonly<typeof settingsDefaults> = deepFreeze(settingsDefaults)

export type SettingsDefaultKey = keyof typeof settingsDefaults

/** The keys of `SETTINGS_DEFAULTS`. */
export const SETTINGS_DEFAULT_KEYS: readonly SettingsDefaultKey[] = Object.freeze(
	Object.keys(settingsDefaults) as SettingsDefaultKey[],
)

/**
 * Defaults of the fields inside `codebaseIndexConfig`. The embedding
 * dimension deliberately has none: unset means "use the model's own
 * dimension" (see the code-index config manager).
 */
export const CODEBASE_INDEX_CONFIG_DEFAULTS = deepFreeze({
	codebaseIndexEnabled: false,
	codebaseIndexQdrantUrl: "http://localhost:6333",
	codebaseIndexEmbedderProvider: "openai",
	codebaseIndexEmbedderBaseUrl: "",
	codebaseIndexEmbedderModelId: "",
} as const satisfies CodebaseIndexConfig)

type ResolvedCodebaseIndexConfig = Omit<CodebaseIndexConfig, keyof typeof CODEBASE_INDEX_CONFIG_DEFAULTS> & {
	[K in keyof typeof CODEBASE_INDEX_CONFIG_DEFAULTS]-?: Exclude<CodebaseIndexConfig[K], undefined>
}

/**
 * The code-index config with its defaults applied, field by field (a stored
 * config may miss some fields). The result has exactly the fields the host
 * exposes in its state, in the same shape as before CORE-R1.
 */
export const resolveCodebaseIndexConfig = (config: CodebaseIndexConfig | undefined): ResolvedCodebaseIndexConfig => ({
	codebaseIndexEnabled: config?.codebaseIndexEnabled ?? CODEBASE_INDEX_CONFIG_DEFAULTS.codebaseIndexEnabled,
	codebaseIndexQdrantUrl: config?.codebaseIndexQdrantUrl ?? CODEBASE_INDEX_CONFIG_DEFAULTS.codebaseIndexQdrantUrl,
	codebaseIndexEmbedderProvider:
		config?.codebaseIndexEmbedderProvider ?? CODEBASE_INDEX_CONFIG_DEFAULTS.codebaseIndexEmbedderProvider,
	codebaseIndexEmbedderBaseUrl:
		config?.codebaseIndexEmbedderBaseUrl ?? CODEBASE_INDEX_CONFIG_DEFAULTS.codebaseIndexEmbedderBaseUrl,
	codebaseIndexEmbedderModelId:
		config?.codebaseIndexEmbedderModelId ?? CODEBASE_INDEX_CONFIG_DEFAULTS.codebaseIndexEmbedderModelId,
	codebaseIndexEmbedderModelDimension: config?.codebaseIndexEmbedderModelDimension,
	codebaseIndexOpenAiCompatibleBaseUrl: config?.codebaseIndexOpenAiCompatibleBaseUrl,
	codebaseIndexSearchMaxResults: config?.codebaseIndexSearchMaxResults,
	codebaseIndexSearchMinScore: config?.codebaseIndexSearchMinScore,
	codebaseIndexBedrockRegion: config?.codebaseIndexBedrockRegion,
	codebaseIndexBedrockProfile: config?.codebaseIndexBedrockProfile,
	codebaseIndexOpenRouterSpecificProvider: config?.codebaseIndexOpenRouterSpecificProvider,
})

type ResolvedDerivedSettings = {
	maxInlineToolResultBytes: number
	pruneBeforeCondense: boolean
	pruneToolResultBudget: number
	codebaseIndexConfig: ResolvedCodebaseIndexConfig
}

/** Settings values with every default applied: the table keys are never undefined. */
export type ResolvedSettings<T extends Partial<GlobalSettings> = GlobalSettings> = Omit<
	T,
	SettingsDefaultKey | keyof ResolvedDerivedSettings
> & { [K in SettingsDefaultKey]-?: Exclude<GlobalSettings[K], undefined> } & ResolvedDerivedSettings

/** A fresh copy of a container default, so no caller can mutate the table. */
const cloneDefault = (value: unknown): unknown => {
	if (Array.isArray(value)) return [...value]
	if (value && typeof value === "object") return { ...value }
	return value
}

/**
 * Applies `SETTINGS_DEFAULTS` to stored settings values. Pure: it reads only
 * its argument. An unset value is `undefined` or `null`; explicit falsy
 * values (`false`, `0`, `""`) are kept. Keys without a default pass through
 * unchanged.
 */
export function resolveSettings<T extends Partial<GlobalSettings>>(values: T): ResolvedSettings<T> {
	const resolved: Record<string, unknown> = { ...values }
	const source = values as Record<string, unknown>

	for (const key of SETTINGS_DEFAULT_KEYS) {
		resolved[key] = source[key] ?? cloneDefault(SETTINGS_DEFAULTS[key])
	}

	resolved.maxInlineToolResultBytes = resolveMaxInlineToolResultBytes(values)
	resolved.pruneBeforeCondense = isPruneBeforeCondenseEnabled(values)
	resolved.pruneToolResultBudget = resolvePruneToolResultBudget(values)
	resolved.codebaseIndexConfig = resolveCodebaseIndexConfig(values.codebaseIndexConfig)

	return resolved as ResolvedSettings<T>
}
