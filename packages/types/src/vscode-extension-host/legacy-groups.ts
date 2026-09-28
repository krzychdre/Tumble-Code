/*
 * The per-domain name unions @roo-code/types exported before S7 split the
 * channel by handler module. Their grouping (task, UI, modes, provider, ...)
 * cut across the handler modules, so they are kept only so that existing
 * imports keep compiling. Each is an `Extract` over the assembled union, so
 * it can never list a name the channel does not have.
 */

import type { ExtensionMessageType, WebviewMessageType } from "../vscode-extension-host.js"

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleExtensionMessageType`). Task lifecycle, the chat transcript, subagents and checkpoints. */
export type ExtensionTaskMessageType = Extract<
	ExtensionMessageType,
	| "state"
	| "taskHistoryUpdated"
	| "taskHistoryItemUpdated"
	| "taskHistoryItemDeleted"
	| "messageUpdated"
	| "messageAdded"
	| "subagentsUpdated"
	| "subagentMessages"
	| "memoryActivity"
	| "currentCheckpointUpdated"
	| "checkpointInitWarning"
	| "commandExecutionStatus"
	| "mcpExecutionStatus"
	| "condenseTaskContextStarted"
	| "condenseTaskContextResponse"
	| "shareTaskSuccess"
	| "showDeleteMessageDialog"
	| "showEditMessageDialog"
	| "interactionRequired"
	| "taskWithAggregatedCosts"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleExtensionMessageType`). Webview shell: actions, input box, pickers, search results and editor settings. */
export type ExtensionUiMessageType = Extract<
	ExtensionMessageType,
	| "action"
	| "selectedImages"
	| "workspaceUpdated"
	| "invoke"
	| "enhancedPrompt"
	| "commitSearchResults"
	| "fileSearchResults"
	| "acceptInput"
	| "vsCodeSetting"
	| "terminalProfiles"
	| "insertTextIntoTextarea"
	| "dismissedUpsells"
	| "folderSelected"
	| "fileContent"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleExtensionMessageType`). Modes, prompts, rules, slash commands, skills and custom tools. */
export type ExtensionModesMessageType = Extract<
	ExtensionMessageType,
	| "systemPrompt"
	| "exportModeResult"
	| "importModeResult"
	| "checkRulesDirectoryResult"
	| "deleteCustomModeCheck"
	| "commands"
	| "customToolsResult"
	| "modes"
	| "skills"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleExtensionMessageType`). Provider profiles, models, cloud account and organization. */
export type ExtensionProviderMessageType = Extract<
	ExtensionMessageType,
	"listApiConfig" | "providerModels" | "organizationSwitchResult" | "openAiCodexRateLimits"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleExtensionMessageType`). MCP servers. */
export type ExtensionMcpMessageType = Extract<ExtensionMessageType, "mcpServers">

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleExtensionMessageType`). Codebase indexing. */
export type ExtensionCodeIndexMessageType = Extract<
	ExtensionMessageType,
	"indexingStatusUpdate" | "indexCleared" | "codeIndexSettingsSaved" | "codeIndexSecretStatus"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleExtensionMessageType`). Marketplace. */
export type ExtensionMarketplaceMessageType = Extract<
	ExtensionMessageType,
	"marketplaceInstallResult" | "marketplaceRemoveResult" | "marketplaceData"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleExtensionMessageType`). Git worktrees and branches. */
export type ExtensionWorktreeMessageType = Extract<
	ExtensionMessageType,
	| "worktreeList"
	| "worktreeResult"
	| "worktreeCopyProgress"
	| "branchList"
	| "worktreeDefaults"
	| "worktreeIncludeStatus"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleExtensionMessageType`). Plan review panel. */
export type ExtensionPlanReviewMessageType = Extract<
	ExtensionMessageType,
	"planReviewInit" | "planReviewUpdate" | "planReviewDraftsConsumed"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleWebviewMessageType`). Task lifecycle, the chat transcript, message queue, subagents and checkpoints. */
