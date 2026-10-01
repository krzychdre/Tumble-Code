/*
 * The extension host <-> webview (and CLI) message channel, assembled from
 * one file per domain under ./vscode-extension-host/. The domains mirror the
 * handler modules in src/core/webview/messageHandlers/ (plus the plan review
 * panel): a webview message type lives in the file of the module that
 * handles it, a host message type in the file of the domain that sends it.
 * To add a message, add its name to that domain file; the unions below pick
 * it up.
 */

import type { RooCodeSettings } from "./global-settings.js"
import type { ProviderSettings, ProviderSettingsEntry } from "./provider-settings.js"
import type { HistoryItem } from "./history.js"
import type { ModeConfig, PromptComponent } from "./mode.js"
import type { ClineMessage, QueuedMessage } from "./message.js"
import type { MarketplaceItem, MarketplaceInstalledMetadata, InstallMarketplaceItemOptions } from "./marketplace.js"
import type { OrganizationAllowList, ShareVisibility } from "./cloud.js"
import type { SerializedCustomToolDefinition } from "./custom-tool.js"
import type { GitCommit } from "./git.js"
import type { McpServer } from "./mcp.js"
import type { ModelSourceRequest, ModelSourceResult } from "./model-source.js"
import type { SkillMetadata } from "./skills.js"
import type { SubagentSummary } from "./subagent.js"
import type { WorktreeIncludeStatus } from "./worktree.js"

import type {
	TaskLifecycleWebviewMessageType,
	TaskLifecycleExtensionMessageType,
	ClineAskResponse,
	EditQueuedMessagePayload,
	UpdateTodoListPayload,
} from "./vscode-extension-host/taskLifecycle.js"
import type {
	MessageEditsWebviewMessageType,
	MessageEditsExtensionMessageType,
} from "./vscode-extension-host/messageEdits.js"
import type {
	SettingsWebviewMessageType,
	SettingsExtensionMessageType,
	AudioType,
} from "./vscode-extension-host/settings.js"
import type { DebugWebviewMessageType } from "./vscode-extension-host/debug.js"
import type {
	CodeIndexWebviewMessageType,
	CodeIndexExtensionMessageType,
	IndexClearedPayload,
	IndexingStatusPayload,
} from "./vscode-extension-host/codeIndex.js"
import type {
	CustomModesWebviewMessageType,
	CustomModesExtensionMessageType,
} from "./vscode-extension-host/customModes.js"
import type { WorktreesWebviewMessageType, WorktreesExtensionMessageType } from "./vscode-extension-host/worktrees.js"
import type {
	CommandsAndSkillsWebviewMessageType,
	CommandsAndSkillsExtensionMessageType,
	Command,
} from "./vscode-extension-host/commandsAndSkills.js"
import type { CloudAuthWebviewMessageType, CloudAuthExtensionMessageType } from "./vscode-extension-host/cloudAuth.js"
import type {
	EnhanceAndSearchWebviewMessageType,
	EnhanceAndSearchExtensionMessageType,
} from "./vscode-extension-host/enhanceAndSearch.js"
import type {
	ProviderProfilesWebviewMessageType,
	ProviderProfilesExtensionMessageType,
	CliModeProviderSettings,
} from "./vscode-extension-host/providerProfiles.js"
import type {
	MarketplaceWebviewMessageType,
	MarketplaceExtensionMessageType,
	InstallMarketplaceItemWithParametersPayload,
} from "./vscode-extension-host/marketplace.js"
import type { McpWebviewMessageType, McpExtensionMessageType } from "./vscode-extension-host/mcp.js"
import type {
	PromptsAndModesWebviewMessageType,
	PromptsAndModesExtensionMessageType,
} from "./vscode-extension-host/promptsAndModes.js"
import type {
	FilesAndCheckpointsWebviewMessageType,
	FilesAndCheckpointsExtensionMessageType,
	CheckpointDiffPayload,
	CheckpointRestorePayload,
} from "./vscode-extension-host/filesAndCheckpoints.js"
import type { SubagentsWebviewMessageType, SubagentsExtensionMessageType } from "./vscode-extension-host/subagents.js"
import type {
	PlanReviewWebviewMessageType,
	PlanReviewExtensionMessageType,
} from "./vscode-extension-host/planReview.js"
import type { ExtensionState } from "./vscode-extension-host/state.js"

