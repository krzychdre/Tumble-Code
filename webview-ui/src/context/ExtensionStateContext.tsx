import React, { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react"

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

import type { ExtensionStore } from "./extensionStateReducer"
import { mergeExtensionState } from "./extensionStateReducer"
import { ExtensionStoreClient } from "./extensionStoreClient"
import { ExtensionStateContext, ExtensionStoreContext } from "./extensionContexts"
import { useExtensionSelectorHook } from "./useExtensionSelector"
import { WEBVIEW_DID_LAUNCH_MESSAGE } from "./webviewDidLaunchMessage"

export { ExtensionStateContext }

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

export { mergeExtensionState }

/** The store client handle that rides on the context value for selectors. */
type Client = ExtensionStoreClient<ExtensionStateContextType, ExtensionStateContextActions>

/** Actions are part of the context value; created once per provider. */
type ExtensionStateContextActions = Pick<
	ExtensionStateContextType,
	| "setApiConfiguration"
	| "setCustomInstructions"
	| "setAlwaysAllowReadOnly"
	| "setAlwaysAllowWrite"
	| "setAlwaysAllowExecute"
	| "setAlwaysAllowMcp"
	| "setAlwaysAllowModeSwitch"
	| "setAlwaysAllowSubtasks"
	| "setAlwaysApprovePlan"
	| "setAlwaysAllowFollowupQuestions"
	| "setAllowedCommands"
	| "setDeniedCommands"
	| "setMcpEnabled"
	| "setTaskSyncEnabled"
	| "setMode"
	| "setEnhancementApiConfigId"
	| "setAutoApprovalEnabled"
	| "setAutoApprovalMode"
	| "togglePinnedApiConfig"
	| "setHasOpenedModeSelector"
	| "clearSubagents"
	| "setIncludeTaskHistoryInEnhance"
	| "setShowWorktreesInHomeScreen"
>

/**
 * The context actions. Created once per provider instance; each closes over
 * the store client, never over a store snapshot, so identities are stable for
 * the provider's lifetime (P1: stable action identities).
 */
const createActions = (client: Client): ExtensionStateContextActions => {
	const setState = (update: (prevState: ExtensionState) => ExtensionState) => client.updateExtensionState(update)

	return {
		setApiConfiguration: (value: ProviderSettings) =>
			setState((prevState) => ({
				...prevState,
				apiConfiguration: {
					...prevState.apiConfiguration,
					...value,
				},
			})),
		setCustomInstructions: (value?: string) =>
			setState((prevState) => ({ ...prevState, customInstructions: value })),
		setAlwaysAllowReadOnly: (value: boolean) =>
			setState((prevState) => ({ ...prevState, alwaysAllowReadOnly: value })),
		setAlwaysAllowWrite: (value: boolean) => setState((prevState) => ({ ...prevState, alwaysAllowWrite: value })),
		setAlwaysAllowExecute: (value: boolean) =>
			setState((prevState) => ({ ...prevState, alwaysAllowExecute: value })),
		setAlwaysAllowMcp: (value: boolean) => setState((prevState) => ({ ...prevState, alwaysAllowMcp: value })),
		setAlwaysAllowModeSwitch: (value: boolean) =>
			setState((prevState) => ({ ...prevState, alwaysAllowModeSwitch: value })),
		setAlwaysAllowSubtasks: (value: boolean) =>
			setState((prevState) => ({ ...prevState, alwaysAllowSubtasks: value })),
		setAlwaysApprovePlan: (value: boolean) => setState((prevState) => ({ ...prevState, alwaysApprovePlan: value })),
		setAlwaysAllowFollowupQuestions: (value: boolean) =>
			setState((prevState) => ({ ...prevState, alwaysAllowFollowupQuestions: value })),
		setAllowedCommands: (value: string[]) => setState((prevState) => ({ ...prevState, allowedCommands: value })),
		setDeniedCommands: (value: string[]) => setState((prevState) => ({ ...prevState, deniedCommands: value })),
		setMcpEnabled: (value: boolean) => setState((prevState) => ({ ...prevState, mcpEnabled: value })),
		setTaskSyncEnabled: (value: boolean) => setState((prevState) => ({ ...prevState, taskSyncEnabled: value })),
		setMode: (value: Mode) => setState((prevState) => ({ ...prevState, mode: value })),
		setEnhancementApiConfigId: (value: string) =>
			setState((prevState) => ({ ...prevState, enhancementApiConfigId: value })),
		setAutoApprovalEnabled: (value: boolean) =>
			setState((prevState) => ({ ...prevState, autoApprovalEnabled: value })),
		setAutoApprovalMode: (value: AutoApprovalMode) =>
			setState((prevState) => ({ ...prevState, autoApprovalMode: value })),
		togglePinnedApiConfig: (configId: string) =>
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
		setHasOpenedModeSelector: (value: boolean) =>
			setState((prevState) => ({ ...prevState, hasOpenedModeSelector: value })),
		clearSubagents: () => setState((prevState) => ({ ...prevState, subagents: [] })),
		setIncludeTaskHistoryInEnhance: (value: boolean) =>
			setState((prevState) => ({ ...prevState, includeTaskHistoryInEnhance: value })),
		setShowWorktreesInHomeScreen: (value: boolean) =>
			setState((prevState) => ({ ...prevState, showWorktreesInHomeScreen: value })),
	}
}

/**
 * Builds the flattened context value (the read model) for one store state.
 * Pure: same store in, same value out; the actions come from the client (they
 * are created once per provider and never change identity). This replaces the
 * object literal that used to be rebuilt — with fresh closures — on every
 * provider render.
 */
const buildContextValue = (store: ExtensionStore, client: Client): ExtensionStateContextType => {
	const state = store.extensionState
	const { clineMessagesResyncRequested: _resyncRequested, ...slices } = store
	return {
		...state,
		...slices,
		reasoningBlockCollapsed: state.reasoningBlockCollapsed ?? true,
		soundVolume: state.soundVolume,
		writeDelayMs: state.writeDelayMs,
		cloudIsAuthenticated: state.cloudIsAuthenticated ?? false,
		cloudOrganizations: state.cloudOrganizations ?? [],
		organizationSettingsVersion: state.organizationSettingsVersion ?? -1,
		profileThresholds: state.profileThresholds ?? {},
		alwaysAllowFollowupQuestions: state.alwaysAllowFollowupQuestions ?? false,
		taskSyncEnabled: state.taskSyncEnabled,
		...client.actions,
		enterBehavior: state.enterBehavior ?? "send",
		uiDensity: state.uiDensity ?? "comfortable",
		includeDiagnosticMessages: state.includeDiagnosticMessages,
		maxDiagnosticMessages: state.maxDiagnosticMessages,
		showWorktreesInHomeScreen: state.showWorktreesInHomeScreen ?? true,
	}
}

export const ExtensionStateContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	// One client per provider instance. A lazy useState initializer is the
	// compiler-friendly idiom; a lazily-written ref would bail the component
	// out of the React Compiler ("cannot access refs during render").
	const [client] = useState(
		() =>
			new ExtensionStoreClient<ExtensionStateContextType, ExtensionStateContextActions>(
				createActions,
				buildContextValue,
			),
	)

	// Side effects of host messages stay here, outside the pure reducer.
	// `toggleAutoApprove` flips the value in the reducer; the host learns the
	// new value once it is committed.
	const autoApprovalEchoPending = useRef(false)

	useAnyExtensionMessage((message: ExtensionMessage) => {
		if (message.type === "action" && message.action === "toggleAutoApprove") {
			autoApprovalEchoPending.current = true
		}
		client.applyMessage(message)
	})

	// Subscribe the provider itself: the store drives the two effects below, the
	// value is what legacy `useExtensionState` consumers read. Both go through
	// `useSyncExternalStore`, never through a `client.getStore()` or
	// `client.getValue()` call in the render body: the React Compiler memoizes
	// such a call on `client`, which never changes, so the context froze at the
	// first render (the welcome view could not leave Anthropic).
	const store = useSyncExternalStore(client.subscribe, client.getStore, client.getStore)
	const value = useSyncExternalStore(client.subscribe, client.getValue, client.getValue)

	useEffect(() => {
		if (!autoApprovalEchoPending.current) {
			return
		}
		autoApprovalEchoPending.current = false
		vscode.postMessage({
			type: "autoApprovalEnabled",
			bool: store.extensionState.autoApprovalEnabled ?? false,
		})
	}, [store])

	// A messageAdded that did not fit the chat: ask the host for the whole list once.
	const resyncRequested = store.clineMessagesResyncRequested
	useEffect(() => {
		if (!resyncRequested) {
			return
		}
		vscode.postMessage({ type: "resyncClineMessages" })
		client.clearClineMessagesResyncRequest()
	}, [resyncRequested, client])

	useEffect(() => {
		vscode.postMessage(WEBVIEW_DID_LAUNCH_MESSAGE)
	}, [])

	return (
		<ExtensionStoreContext.Provider value={client}>
			<ExtensionStateContext.Provider value={value}>{children}</ExtensionStateContext.Provider>
		</ExtensionStoreContext.Provider>
	)
}

export const useExtensionState = () => {
	const context = useContext(ExtensionStateContext)

	if (context === undefined) {
		throw new Error("useExtensionState must be used within an ExtensionStateContextProvider")
	}

	return context
}

export const useExtensionSelector = useExtensionSelectorHook
