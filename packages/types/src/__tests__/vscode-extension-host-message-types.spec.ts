// npx vitest run src/__tests__/vscode-extension-host-message-types.spec.ts
//
// Pins the exact set of message type names on the extension <-> webview
// channel, and that the per-domain unions (one file per handler module under
// ../vscode-extension-host/) partition it. Checked by tsc
// (expectTypeOf is compile-time), so a name that is added, dropped, renamed
// or listed in two domains fails the type check of this package.

import type {
	ExtensionMessage,
	WebviewMessage,
	ExtensionMessageType,
	WebviewMessageType,
	ExtensionMessageTypesByDomain,
	WebviewMessageTypesByDomain,
} from "../vscode-extension-host.js"

/** Names that two or more members of `M` share; `never` when they are disjoint. */
type Overlaps<M> = { [K in keyof M]: Extract<M[K], M[Exclude<keyof M, K>]> }[keyof M]

/** Keys of `M` whose union is empty. */
type EmptyDomains<M> = { [K in keyof M]: [M[K]] extends [never] ? K : never }[keyof M]

type ExpectedExtensionMessageType =
	| "action"
	| "state"
	| "taskHistoryUpdated"
	| "taskHistoryItemUpdated"
	| "taskHistoryItemDeleted"
	| "selectedImages"
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
	| "systemPrompt"
	| "exportModeResult"
	| "importModeResult"
	| "checkRulesDirectoryResult"
	| "deleteCustomModeCheck"
	| "currentCheckpointUpdated"
	| "checkpointInitWarning"
	| "fileSearchResults"
	| "acceptInput"
	| "commandExecutionStatus"
	| "mcpExecutionStatus"
	| "vsCodeSetting"
	| "terminalProfiles"
	| "condenseTaskContextStarted"
	| "condenseTaskContextResponse"
	| "providerModels"
	| "indexingStatusUpdate"
	| "indexCleared"
	| "marketplaceInstallResult"
	| "marketplaceRemoveResult"
	| "marketplaceData"
	| "shareTaskSuccess"
	| "codeIndexSettingsSaved"
	| "codeIndexSecretStatus"
	| "showDeleteMessageDialog"
	| "showEditMessageDialog"
	| "commands"
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
	| "toggleWorkspaceIndexing"
	| "setAutoEnableDefault"
	| "focusPanelRequest"
	| "openExternal"
	| "filterMarketplaceItems"
	| "installMarketplaceItem"
	| "removeInstalledMarketplaceItem"
	| "fetchMarketplaceData"
	| "switchTab"
	| "exportMode"
	| "importMode"
	| "checkRulesDirectory"
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

	it("the per-module domain unions partition both sets", () => {
		expectTypeOf<Overlaps<ExtensionMessageTypesByDomain>>().toBeNever()
		expectTypeOf<Overlaps<WebviewMessageTypesByDomain>>().toBeNever()
		expectTypeOf<
			ExtensionMessageTypesByDomain[keyof ExtensionMessageTypesByDomain]
		>().toEqualTypeOf<ExpectedExtensionMessageType>()
		expectTypeOf<
			WebviewMessageTypesByDomain[keyof WebviewMessageTypesByDomain]
		>().toEqualTypeOf<ExpectedWebviewMessageType>()
		expectTypeOf<EmptyDomains<ExtensionMessageTypesByDomain>>().toBeNever()
		expectTypeOf<EmptyDomains<WebviewMessageTypesByDomain>>().toBeNever()
	})
})