export * from "./vscode-extension-host/taskLifecycle.js"
export * from "./vscode-extension-host/messageEdits.js"
export * from "./vscode-extension-host/settings.js"
export * from "./vscode-extension-host/debug.js"
export * from "./vscode-extension-host/codeIndex.js"
export * from "./vscode-extension-host/customModes.js"
export * from "./vscode-extension-host/worktrees.js"
export * from "./vscode-extension-host/commandsAndSkills.js"
export * from "./vscode-extension-host/cloudAuth.js"
export * from "./vscode-extension-host/enhanceAndSearch.js"
export * from "./vscode-extension-host/providerProfiles.js"
export * from "./vscode-extension-host/marketplace.js"
export * from "./vscode-extension-host/mcp.js"
export * from "./vscode-extension-host/promptsAndModes.js"
export * from "./vscode-extension-host/filesAndCheckpoints.js"
export * from "./vscode-extension-host/subagents.js"
export * from "./vscode-extension-host/planReview.js"
export * from "./vscode-extension-host/state.js"
export * from "./vscode-extension-host/chat-rows.js"

/** Host to view message type names by domain; the keys mirror `messageHandlerGroups`. */
export type ExtensionMessageTypesByDomain = {
	taskLifecycle: TaskLifecycleExtensionMessageType
	messageEdits: MessageEditsExtensionMessageType
	settings: SettingsExtensionMessageType
	codeIndex: CodeIndexExtensionMessageType
	customModes: CustomModesExtensionMessageType
	worktrees: WorktreesExtensionMessageType
	commandsAndSkills: CommandsAndSkillsExtensionMessageType
	cloudAuth: CloudAuthExtensionMessageType
	enhanceAndSearch: EnhanceAndSearchExtensionMessageType
	providerProfiles: ProviderProfilesExtensionMessageType
	marketplace: MarketplaceExtensionMessageType
	mcp: McpExtensionMessageType
	promptsAndModes: PromptsAndModesExtensionMessageType
	filesAndCheckpoints: FilesAndCheckpointsExtensionMessageType
	subagents: SubagentsExtensionMessageType
	planReview: PlanReviewExtensionMessageType
}

/** View to host message type names by domain; the keys mirror `messageHandlerGroups`. */
export type WebviewMessageTypesByDomain = {
	taskLifecycle: TaskLifecycleWebviewMessageType
	messageEdits: MessageEditsWebviewMessageType
	settings: SettingsWebviewMessageType
	debug: DebugWebviewMessageType
	codeIndex: CodeIndexWebviewMessageType
	customModes: CustomModesWebviewMessageType
	worktrees: WorktreesWebviewMessageType
	commandsAndSkills: CommandsAndSkillsWebviewMessageType
	cloudAuth: CloudAuthWebviewMessageType
	enhanceAndSearch: EnhanceAndSearchWebviewMessageType
	providerProfiles: ProviderProfilesWebviewMessageType
	marketplace: MarketplaceWebviewMessageType
	mcp: McpWebviewMessageType
	promptsAndModes: PromptsAndModesWebviewMessageType
	filesAndCheckpoints: FilesAndCheckpointsWebviewMessageType
	subagents: SubagentsWebviewMessageType
	planReview: PlanReviewWebviewMessageType
}

/** Every ExtensionMessage type name: the union of the per-domain unions. */
export type ExtensionMessageType = ExtensionMessageTypesByDomain[keyof ExtensionMessageTypesByDomain]

/** Every WebviewMessage type name: the union of the per-domain unions. */
export type WebviewMessageType = WebviewMessageTypesByDomain[keyof WebviewMessageTypesByDomain]

/**
 * ExtensionMessage
 * Extension -> Webview | CLI
 */
