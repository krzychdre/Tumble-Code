// npx vitest run src/__tests__/vscode-extension-host-surface.spec.ts
//
// Pins the public surface of the extension <-> webview channel types: every
// name `@tumble-code/types` exports for it, and the field sets of the two message
// interfaces. Checked by tsc (the type-only part) and vitest (the runtime
// schemas), so moving these declarations between files cannot drop an export
// or a field without failing this package.

import type * as Types from "../index.js"
import * as runtime from "../index.js"

/**
 * Every type the channel module exported before it was split by domain, minus the
 * deprecated pre-S7 group aliases deleted on 2026-09-28.
 */
type ChannelTypeExports = [
	Types.ExtensionMessage,
	Types.WebviewMessage,
	Types.ExtensionMessageType,
	Types.WebviewMessageType,
	Types.OpenAiCodexRateLimitsMessage,
	Types.ExtensionState,
	Types.Command,
	Types.ClineAskResponse,
	Types.AudioType,
	Types.UpdateTodoListPayload,
	Types.CliModeProviderSettings,
	Types.EditQueuedMessagePayload,
	Types.RequestOpenAiCodexRateLimitsMessage,
	Types.CheckpointDiffPayload,
	Types.CheckpointRestorePayload,
	Types.IndexingStatusPayload,
	Types.IndexClearedPayload,
	Types.InstallMarketplaceItemWithParametersPayload,
	Types.WebViewMessagePayload,
	Types.IndexingStatus,
	Types.IndexingStatusUpdateMessage,
	Types.LanguageModelChatSelector,
	Types.ClineSayTool,
	Types.ClineAskUseMcpServer,
	Types.ClineApiReqInfo,
	Types.ClineApiReqCancelReason,
]

type ExpectedExtensionMessageField =
	| "type"
	| "text"
	| "fileContent"
	| "payload"
	| "checkpointWarning"
	| "action"
	| "invoke"
	| "state"
	| "images"
	| "filePaths"
	| "openedTabs"
	| "clineMessage"
	| "messageIndex"
	| "sourceTaskId"
	| "subagents"
	| "subagentMessages"
	| "memoryActivity"
	| "runningTasks"
	| "mcpServers"
	| "commits"
	| "listApiConfig"
	| "mode"
	| "customMode"
	| "slug"
	| "success"
	| "values"
	| "requestId"
	| "modelSourceResult"
	| "promptText"
	| "results"
	| "error"
	| "setting"
	| "value"
	| "profiles"
	| "hasContent"
	| "items"
	| "organizationAllowList"
	| "tab"
	| "marketplaceItems"
	| "organizationMcps"
	| "marketplaceInstalledMetadata"
	| "errors"
	| "visibility"
	| "rulesFolderPath"
	| "settings"
	| "messageTs"
	| "hasCheckpoint"
	| "context"
	| "commands"
	| "queuedMessages"
	| "list"
	| "organizationId"
	| "tools"
	| "skills"
	| "modes"
	| "aggregatedCosts"
	| "historyItem"
	| "taskHistory"
	| "taskHistoryItem"
	| "taskHistoryItemId"
	| "worktrees"
	| "isGitRepo"
	| "isMultiRoot"
	| "isSubfolder"
	| "gitRootPath"
	| "worktreeResult"
	| "localBranches"
	| "remoteBranches"
	| "currentBranch"
	| "suggestedBranch"
	| "suggestedPath"
	| "worktreeIncludeExists"
	| "worktreeIncludeStatus"
	| "hasGitignore"
	| "gitignoreContent"
	| "copyProgressBytesCopied"
	| "copyProgressTotalBytes"
	| "copyProgressItemName"
	| "path"