export type WebviewTaskMessageType = Extract<
	WebviewMessageType,
	| "resyncClineMessages"
	| "updateTodoList"
	| "deleteMultipleTasksWithIds"
	| "newTask"
	| "askResponse"
	| "terminalOperation"
	| "clearTask"
	| "exportCurrentTask"
	| "shareCurrentTask"
	| "showTaskWithId"
	| "deleteTaskWithId"
	| "exportTaskWithId"
	| "cancelTask"
	| "subscribeSubagentMessages"
	| "unsubscribeSubagentMessages"
	| "cancelSubagent"
	| "queueSubagentMessage"
	| "cancelAutoApproval"
	| "deleteMessage"
	| "deleteMessageConfirm"
	| "submitEditedMessage"
	| "editMessageConfirm"
	| "taskSyncEnabled"
	| "checkpointDiff"
	| "checkpointRestore"
	| "condenseTaskContextRequest"
	| "queueMessage"
	| "removeQueuedMessage"
	| "editQueuedMessage"
	| "getTaskWithAggregatedCosts"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleWebviewMessageType`). Webview shell: launch, images, files, search, navigation, sounds and diagnostics. */
export type WebviewUiMessageType = Extract<
	WebviewMessageType,
	| "webviewDidLaunch"
	| "didShowAnnouncement"
	| "selectImages"
	| "openImage"
	| "saveImage"
	| "openFile"
	| "readFileContent"
	| "openMention"
	| "openKeyboardShortcuts"
	| "openExtensionLogs"
	| "enhancePrompt"
	| "searchCommits"
	| "searchFiles"
	| "hasOpenedModeSelector"
	| "focusPanelRequest"
	| "openExternal"
	| "switchTab"
	| "showMdmAuthRequiredNotification"
	| "dismissUpsell"
	| "getDismissedUpsells"
	| "openMarkdownPreview"
	| "openDebugApiHistory"
	| "openDebugUiHistory"
	| "downloadErrorDiagnostics"
	| "selectCustomSound"
	| "resetCustomSound"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleWebviewMessageType`). Settings, editor settings and telemetry. */
export type WebviewSettingsMessageType = Extract<
	WebviewMessageType,
	| "customInstructions"
	| "importSettings"
	| "exportSettings"
	| "resetState"
	| "updateVSCodeSetting"
	| "getVSCodeSetting"
	| "requestTerminalProfiles"
	| "openTerminalProfilePicker"
	| "enhancementApiConfigId"
	| "autoApprovalEnabled"
	| "telemetrySetting"
	| "updateSettings"
	| "debugSetting"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleWebviewMessageType`). Provider profiles, models, cloud account and organization. */
export type WebviewProviderMessageType = Extract<
	WebviewMessageType,
	| "upsertApiConfiguration"
	| "deleteApiConfiguration"
	| "loadApiConfiguration"
	| "loadApiConfigurationById"
	| "renameApiConfiguration"
	| "requestProviderModels"
	| "toggleApiConfigPin"
	| "lockApiConfigAcrossModes"
	| "assignCurrentApiConfigToModes"
	| "cliModeProviderSettings"
	| "rooCloudSignIn"
	| "rooCloudSignOut"
	| "rooCloudManualUrl"
	| "openAiCodexSignIn"
	| "openAiCodexSignOut"
	| "switchOrganization"
	| "requestOpenAiCodexRateLimits"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleWebviewMessageType`). Modes, prompts, rules, slash commands, skills and custom tools. */
export type WebviewModesMessageType = Extract<
	WebviewMessageType,
	| "mode"
	| "updatePrompt"
	| "getSystemPrompt"
	| "copySystemPrompt"
	| "updateCustomMode"
	| "deleteCustomMode"
	| "openCustomModesSettings"
	| "exportMode"
	| "importMode"
	| "checkRulesDirectory"
	| "requestCommands"
	| "openCommandFile"
	| "deleteCommand"
	| "createCommand"
	| "refreshCustomTools"
	| "requestModes"
	| "requestSkills"
	| "createSkill"
	| "deleteSkill"
	| "updateSkillModes"
	| "openSkillFile"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleWebviewMessageType`). MCP servers. */
export type WebviewMcpMessageType = Extract<
	WebviewMessageType,
	| "openMcpSettings"
	| "openProjectMcpSettings"
	| "restartMcpServer"
	| "refreshAllMcpServers"
	| "toggleToolAlwaysAllow"
	| "toggleToolEnabledForPrompt"
	| "toggleMcpServer"
	| "updateMcpTimeout"
	| "deleteMcpServer"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleWebviewMessageType`). Codebase indexing. */
export type WebviewCodeIndexMessageType = Extract<
	WebviewMessageType,
	| "requestIndexingStatus"
	| "startIndexing"
	| "stopIndexing"
	| "clearIndexData"
	| "toggleWorkspaceIndexing"
	| "setAutoEnableDefault"
	| "saveCodeIndexSettingsAtomic"
	| "requestCodeIndexSecretStatus"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleWebviewMessageType`). Marketplace. */
export type WebviewMarketplaceMessageType = Extract<
	WebviewMessageType,
	"filterMarketplaceItems" | "installMarketplaceItem" | "removeInstalledMarketplaceItem" | "fetchMarketplaceData"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleWebviewMessageType`). Git worktrees and branches. */
export type WebviewWorktreeMessageType = Extract<
	WebviewMessageType,
	| "listWorktrees"
	| "createWorktree"
	| "deleteWorktree"
	| "switchWorktree"
	| "getAvailableBranches"
	| "getWorktreeDefaults"
	| "getWorktreeIncludeStatus"
	| "createWorktreeInclude"
	| "browseForWorktreePath"
>

/** @deprecated Use the per-module unions (e.g. `TaskLifecycleWebviewMessageType`). Plan review panel. */
export type WebviewPlanReviewMessageType = Extract<
	WebviewMessageType,
	"openPlanReview" | "planReviewReady" | "planReviewSubmit" | "planReviewClose" | "planReviewDraftsChanged"
>
