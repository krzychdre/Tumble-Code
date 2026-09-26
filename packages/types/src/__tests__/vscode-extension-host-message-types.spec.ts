// npx vitest run src/__tests__/vscode-extension-host-message-types.spec.ts
//
// Pins the exact set of message type names on the extension <-> webview
// channel, and that the per-domain unions partition it. Checked by tsc
// (expectTypeOf is compile-time), so a name that is added, dropped, renamed
// or listed in two domains fails the type check of this package.

import type {
	ExtensionMessage,
	WebviewMessage,
	ExtensionCodeIndexMessageType,
	ExtensionMarketplaceMessageType,
	ExtensionMcpMessageType,
	ExtensionMessageType,
	ExtensionModesMessageType,
	ExtensionPlanReviewMessageType,
	ExtensionProviderMessageType,
	ExtensionTaskMessageType,
	ExtensionUiMessageType,
	ExtensionWorktreeMessageType,
	WebviewCodeIndexMessageType,
	WebviewMarketplaceMessageType,
	WebviewMcpMessageType,
	WebviewMessageType,
	WebviewModesMessageType,
	WebviewPlanReviewMessageType,
	WebviewProviderMessageType,
	WebviewSettingsMessageType,
	WebviewTaskMessageType,
	WebviewUiMessageType,
	WebviewWorktreeMessageType,
} from "../vscode-extension-host.js"

type ExpectedExtensionMessageType =
	| "action"
	| "state"
	| "taskHistoryUpdated"
	| "taskHistoryItemUpdated"
	| "taskHistoryItemDeleted"
	| "selectedImages"
	| "theme"
	| "workspaceUpdated"
	| "invoke"
	| "messageUpdated"
	| "messageAdded"
	| "subagentsUpdated"
	| "subagentMessages"
	| "memoryActivity"
	| "mcpServers"
	| "enhancedPrompt"
	| "commitSearchResults"
	| "listApiConfig"
	| "vsCodeLmApiAvailable"
	| "updatePrompt"
	| "systemPrompt"
	| "autoApprovalEnabled"
	| "updateCustomMode"
	| "deleteCustomMode"
	| "exportModeResult"
	| "importModeResult"
	| "checkRulesDirectoryResult"
	| "deleteCustomModeCheck"
	| "currentCheckpointUpdated"
	| "checkpointInitWarning"
	| "fileSearchResults"
	| "toggleApiConfigPin"
	| "acceptInput"
	| "setHistoryPreviewCollapsed"
	| "commandExecutionStatus"
	| "mcpExecutionStatus"
	| "vsCodeSetting"
	| "terminalProfiles"
	| "authenticatedUser"
	| "condenseTaskContextStarted"
	| "condenseTaskContextResponse"
	| "providerModels"
	| "indexingStatusUpdate"
	| "indexCleared"
	| "codebaseIndexConfig"
	| "marketplaceInstallResult"
	| "marketplaceRemoveResult"
	| "marketplaceData"
	| "shareTaskSuccess"
	| "codeIndexSettingsSaved"
	| "codeIndexSecretStatus"
	| "showDeleteMessageDialog"
	| "showEditMessageDialog"
	| "commands"
	| "insertTextIntoTextarea"
	| "dismissedUpsells"
	| "organizationSwitchResult"
	| "interactionRequired"
	| "customToolsResult"
	| "modes"
	| "taskWithAggregatedCosts"
	| "openAiCodexRateLimits"
	| "worktreeList"
	| "worktreeResult"
	| "worktreeCopyProgress"
	| "branchList"
	| "worktreeDefaults"
	| "worktreeIncludeStatus"
	| "branchWorktreeIncludeResult"
	| "folderSelected"
	| "skills"
	| "fileContent"
	| "planReviewInit"
	| "planReviewUpdate"
	| "planReviewDraftsConsumed"