export interface ExtensionMessage {
	type: ExtensionMessageType
	text?: string
	/** For fileContent: { path, content, error? } */
	fileContent?: { path: string; content: string | null; error?: string }
	payload?: any // eslint-disable-line @typescript-eslint/no-explicit-any
	checkpointWarning?: {
		type: "WAIT_TIMEOUT" | "INIT_TIMEOUT"
		timeout: number
	}
	action?:
		| "chatButtonClicked"
		| "settingsButtonClicked"
		| "historyButtonClicked"
		| "marketplaceButtonClicked"
		| "cloudButtonClicked"
		| "didBecomeVisible"
		| "focusInput"
		| "switchTab"
		| "toggleAutoApprove"
	invoke?: "newChat" | "sendMessage" | "primaryButtonClick" | "secondaryButtonClick" | "setChatBoxMessage"
	/**
	 * Partial state updates are allowed to reduce message size (e.g. omit large fields like taskHistory).
	 * The webview is responsible for merging.
	 */
	state?: Partial<ExtensionState>
	images?: string[]
	filePaths?: string[]
	openedTabs?: Array<{
		label: string
		isActive: boolean
		path?: string
	}>
	clineMessage?: ClineMessage
	/**
	 * For `messageAdded`: the position of `clineMessage` in the task's message
	 * list. A view whose list is not exactly this long has missed a message and
	 * asks for the whole list (`resyncClineMessages`).
	 */
	messageIndex?: number
	/**
	 * Source task of a `messageUpdated` or `messageAdded` push, and the target of `subagentsUpdated`
	 * / `subagentMessages`. The webview routes by it: current task → main chat,
	 * subscribed subagent → its live tail, otherwise dropped.
	 */
	sourceTaskId?: string
	/** Live summaries of parallel background subagents (`subagentsUpdated`). */
	subagents?: SubagentSummary[]
	/** Full message snapshot for a just-subscribed subagent (`subagentMessages`). */
	subagentMessages?: ClineMessage[]
	/**
	 * Live memory-system activity counters (`memoryActivity` pushes and state):
	 * how many recall prefetches / background writers are running right now.
	 */
	memoryActivity?: { recall: number; write: number }
	mcpServers?: McpServer[]
	commits?: GitCommit[]
	listApiConfig?: ProviderSettingsEntry[]
	mode?: string
	customMode?: ModeConfig
	slug?: string
	success?: boolean
	/** Generic payload for extension messages that use `values` */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	values?: Record<string, any>
	requestId?: string
	modelSourceResult?: ModelSourceResult
	promptText?: string
	results?:
		| { path: string; type: "file" | "folder"; label?: string }[]
		| { name: string; description?: string; argumentHint?: string; source: "global" | "project" | "built-in" }[]
	error?: string
	setting?: string
	value?: any // eslint-disable-line @typescript-eslint/no-explicit-any
	/** Sanitized VS Code terminal profile names for the `terminalProfiles` message. */
	profiles?: string[]
	hasContent?: boolean
	items?: MarketplaceItem[]
	organizationAllowList?: OrganizationAllowList
	tab?: string
	marketplaceItems?: MarketplaceItem[]
	organizationMcps?: MarketplaceItem[]
	marketplaceInstalledMetadata?: MarketplaceInstalledMetadata
	errors?: string[]
	visibility?: ShareVisibility
	rulesFolderPath?: string
	settings?: any // eslint-disable-line @typescript-eslint/no-explicit-any
	messageTs?: number
	hasCheckpoint?: boolean
	context?: string
	commands?: Command[]
	queuedMessages?: QueuedMessage[]
	list?: string[] // For dismissedUpsells
	organizationId?: string | null // For organizationSwitchResult
	tools?: SerializedCustomToolDefinition[] // For customToolsResult
	skills?: SkillMetadata[] // For skills response
	modes?: { slug: string; name: string }[] // For modes response
	aggregatedCosts?: {
		// For taskWithAggregatedCosts response
		totalCost: number
		ownCost: number
		childrenCost: number
	}
	historyItem?: HistoryItem
	taskHistory?: HistoryItem[] // For taskHistoryUpdated: full sorted task history
	/** For taskHistoryItemUpdated: single updated/added history item */
	taskHistoryItem?: HistoryItem
	/** For taskHistoryItemDeleted: id of the deleted history item */
	taskHistoryItemId?: string
	// Worktree response properties
	worktrees?: Array<{
		path: string
		branch: string
		commitHash: string
		isCurrent: boolean
		isBare: boolean
		isDetached: boolean
		isLocked: boolean
		lockReason?: string
	}>
	isGitRepo?: boolean
	isMultiRoot?: boolean
	isSubfolder?: boolean
	gitRootPath?: string
	worktreeResult?: {
		success: boolean
		message: string
		worktree?: {
			path: string
			branch: string
			commitHash: string
			isCurrent: boolean
			isBare: boolean
			isDetached: boolean
			isLocked: boolean
			lockReason?: string
		}
	}
	localBranches?: string[]
	remoteBranches?: string[]
	currentBranch?: string
	suggestedBranch?: string
	suggestedPath?: string
	worktreeIncludeExists?: boolean
	worktreeIncludeStatus?: WorktreeIncludeStatus
	hasGitignore?: boolean
	gitignoreContent?: string
	// worktreeCopyProgress (size-based)
	copyProgressBytesCopied?: number
	copyProgressTotalBytes?: number
	copyProgressItemName?: string
	// folderSelected
	path?: string
}

/**
 * WebviewMessage
 * Webview | CLI -> Extension
 */
