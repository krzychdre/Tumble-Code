import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"

import {
	type ProviderSettings,
	type ModeConfig,
	type TodoItem,
	type OrganizationAllowList,
	type CloudOrganizationMembership,
	type ExtensionMessage,
	type ExtensionState,
	type AutoApprovalMode,
	type MarketplaceInstalledMetadata,
	type SkillMetadata,
	type Command,
	type McpServer,
} from "@roo-code/types"

import { Mode } from "@roo/modes"

import { vscode } from "@src/utils/vscode"
import { useAnyExtensionMessage } from "@src/utils/extensionBus"

import {
	applyExtensionMessage,
	createInitialExtensionStore,
	flattenExtensionStore,
	mergeExtensionState,
	updateExtensionState,
} from "./extensionStateReducer"

export interface ExtensionStateContextType extends ExtensionState {
	historyPreviewCollapsed?: boolean // Add the new state property
	didHydrateState: boolean
	showWelcome: boolean
	mcpServers: McpServer[]
	currentCheckpoint?: string
	currentTaskTodos?: TodoItem[] // Initial todos for the current task
	filePaths: string[]
	openedTabs: Array<{ label: string; isActive: boolean; path?: string }>
	commands: Command[]
	organizationAllowList: OrganizationAllowList
	organizationSettingsVersion: number
	cloudIsAuthenticated: boolean
	cloudOrganizations?: CloudOrganizationMembership[]
	sharingEnabled: boolean
	publicSharingEnabled: boolean
	mdmCompliant?: boolean
	hasOpenedModeSelector: boolean // New property to track if user has opened mode selector
	setHasOpenedModeSelector: (value: boolean) => void // Setter for the new property
	/**
	 * Clear the parallel-subagent panel slice. Belt-and-suspenders for
	 * `handleChatReset`: the backend's `subagentsUpdated: []` broadcast on
	 * task reset already drives this via the message handler, but an
	 * explicit clear protects against any future path that forgets to
	 * broadcast. Subagents belong to a specific task; a new task must start
	 * with an empty panel.
	 */
	clearSubagents: () => void
	alwaysAllowFollowupQuestions: boolean
	setAlwaysAllowFollowupQuestions: (value: boolean) => void
	marketplaceItems?: any[]
	marketplaceInstalledMetadata?: MarketplaceInstalledMetadata
	profileThresholds: Record<string, number>
	setApiConfiguration: (config: ProviderSettings) => void
	setCustomInstructions: (value?: string) => void
	setAlwaysAllowReadOnly: (value: boolean) => void
	setAlwaysAllowWrite: (value: boolean) => void
	setAlwaysAllowExecute: (value: boolean) => void
	setAlwaysAllowMcp: (value: boolean) => void
	setAlwaysAllowModeSwitch: (value: boolean) => void
	setAlwaysAllowSubtasks: (value: boolean) => void
	setAlwaysApprovePlan: (value: boolean) => void
	setAllowedCommands: (value: string[]) => void
	setDeniedCommands: (value: string[]) => void
	terminalShellIntegrationTimeout?: number
	terminalShellIntegrationDisabled?: boolean
	terminalZdotdir?: boolean
	terminalProfile?: string
	checkpointTimeout: number
	terminalOutputPreviewSize?: "small" | "medium" | "large"
	mcpEnabled: boolean
	setMcpEnabled: (value: boolean) => void
	taskSyncEnabled: boolean
	setTaskSyncEnabled: (value: boolean) => void
	mode: Mode
	setMode: (value: Mode) => void
	enhancementApiConfigId?: string
	setEnhancementApiConfigId: (value: string) => void
	setAutoApprovalEnabled: (value: boolean) => void
	setAutoApprovalMode: (value: AutoApprovalMode) => void
	customModes: ModeConfig[]
	maxWorkspaceFiles: number
	awsUsePromptCache?: boolean
	maxImageFileSize: number
	maxTotalImageSize: number
	machineId?: string
	pinnedApiConfigs?: Record<string, boolean>
	togglePinnedApiConfig: (configName: string) => void
	enterBehavior?: "send" | "newline"
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	includeDiagnosticMessages?: boolean
	maxDiagnosticMessages?: number
	setIncludeTaskHistoryInEnhance: (value: boolean) => void
	showWorktreesInHomeScreen: boolean
	setShowWorktreesInHomeScreen: (value: boolean) => void
	skills?: SkillMetadata[]
}

export const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export { mergeExtensionState }