type ExpectedWebviewMessageType =
	| "resyncClineMessages"
	| "updateTodoList"
	| "deleteMultipleTasksWithIds"
	| "upsertApiConfiguration"
	| "deleteApiConfiguration"
	| "loadApiConfiguration"
	| "loadApiConfigurationById"
	| "renameApiConfiguration"
	| "customInstructions"
	| "webviewDidLaunch"
	| "newTask"
	| "askResponse"
	| "terminalOperation"
	| "clearTask"
	| "didShowAnnouncement"
	| "selectImages"
	| "exportCurrentTask"
	| "shareCurrentTask"
	| "showTaskWithId"
	| "deleteTaskWithId"
	| "exportTaskWithId"
	| "importSettings"
	| "exportSettings"
	| "resetState"
	| "requestProviderModels"
	| "openImage"
	| "saveImage"
	| "openFile"
	| "readFileContent"
	| "openMention"
	| "cancelTask"
	| "subscribeSubagentMessages"
	| "unsubscribeSubagentMessages"
	| "cancelSubagent"
	| "queueSubagentMessage"
	| "cancelAutoApproval"
	| "updateVSCodeSetting"
	| "getVSCodeSetting"
	| "vsCodeSetting"
	| "requestTerminalProfiles"
	| "openTerminalProfilePicker"
	| "openKeyboardShortcuts"
	| "openMcpSettings"
	| "openExtensionLogs"
	| "openProjectMcpSettings"
	| "restartMcpServer"
	| "refreshAllMcpServers"
	| "toggleToolAlwaysAllow"
	| "toggleToolEnabledForPrompt"
	| "toggleMcpServer"
	| "updateMcpTimeout"
	| "enhancePrompt"
	| "enhancedPrompt"
	| "draggedImages"
	| "deleteMessage"
	| "deleteMessageConfirm"
	| "submitEditedMessage"
	| "editMessageConfirm"
	| "taskSyncEnabled"
	| "searchCommits"
	| "mode"
	| "updatePrompt"
	| "getSystemPrompt"
	| "copySystemPrompt"
	| "systemPrompt"
	| "enhancementApiConfigId"
	| "autoApprovalEnabled"
	| "updateCustomMode"
	| "deleteCustomMode"
	| "openCustomModesSettings"
	| "checkpointDiff"
	| "checkpointRestore"
	| "deleteMcpServer"
	| "telemetrySetting"
	| "searchFiles"
	| "toggleApiConfigPin"
	| "hasOpenedModeSelector"
	| "lockApiConfigAcrossModes"
	| "assignCurrentApiConfigToModes"
	| "cliModeProviderSettings"
	| "rooCloudSignIn"
	| "rooCloudSignOut"
	| "rooCloudManualUrl"
	| "openAiCodexSignIn"
	| "openAiCodexSignOut"
	| "switchOrganization"
	| "condenseTaskContextRequest"
	| "requestIndexingStatus"
	| "startIndexing"
	| "stopIndexing"
	| "clearIndexData"
	| "indexingStatusUpdate"
	| "indexCleared"
	| "toggleWorkspaceIndexing"
	| "setAutoEnableDefault"
	| "focusPanelRequest"
	| "openExternal"
	| "filterMarketplaceItems"
	| "installMarketplaceItem"
	| "removeInstalledMarketplaceItem"
	| "marketplaceInstallResult"
	| "fetchMarketplaceData"
	| "switchTab"
	| "shareTaskSuccess"
	| "exportMode"
	| "exportModeResult"
	| "importMode"
	| "importModeResult"
	| "checkRulesDirectory"
	| "checkRulesDirectoryResult"
	| "saveCodeIndexSettingsAtomic"
	| "requestCodeIndexSecretStatus"
	| "requestCommands"
	| "openCommandFile"
	| "deleteCommand"
	| "createCommand"
	| "showMdmAuthRequiredNotification"
	| "queueMessage"
	| "removeQueuedMessage"
	| "editQueuedMessage"
	| "dismissUpsell"
	| "getDismissedUpsells"
	| "openMarkdownPreview"
	| "updateSettings"
	| "getTaskWithAggregatedCosts"
	| "openDebugApiHistory"
	| "openDebugUiHistory"
	| "downloadErrorDiagnostics"
	| "requestOpenAiCodexRateLimits"
	| "refreshCustomTools"
	| "requestModes"
	| "debugSetting"
	| "listWorktrees"
	| "createWorktree"
	| "deleteWorktree"
	| "switchWorktree"
	| "getAvailableBranches"
	| "getWorktreeDefaults"
	| "getWorktreeIncludeStatus"
	| "createWorktreeInclude"
	| "browseForWorktreePath"
	| "requestSkills"
	| "createSkill"
	| "deleteSkill"
	| "updateSkillModes"
	| "openSkillFile"
	| "selectCustomSound"
	| "resetCustomSound"
	| "openPlanReview"
	| "planReviewReady"
	| "planReviewSubmit"
	| "planReviewClose"
	| "planReviewDraftsChanged"