export interface WebviewMessage {
	type: WebviewMessageType
	/**
	 * For `webviewDidLaunch`: the view applies `messageAdded` (a new chat
	 * message sent alone, CORE-R7). Views that leave it out, like the CLI,
	 * keep receiving the whole message list with every added message.
	 */
	acceptsMessageAdded?: boolean
	text?: string
	taskId?: string
	editedMessageContent?: string
	tab?: "settings" | "history" | "mcp" | "modes" | "chat" | "marketplace" | "cloud"
	disabled?: boolean
	context?: string
	dataUri?: string
	askResponse?: ClineAskResponse
	apiConfiguration?: ProviderSettings
	/** For `cliModeProviderSettings`: the CLI's provider settings per mode. */
	cliModeProviderSettings?: CliModeProviderSettings
	images?: string[]
	bool?: boolean
	value?: number
	stepIndex?: number
	isLaunchAction?: boolean
	forceShow?: boolean
	commands?: string[]
	audioType?: AudioType
	serverName?: string
	toolName?: string
	alwaysAllow?: boolean
	isEnabled?: boolean
	mode?: string
	promptMode?: string | "enhance"
	customPrompt?: PromptComponent
	/** Generic payload for webview messages that use `values` */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	values?: Record<string, any>
	query?: string
	setting?: string
	slug?: string
	modeConfig?: ModeConfig
	timeout?: number
	payload?: WebViewMessagePayload
	source?: "global" | "project"
	skillName?: string // For skill operations (createSkill, deleteSkill, moveSkill, openSkillFile)
	/** @deprecated Use skillModeSlugs instead */
	skillMode?: string // For skill operations (current mode restriction)
	/** @deprecated Use newSkillModeSlugs instead */
	newSkillMode?: string // For moveSkill (target mode)
	skillDescription?: string // For createSkill (skill description)
	/** Mode slugs for skill operations. undefined/empty = any mode */
	skillModeSlugs?: string[] // For skill operations (mode restrictions)
	/** Target mode slugs for updateSkillModes */
	newSkillModeSlugs?: string[] // For updateSkillModes (new mode restrictions)
	requestId?: string
	modelSourceRequest?: ModelSourceRequest
	ids?: string[]
	terminalOperation?: "continue" | "abort"
	messageTs?: number
	restoreCheckpoint?: boolean
	historyPreviewCollapsed?: boolean
	filters?: { type?: string; search?: string; tags?: string[] }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	settings?: any
	url?: string // For openExternal
	mpItem?: MarketplaceItem
	mpInstallOptions?: InstallMarketplaceItemOptions
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	config?: Record<string, any> // Add config to the payload
	visibility?: ShareVisibility // For share visibility
	hasContent?: boolean // For checkRulesDirectoryResult
	checkOnly?: boolean // For deleteCustomMode check
	upsellId?: string // For dismissUpsell
	list?: string[] // For dismissedUpsells response
	organizationId?: string | null // For organization switching
	codeIndexSettings?: {
		// Global state settings
		codebaseIndexEnabled: boolean
		codebaseIndexQdrantUrl: string
		codebaseIndexEmbedderProvider:
			| "openai"
			| "ollama"
			| "openai-compatible"
			| "gemini"
			| "mistral"
			| "bedrock"
			| "openrouter"
		codebaseIndexEmbedderBaseUrl?: string
		codebaseIndexEmbedderModelId: string
		codebaseIndexEmbedderModelDimension?: number // Generic dimension for all providers
		codebaseIndexOpenAiCompatibleBaseUrl?: string
		codebaseIndexBedrockRegion?: string
		codebaseIndexBedrockProfile?: string
		codebaseIndexSearchMaxResults?: number
		codebaseIndexSearchMinScore?: number
		codebaseIndexOpenRouterSpecificProvider?: string // OpenRouter provider routing

		// Secret settings
		codeIndexOpenAiKey?: string
		codeIndexQdrantApiKey?: string
		codebaseIndexOpenAiCompatibleApiKey?: string
		codebaseIndexGeminiApiKey?: string
		codebaseIndexMistralApiKey?: string
		codebaseIndexOpenRouterApiKey?: string
	}
	updatedSettings?: RooCodeSettings
	/** Task configuration applied via `createTask()` when starting a cloud task. */
	taskConfiguration?: RooCodeSettings
	// Worktree properties
	worktreePath?: string
	worktreeBranch?: string
	worktreeBaseBranch?: string
	worktreeCreateNewBranch?: boolean
	worktreeForce?: boolean
	worktreeNewWindow?: boolean
	worktreeIncludeContent?: string
	/** Plan review panel init/update payload. */
	planReview?: { filePath?: string; markdown?: string; baselineMarkdown?: string; language?: string }
}

export type WebViewMessagePayload =
	| CheckpointDiffPayload
	| CheckpointRestorePayload
	| IndexingStatusPayload
	| IndexClearedPayload
	| InstallMarketplaceItemWithParametersPayload
	| UpdateTodoListPayload
	| EditQueuedMessagePayload
