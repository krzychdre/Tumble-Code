/*
 * Extension host channel: the state object the host pushes with `state`
 * messages (`ExtensionMessage.state`).
 */

import type { GlobalSettings } from "../global-settings.js"
import type { ProviderSettings } from "../provider-settings.js"
import type { HistoryItem } from "../history.js"
import type { ModeConfig } from "../mode.js"
import type { TelemetrySetting } from "../telemetry.js"
import type { Experiments } from "../experiment.js"
import type { ClineMessage, QueuedMessage } from "../message.js"
import type { MarketplaceItem } from "../marketplace.js"
import type { TodoItem } from "../todo.js"
import type { CloudUserInfo, CloudOrganizationMembership, OrganizationAllowList } from "../cloud.js"
import type { McpServer } from "../mcp.js"
import type { SubagentSummary } from "../subagent.js"

import type { AudioType } from "./settings.js"

/** The remote-control bridge connection as the state push reports it. */
export type RemoteControlStatus = "off" | "connecting" | "connected" | "offline"

export type ExtensionState = Pick<
	GlobalSettings,
	| "currentApiConfigName"
	| "listApiConfigMeta"
	| "pinnedApiConfigs"
	| "customInstructions"
	| "dismissedUpsells"
	| "autoApprovalEnabled"
	| "autoApprovalMode"
	| "alwaysAllowReadOnly"
	| "alwaysAllowReadOnlyOutsideWorkspace"
	| "alwaysAllowWrite"
	| "alwaysAllowWriteOutsideWorkspace"
	| "alwaysAllowWriteProtected"
	| "alwaysAllowMcp"
	| "alwaysAllowModeSwitch"
	| "alwaysAllowSubtasks"
	| "alwaysApprovePlan"
	| "alwaysAllowFollowupQuestions"
	| "alwaysAllowExecute"
	| "followupAutoApproveTimeoutMs"
	| "allowedCommands"
	| "deniedCommands"
	| "allowedMaxRequests"
	| "allowedMaxCost"
	| "soundEnabled"
	| "soundVolume"
	| "customSoundCelebration"
	| "customSoundCelebrationOriginal"
	| "customSoundProgressLoop"
	| "customSoundProgressLoopOriginal"
	| "customSoundNotification"
	| "customSoundNotificationOriginal"
	| "terminalOutputPreviewSize"
	| "terminalShellIntegrationTimeout"
	| "terminalShellIntegrationDisabled"
	| "terminalCommandDelay"
	| "terminalPowershellCounter"
	| "terminalZshClearEolMark"
	| "terminalZshOhMy"
	| "terminalZshP10k"
	| "terminalZdotdir"
	| "terminalProfile"
	| "execaShellPath"
	| "diagnosticsEnabled"
	| "language"
	| "modeApiConfigs"
	| "customModePrompts"
	| "customSupportPrompts"
	| "enhancementApiConfigId"
	| "customCondensingPrompt"
	| "codebaseIndexConfig"
	| "codebaseIndexModels"
	| "profileThresholds"
	| "includeDiagnosticMessages"
	| "maxDiagnosticMessages"
	| "imageGenerationProvider"
	| "openRouterImageGenerationSelectedModel"
	| "includeTaskHistoryInEnhance"
	| "reasoningBlockCollapsed"
	| "enterBehavior"
	| "uiDensity"
	| "includeCurrentTime"
	| "includeCurrentCost"
	| "maxGitStatusFiles"
	| "parallelTasksMaxConcurrency"
	| "subagentFollowupTimeoutSec"
	| "requestDelaySeconds"
	| "showWorktreesInHomeScreen"
	| "disabledTools"
	| "autoMemoryEnabled"
	| "autoMemoryDirectory"
	| "autoMemoryShareWithClaudeCode"
	| "memoryRecallEnabled"
	| "autoDreamEnabled"
	| "autoDreamMinHours"
	| "autoDreamMinSessions"
	| "memoryWriterApiConfigId"
	| "autoCondenseContextApiConfigId"
	| "webToolsEnabled"
	| "webSearchBackend"
	| "searxngBaseUrl"
	| "webSearchMaxResults"
	| "webFetchMaxBytes"
	| "maxInlineToolResultBytes"
	| "pruneBeforeCondense"
	| "pruneToolResultBudget"