describe("extension host message type names", () => {
	it("ExtensionMessage['type'] is exactly the pinned set", () => {
		expectTypeOf<ExtensionMessage["type"]>().toEqualTypeOf<ExpectedExtensionMessageType>()
	})

	it("WebviewMessage['type'] is exactly the pinned set", () => {
		expectTypeOf<WebviewMessage["type"]>().toEqualTypeOf<ExpectedWebviewMessageType>()
	})

	it("the combined unions are the pinned sets", () => {
		expectTypeOf<ExtensionMessageType>().toEqualTypeOf<ExpectedExtensionMessageType>()
		expectTypeOf<WebviewMessageType>().toEqualTypeOf<ExpectedWebviewMessageType>()
	})

	it("no ExtensionMessage type name belongs to two domains", () => {
		expectTypeOf<Extract<ExtensionTaskMessageType, ExtensionUiMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionTaskMessageType, ExtensionModesMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionTaskMessageType, ExtensionProviderMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionTaskMessageType, ExtensionMcpMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionTaskMessageType, ExtensionCodeIndexMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionTaskMessageType, ExtensionMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionTaskMessageType, ExtensionWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionTaskMessageType, ExtensionPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionUiMessageType, ExtensionModesMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionUiMessageType, ExtensionProviderMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionUiMessageType, ExtensionMcpMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionUiMessageType, ExtensionCodeIndexMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionUiMessageType, ExtensionMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionUiMessageType, ExtensionWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionUiMessageType, ExtensionPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionModesMessageType, ExtensionProviderMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionModesMessageType, ExtensionMcpMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionModesMessageType, ExtensionCodeIndexMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionModesMessageType, ExtensionMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionModesMessageType, ExtensionWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionModesMessageType, ExtensionPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionProviderMessageType, ExtensionMcpMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionProviderMessageType, ExtensionCodeIndexMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionProviderMessageType, ExtensionMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionProviderMessageType, ExtensionWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionProviderMessageType, ExtensionPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionMcpMessageType, ExtensionCodeIndexMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionMcpMessageType, ExtensionMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionMcpMessageType, ExtensionWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionMcpMessageType, ExtensionPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionCodeIndexMessageType, ExtensionMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionCodeIndexMessageType, ExtensionWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionCodeIndexMessageType, ExtensionPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionMarketplaceMessageType, ExtensionWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionMarketplaceMessageType, ExtensionPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<ExtensionWorktreeMessageType, ExtensionPlanReviewMessageType>>().toBeNever()
	})

	it("no WebviewMessage type name belongs to two domains", () => {
		expectTypeOf<Extract<WebviewTaskMessageType, WebviewUiMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewTaskMessageType, WebviewSettingsMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewTaskMessageType, WebviewProviderMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewTaskMessageType, WebviewModesMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewTaskMessageType, WebviewMcpMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewTaskMessageType, WebviewCodeIndexMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewTaskMessageType, WebviewMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewTaskMessageType, WebviewWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewTaskMessageType, WebviewPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewUiMessageType, WebviewSettingsMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewUiMessageType, WebviewProviderMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewUiMessageType, WebviewModesMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewUiMessageType, WebviewMcpMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewUiMessageType, WebviewCodeIndexMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewUiMessageType, WebviewMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewUiMessageType, WebviewWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewUiMessageType, WebviewPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewSettingsMessageType, WebviewProviderMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewSettingsMessageType, WebviewModesMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewSettingsMessageType, WebviewMcpMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewSettingsMessageType, WebviewCodeIndexMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewSettingsMessageType, WebviewMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewSettingsMessageType, WebviewWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewSettingsMessageType, WebviewPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewProviderMessageType, WebviewModesMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewProviderMessageType, WebviewMcpMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewProviderMessageType, WebviewCodeIndexMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewProviderMessageType, WebviewMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewProviderMessageType, WebviewWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewProviderMessageType, WebviewPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewModesMessageType, WebviewMcpMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewModesMessageType, WebviewCodeIndexMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewModesMessageType, WebviewMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewModesMessageType, WebviewWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewModesMessageType, WebviewPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewMcpMessageType, WebviewCodeIndexMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewMcpMessageType, WebviewMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewMcpMessageType, WebviewWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewMcpMessageType, WebviewPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewCodeIndexMessageType, WebviewMarketplaceMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewCodeIndexMessageType, WebviewWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewCodeIndexMessageType, WebviewPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewMarketplaceMessageType, WebviewWorktreeMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewMarketplaceMessageType, WebviewPlanReviewMessageType>>().toBeNever()
		expectTypeOf<Extract<WebviewWorktreeMessageType, WebviewPlanReviewMessageType>>().toBeNever()
	})
})