type ExpectedWebviewMessageField =
	| "type"
	| "acceptsMessageAdded"
	| "text"
	| "taskId"
	| "editedMessageContent"
	| "tab"
	| "disabled"
	| "context"
	| "dataUri"
	| "askResponse"
	| "apiConfiguration"
	| "cliModeProviderSettings"
	| "images"
	| "bool"
	| "value"
	| "stepIndex"
	| "isLaunchAction"
	| "forceShow"
	| "commands"
	| "audioType"
	| "serverName"
	| "toolName"
	| "alwaysAllow"
	| "isEnabled"
	| "mode"
	| "promptMode"
	| "customPrompt"
	| "values"
	| "query"
	| "setting"
	| "slug"
	| "modeConfig"
	| "timeout"
	| "payload"
	| "source"
	| "skillName"
	| "skillMode"
	| "newSkillMode"
	| "skillDescription"
	| "skillModeSlugs"
	| "newSkillModeSlugs"
	| "requestId"
	| "modelSourceRequest"
	| "ids"
	| "terminalOperation"
	| "messageTs"
	| "restoreCheckpoint"
	| "historyPreviewCollapsed"
	| "filters"
	| "settings"
	| "url"
	| "mpItem"
	| "mpInstallOptions"
	| "config"
	| "visibility"
	| "hasContent"
	| "checkOnly"
	| "upsellId"
	| "list"
	| "organizationId"
	| "authRedirect"
	| "codeIndexSettings"
	| "updatedSettings"
	| "taskConfiguration"
	| "worktreePath"
	| "worktreeBranch"
	| "worktreeBaseBranch"
	| "worktreeCreateNewBranch"
	| "worktreeForce"
	| "worktreeNewWindow"
	| "worktreeIncludeContent"
	| "planReview"

/**
 * The deprecated pre-S7 group aliases (legacy-groups.ts) were deleted on
 * 2026-09-28 (ai_plans/2026-09-28_delete-legacy-message-groups.md). Each line
 * must be a type error; tsc fails with TS2578 if one of them is exported again.
 */
type RemovedLegacyGroupExports = [
	// @ts-expect-error deleted with legacy-groups.ts
	Types.ExtensionTaskMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.ExtensionUiMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.ExtensionModesMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.ExtensionProviderMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.ExtensionMcpMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.ExtensionCodeIndexMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.ExtensionMarketplaceMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.ExtensionWorktreeMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.ExtensionPlanReviewMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.WebviewTaskMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.WebviewUiMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.WebviewSettingsMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.WebviewProviderMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.WebviewModesMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.WebviewMcpMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.WebviewCodeIndexMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.WebviewMarketplaceMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.WebviewWorktreeMessageType,
	// @ts-expect-error deleted with legacy-groups.ts
	Types.WebviewPlanReviewMessageType,
]

describe("extension host channel public surface", () => {
	it("every channel type is still exported from the package entry", () => {
		expectTypeOf<ChannelTypeExports>().not.toBeNever()
	})

	it("the deprecated pre-S7 group aliases are no longer exported", () => {
		expectTypeOf<RemovedLegacyGroupExports>().not.toBeNever()
	})

	it("ExtensionMessage keeps exactly its fields", () => {
		expectTypeOf<keyof Types.ExtensionMessage>().toEqualTypeOf<ExpectedExtensionMessageField>()
	})

	it("WebviewMessage keeps exactly its fields", () => {
		expectTypeOf<keyof Types.WebviewMessage>().toEqualTypeOf<ExpectedWebviewMessageField>()
	})

	it("the payload schemas are still exported as runtime values", () => {
		expect(runtime.checkoutDiffPayloadSchema.parse({ commitHash: "abc", mode: "full" })).toEqual({
			commitHash: "abc",
			mode: "full",
		})
		expect(runtime.checkoutRestorePayloadSchema.parse({ ts: 1, commitHash: "abc", mode: "preview" })).toEqual({
			ts: 1,
			commitHash: "abc",
			mode: "preview",
		})
		expect(() => runtime.installMarketplaceItemWithParametersPayloadSchema.parse({ parameters: {} })).toThrow()
	})
})