export const ExtensionStateContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [store, setStore] = useState(createInitialExtensionStore)
	const state = store.extensionState

	// Local writes from the setters below: they only touch `extensionState`.
	const setState = useCallback(
		(update: (prevState: ExtensionState) => ExtensionState) =>
			setStore((prev) => updateExtensionState(prev, update)),
		[],
	)

	const setApiConfiguration = useCallback(
		(value: ProviderSettings) => {
			setState((prevState) => ({
				...prevState,
				apiConfiguration: {
					...prevState.apiConfiguration,
					...value,
				},
			}))
		},
		[setState],
	)

	// Side effects of host messages stay here, outside the pure reducer.
	// `toggleAutoApprove` flips the value in the reducer; the host learns the
	// new value once it is committed.
	const autoApprovalEchoPending = useRef(false)

	useAnyExtensionMessage((message: ExtensionMessage) => {
		if (message.type === "action" && message.action === "toggleAutoApprove") {
			autoApprovalEchoPending.current = true
		}
		setStore((prev) => applyExtensionMessage(prev, message))
	})

	useEffect(() => {
		if (!autoApprovalEchoPending.current) {
			return
		}
		autoApprovalEchoPending.current = false
		vscode.postMessage({ type: "autoApprovalEnabled", bool: store.extensionState.autoApprovalEnabled ?? false })
	}, [store])

	useEffect(() => {
		vscode.postMessage({ type: "webviewDidLaunch" })
	}, [])

	const contextValue: ExtensionStateContextType = {
		...flattenExtensionStore(store),
		reasoningBlockCollapsed: state.reasoningBlockCollapsed ?? true,
		soundVolume: state.soundVolume,
		writeDelayMs: state.writeDelayMs,
		cloudIsAuthenticated: state.cloudIsAuthenticated ?? false,
		cloudOrganizations: state.cloudOrganizations ?? [],
		organizationSettingsVersion: state.organizationSettingsVersion ?? -1,
		profileThresholds: state.profileThresholds ?? {},
		alwaysAllowFollowupQuestions: state.alwaysAllowFollowupQuestions ?? false,
		taskSyncEnabled: state.taskSyncEnabled,
		setApiConfiguration,
		setCustomInstructions: (value) => setState((prevState) => ({ ...prevState, customInstructions: value })),
		setAlwaysAllowReadOnly: (value) => setState((prevState) => ({ ...prevState, alwaysAllowReadOnly: value })),
		setAlwaysAllowWrite: (value) => setState((prevState) => ({ ...prevState, alwaysAllowWrite: value })),
		setAlwaysAllowExecute: (value) => setState((prevState) => ({ ...prevState, alwaysAllowExecute: value })),
		setAlwaysAllowMcp: (value) => setState((prevState) => ({ ...prevState, alwaysAllowMcp: value })),
		setAlwaysAllowModeSwitch: (value) => setState((prevState) => ({ ...prevState, alwaysAllowModeSwitch: value })),
		setAlwaysAllowSubtasks: (value) => setState((prevState) => ({ ...prevState, alwaysAllowSubtasks: value })),
		setAlwaysApprovePlan: (value) => setState((prevState) => ({ ...prevState, alwaysApprovePlan: value })),
		setAlwaysAllowFollowupQuestions: (value) =>
			setState((prevState) => ({ ...prevState, alwaysAllowFollowupQuestions: value })),
		setAllowedCommands: (value) => setState((prevState) => ({ ...prevState, allowedCommands: value })),
		setDeniedCommands: (value) => setState((prevState) => ({ ...prevState, deniedCommands: value })),
		setMcpEnabled: (value) => setState((prevState) => ({ ...prevState, mcpEnabled: value })),
		setTaskSyncEnabled: (value) => setState((prevState) => ({ ...prevState, taskSyncEnabled: value })),
		setMode: (value: Mode) => setState((prevState) => ({ ...prevState, mode: value })),
		setEnhancementApiConfigId: (value) =>
			setState((prevState) => ({ ...prevState, enhancementApiConfigId: value })),
		setAutoApprovalEnabled: (value) => setState((prevState) => ({ ...prevState, autoApprovalEnabled: value })),
		setAutoApprovalMode: (value) => setState((prevState) => ({ ...prevState, autoApprovalMode: value })),
		togglePinnedApiConfig: (configId) =>
			setState((prevState) => {
				const currentPinned = prevState.pinnedApiConfigs || {}
				const newPinned = {
					...currentPinned,
					[configId]: !currentPinned[configId],
				}

				// If the config is now unpinned, remove it from the object
				if (!newPinned[configId]) {
					delete newPinned[configId]
				}

				return { ...prevState, pinnedApiConfigs: newPinned }
			}),
		enterBehavior: state.enterBehavior ?? "send",
		setHasOpenedModeSelector: (value) => setState((prevState) => ({ ...prevState, hasOpenedModeSelector: value })),
		clearSubagents: () => setState((prevState) => ({ ...prevState, subagents: [] })),
		includeDiagnosticMessages: state.includeDiagnosticMessages,
		maxDiagnosticMessages: state.maxDiagnosticMessages,
		setIncludeTaskHistoryInEnhance: (value) =>
			setState((prevState) => ({ ...prevState, includeTaskHistoryInEnhance: value })),
		showWorktreesInHomeScreen: state.showWorktreesInHomeScreen ?? true,
		setShowWorktreesInHomeScreen: (value) =>
			setState((prevState) => ({ ...prevState, showWorktreesInHomeScreen: value })),
	}

	return <ExtensionStateContext.Provider value={contextValue}>{children}</ExtensionStateContext.Provider>
}

export const useExtensionState = () => {
	const context = useContext(ExtensionStateContext)

	if (context === undefined) {
		throw new Error("useExtensionState must be used within an ExtensionStateContextProvider")
	}

	return context
}