> & {
	lockApiConfigAcrossModes?: boolean
	version: string
	clineMessages: ClineMessage[]
	currentTaskId?: string
	currentTaskItem?: HistoryItem
	currentTaskTodos?: TodoItem[] // Initial todos for the current task
	/** Live parallel background subagents (run_parallel_tasks children). */
	subagents?: SubagentSummary[]
	/** Live memory-system activity (recall prefetches / background writers). */
	memoryActivity?: { recall: number; write: number }
	apiConfiguration: ProviderSettings
	uriScheme?: string
	shouldShowAnnouncement: boolean

	taskHistory: HistoryItem[]

	writeDelayMs: number

	enableCheckpoints: boolean
	checkpointTimeout: number // Timeout for checkpoint initialization in seconds (default: 15)
	maxOpenTabsContext: number // Maximum number of VSCode open tabs to include in context (0-500)
	maxWorkspaceFiles: number // Maximum number of files to include in current working directory details (0-500)
	showRooIgnoredFiles: boolean // Whether to show .rooignore'd files in listings
	enableSubfolderRules: boolean // Whether to load rules from subdirectories
	maxReadFileLine?: number // Maximum line limit for read_file tool (-1 for default)
	maxImageFileSize: number // Maximum size of image files to process in MB
	maxTotalImageSize: number // Maximum total size for all images in a single read operation in MB

	experiments: Experiments // Map of experiment IDs to their enabled state

	mcpEnabled: boolean

	mode: string
	customModes: ModeConfig[]
	toolRequirements?: Record<string, boolean> // Map of tool names to their requirements (e.g. {"apply_diff": true})

	cwd?: string // Current working directory
	telemetrySetting: TelemetrySetting
	telemetryKey?: string
	machineId?: string

	renderContext: "sidebar" | "editor"
	settingsImportedAt?: number
	historyPreviewCollapsed?: boolean

	/**
	 * Last persistent storage failure reported by the extension host (task
	 * history store, provider profile persistence), formatted as
	 * "<context>: <message>". The empty string means "no error": the
	 * postMessage channel drops undefined values, so an explicit empty
	 * string is the only way a state push can clear the flag in the
	 * webview merge.
	 */
	storageErrorMessage?: string

	cloudUserInfo: CloudUserInfo | null
	cloudIsAuthenticated: boolean
	cloudAuthSkipModel?: boolean // Flag indicating auth completed without model selection (user should pick 3rd-party provider)
	cloudApiUrl?: string
	/**
	 * The remote-control bridge to the cloud: "off" while signed out (or
	 * before the bridge starts), "connecting", "connected", or "offline"
	 * after a failed connection attempt (it keeps retrying). The CLI status
	 * line shows it. Always sent explicitly, so a push can clear it.
	 */
	remoteControlStatus?: RemoteControlStatus
	cloudOrganizations?: CloudOrganizationMembership[]
	sharingEnabled: boolean
	publicSharingEnabled: boolean
	organizationAllowList: OrganizationAllowList
	organizationSettingsVersion?: number

	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	marketplaceItems?: MarketplaceItem[]
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	marketplaceInstalledMetadata?: { project: Record<string, any>; global: Record<string, any> }
	profileThresholds: Record<string, number>
	hasOpenedModeSelector: boolean
	openRouterImageApiKey?: string
	messageQueue?: QueuedMessage[]
	lastShownAnnouncementId?: string
	apiModelId?: string
	mcpServers?: McpServer[]
	mdmCompliant?: boolean
	taskSyncEnabled: boolean
	openAiCodexIsAuthenticated?: boolean
	debug?: boolean

	/**
	 * Monotonically increasing sequence number for clineMessages state pushes.
	 * When present, the frontend should only apply clineMessages from a state push
	 * if its seq is greater than the last applied seq. This prevents stale state
	 * (captured during async getStateToPostToWebview) from overwriting newer messages.
	 */
	clineMessagesSeq?: number

	/**
	 * Webview-accessible URIs for user-uploaded custom sound files, one per AudioType.
	 * Missing/undefined means the built-in WAV is used. Computed at state-push time
	 * from the corresponding `customSound*` settings + the on-disk file.
	 */
	customSoundUris?: Partial<Record<AudioType, string>>
}
