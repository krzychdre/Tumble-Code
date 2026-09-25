import React, { createContext, useCallback, useContext, useEffect, useState } from "react"

import {
	type ProviderSettings,
	type ProviderSettingsEntry,
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
	ORGANIZATION_ALLOW_ALL,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	DEFAULT_ENABLE_CHECKPOINTS,
	DEFAULT_SOUND_ENABLED,
	DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS,
	WEB_TOOLS_DEFAULTS,
	PRUNE_CONDENSE_DEFAULTS,
} from "@roo-code/types"

import { findLastIndex } from "@roo/array"

import { checkExistKey } from "@roo/checkExistApiConfig"
import { Mode, defaultModeSlug, defaultPrompts } from "@roo/modes"
import { experimentDefault } from "@roo/experiments"

import { vscode } from "@src/utils/vscode"

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

export const mergeExtensionState = (prevState: ExtensionState, newState: Partial<ExtensionState>) => {
	const { customModePrompts: prevCustomModePrompts, experiments: prevExperiments, ...prevRest } = prevState

	const {
		apiConfiguration,
		customModePrompts: newCustomModePrompts,
		customSupportPrompts,
		experiments: newExperiments,
		...newRest
	} = newState

	const customModePrompts = { ...prevCustomModePrompts, ...(newCustomModePrompts ?? {}) }
	const experiments = { ...prevExperiments, ...(newExperiments ?? {}) }
	const rest = { ...prevRest, ...newRest }

	// Protect clineMessages from stale state pushes using sequence numbering.
	// Multiple async event sources (cloud auth, settings, task streaming) can trigger
	// concurrent state pushes. If a stale push arrives after a newer one, its clineMessages
	// would overwrite the newer messages. The sequence number prevents this by only applying
	// clineMessages when the incoming seq is strictly greater than the last applied seq.
	if (
		newState.clineMessagesSeq !== undefined &&
		prevState.clineMessagesSeq !== undefined &&
		newState.clineMessagesSeq <= prevState.clineMessagesSeq &&
		newState.clineMessages !== undefined
	) {
		rest.clineMessages = prevState.clineMessages
		rest.clineMessagesSeq = prevState.clineMessagesSeq
	}

	// Note that we completely replace the previous apiConfiguration and customSupportPrompts objects
	// with new ones since the state that is broadcast is the entire objects so merging is not necessary.
	return {
		...rest,
		apiConfiguration: apiConfiguration ?? prevState.apiConfiguration,
		customModePrompts,
		customSupportPrompts: customSupportPrompts ?? prevState.customSupportPrompts,
		experiments,
	}
}

export const ExtensionStateContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [state, setState] = useState<ExtensionState>({
		apiConfiguration: {},
		version: "",
		clineMessages: [],
		subagents: [],
		taskHistory: [],
		shouldShowAnnouncement: false,
		allowedCommands: [],
		deniedCommands: [],
		soundEnabled: DEFAULT_SOUND_ENABLED,
		soundVolume: 0.5,
		enableCheckpoints: DEFAULT_ENABLE_CHECKPOINTS,
		checkpointTimeout: DEFAULT_CHECKPOINT_TIMEOUT_SECONDS, // Default to 15 seconds
		autoMemoryEnabled: true,
		memoryRecallEnabled: true,
		autoDreamEnabled: true,
		autoDreamMinHours: 24,
		autoDreamMinSessions: 5,
		webToolsEnabled: false,
		webSearchBackend: "searxng",
		searxngBaseUrl: "",
		webSearchMaxResults: WEB_TOOLS_DEFAULTS.DEFAULT_SEARCH_RESULTS,
		webFetchMaxBytes: WEB_TOOLS_DEFAULTS.DEFAULT_FETCH_BYTES,
		pruneBeforeCondense: true,
		pruneToolResultBudget: PRUNE_CONDENSE_DEFAULTS.DEFAULT_TOOL_RESULT_BUDGET,
		language: "en", // Default language code
		writeDelayMs: 1000,
		terminalShellIntegrationTimeout: DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS,
		mcpEnabled: true,
		taskSyncEnabled: false,
		currentApiConfigName: "default",
		listApiConfigMeta: [],
		mode: defaultModeSlug,
		customModePrompts: defaultPrompts,
		customSupportPrompts: {},
		experiments: experimentDefault,
		enhancementApiConfigId: "",
		hasOpenedModeSelector: false, // Default to false (not opened yet)
		autoApprovalEnabled: false,
		autoApprovalMode: "default",
		customModes: [],
		maxOpenTabsContext: 20,
		maxWorkspaceFiles: 200,
		cwd: "",
		telemetrySetting: "unset",
		showRooIgnoredFiles: true, // Default to showing .rooignore'd files with lock symbol (current behavior).
		enableSubfolderRules: false, // Default to disabled - must be enabled to load rules from subdirectories
		renderContext: "sidebar",
		// Persistent storage failure reported by the extension host. The
		// empty string means "no error": the postMessage channel drops
		// undefined values, so only an explicit "" can clear the flag here
		// (mergeExtensionState keeps the previous value for absent keys).
		storageErrorMessage: "",
		maxReadFileLine: -1, // Default max line limit for read_file tool (-1 for default)
		maxImageFileSize: 5, // Default max image file size in MB
		maxTotalImageSize: 20, // Default max total image size in MB
		pinnedApiConfigs: {}, // Empty object for pinned API configs
		terminalZshOhMy: false, // Default Oh My Zsh integration setting
		terminalZshP10k: false, // Default Powerlevel10k integration setting
		terminalZdotdir: false, // Default ZDOTDIR handling setting
		terminalProfile: undefined, // Default VS Code terminal profile (use VS Code default)
		historyPreviewCollapsed: false, // Initialize the new state (default to expanded)
		reasoningBlockCollapsed: true, // Default to collapsed
		enterBehavior: "send", // Default: Enter sends, Shift+Enter creates newline
		cloudUserInfo: null,
		cloudIsAuthenticated: false,
		cloudOrganizations: [],
		sharingEnabled: false,
		publicSharingEnabled: false,
		organizationAllowList: ORGANIZATION_ALLOW_ALL,
		organizationSettingsVersion: -1,
		autoCondenseContext: true,
		autoCondenseContextPercent: 100,
		autoCondenseContextApiConfigId: undefined,
		memoryWriterApiConfigId: undefined,
		profileThresholds: {},
		codebaseIndexConfig: {
			codebaseIndexEnabled: true,
			codebaseIndexQdrantUrl: "http://localhost:6333",
			codebaseIndexEmbedderProvider: "openai",
			codebaseIndexEmbedderBaseUrl: "",
			codebaseIndexEmbedderModelId: "",
			codebaseIndexSearchMaxResults: undefined,
			codebaseIndexSearchMinScore: undefined,
		},
		codebaseIndexModels: { ollama: {}, openai: {} },
		includeDiagnosticMessages: true,
		maxDiagnosticMessages: 50,
		openRouterImageApiKey: "",
		openRouterImageGenerationSelectedModel: "",
		includeCurrentTime: true,
		includeCurrentCost: true,
		includeTaskHistoryInEnhance: true,
		alwaysAllowFollowupQuestions: false,
		lockApiConfigAcrossModes: false,
	})

	const [didHydrateState, setDidHydrateState] = useState(false)
	const [showWelcome, setShowWelcome] = useState(false)
	const [filePaths, setFilePaths] = useState<string[]>([])
	const [openedTabs, setOpenedTabs] = useState<Array<{ label: string; isActive: boolean; path?: string }>>([])
	const [commands, setCommands] = useState<Command[]>([])
	const [mcpServers, setMcpServers] = useState<McpServer[]>([])
	const [currentCheckpoint, setCurrentCheckpoint] = useState<string>()
	const [marketplaceItems, setMarketplaceItems] = useState<any[]>([])
	const [marketplaceInstalledMetadata, setMarketplaceInstalledMetadata] = useState<MarketplaceInstalledMetadata>({
		project: {},
		global: {},
	})
	const [skills, setSkills] = useState<SkillMetadata[]>([])

	const setListApiConfigMeta = useCallback(
		(value: ProviderSettingsEntry[]) => setState((prevState) => ({ ...prevState, listApiConfigMeta: value })),
		[],
	)

	const setApiConfiguration = useCallback((value: ProviderSettings) => {
		setState((prevState) => ({
			...prevState,
			apiConfiguration: {
				...prevState.apiConfiguration,
				...value,
			},
		}))
	}, [])

	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			switch (message.type) {
				case "state": {
					const newState = message.state ?? {}
					setState((prevState) => mergeExtensionState(prevState, newState))
					setShowWelcome(!checkExistKey(newState.apiConfiguration))
					setDidHydrateState(true)
					// Handle marketplace data if present in state message
					if (newState.marketplaceItems !== undefined) {
						setMarketplaceItems(newState.marketplaceItems)
					}
					if (newState.marketplaceInstalledMetadata !== undefined) {
						setMarketplaceInstalledMetadata(newState.marketplaceInstalledMetadata)
					}
					break
				}
				case "action": {
					if (message.action === "toggleAutoApprove") {
						// Toggle the auto-approval state
						setState((prevState) => {
							const newValue = !(prevState.autoApprovalEnabled ?? false)
							// Also send the update to the extension
							vscode.postMessage({ type: "autoApprovalEnabled", bool: newValue })
							return { ...prevState, autoApprovalEnabled: newValue }
						})
					}
					break
				}
				case "workspaceUpdated": {
					const paths = message.filePaths ?? []
					const tabs = message.openedTabs ?? []

					setFilePaths(paths)
					setOpenedTabs(tabs)
					break
				}
				case "commands": {
					setCommands(message.commands ?? [])
					break
				}
				case "messageUpdated": {
					const clineMessage = message.clineMessage!
					setState((prevState) => {
						// Updates from a non-current task (a watched parallel
						// subagent's live tail) are consumed by the subagent
						// panel's own listener — never merge them into the main
						// chat, and don't warn about them.
						if (
							message.sourceTaskId !== undefined &&
							prevState.currentTaskId !== undefined &&
							message.sourceTaskId !== prevState.currentTaskId
						) {
							return prevState
						}
						// worth noting it will never be possible for a more up-to-date message to be sent here or in normal messages post since the presentAssistantContent function uses lock
						const lastIndex = findLastIndex(prevState.clineMessages, (msg) => msg.ts === clineMessage.ts)
						if (lastIndex !== -1) {
							const newClineMessages = [...prevState.clineMessages]
							newClineMessages[lastIndex] = clineMessage
							return { ...prevState, clineMessages: newClineMessages }
						}
						// Log a warning if messageUpdated arrives for a timestamp not in the
						// frontend's clineMessages. With the seq guard and cloud event isolation
						// (layers 1+2), this should not happen under normal conditions. If it
						// does, it signals a state synchronization issue worth investigating.
						console.warn(
							`[messageUpdated] Received update for unknown message ts=${clineMessage.ts}, dropping. ` +
								`Frontend has ${prevState.clineMessages.length} messages.`,
						)
						return prevState
					})
					break
				}
				case "subagentsUpdated": {
					const subagents = message.subagents ?? []
					// Defense-in-depth scope guard: a `subagentsUpdated` push
					// whose `sourceTaskId` does not match the current foreground
					// task is dropped. This catches late terminal updates from a
					// just-abandoned parent (its detached children finishing
					// after the user already switched tasks) so they cannot
					// pollute the new task's panel even if the backend registry
					// has not been cleared yet. Two exceptions:
					//   - `sourceTaskId` is `undefined`: legacy/older backend, or
					//     a reset broadcast sent before the new task id is known.
					//     Accept unconditionally so the reset path keeps working.
					//   - The carried list is empty: a reset broadcast. Always
					//     accept — clearing the panel for the current task is the
					//     intent regardless of who sent it.
					setState((prevState) => {
						const sourceTaskId = message.sourceTaskId
						if (
							sourceTaskId !== undefined &&
							prevState.currentTaskId !== undefined &&
							sourceTaskId !== prevState.currentTaskId &&
							subagents.length > 0
						) {
							return prevState
						}
						return { ...prevState, subagents }
					})
					break
				}
				case "memoryActivity": {
					const memoryActivity = message.memoryActivity
					if (memoryActivity) {
						setState((prevState) => ({ ...prevState, memoryActivity }))
					}
					break
				}
				case "skills": {
					if (message.skills) {
						setSkills(message.skills)
					}
					break
				}
				case "mcpServers": {
					setMcpServers(message.mcpServers ?? [])
					break
				}
				case "currentCheckpointUpdated": {
					setCurrentCheckpoint(message.text)
					break
				}
				case "listApiConfig": {
					setListApiConfigMeta(message.listApiConfig ?? [])
					break
				}
				case "marketplaceData": {
					if (message.marketplaceItems !== undefined) {
						setMarketplaceItems(message.marketplaceItems)
					}
					if (message.marketplaceInstalledMetadata !== undefined) {
						setMarketplaceInstalledMetadata(message.marketplaceInstalledMetadata)
					}
					break
				}
				case "taskHistoryUpdated": {
					// Efficiently update just the task history without replacing entire state
					if (message.taskHistory !== undefined) {
						setState((prevState) => ({
							...prevState,
							taskHistory: message.taskHistory!,
						}))
					}
					break
				}
				case "taskHistoryItemUpdated": {
					const item = message.taskHistoryItem
					if (!item) {
						break
					}
					setState((prevState) => {
						const existingIndex = prevState.taskHistory.findIndex((h) => h.id === item.id)
						let nextHistory: typeof prevState.taskHistory
						if (existingIndex === -1) {
							nextHistory = [item, ...prevState.taskHistory]
						} else {
							nextHistory = [...prevState.taskHistory]
							nextHistory[existingIndex] = item
						}
						// Keep UI semantics consistent with extension: newest-first ordering.
						nextHistory.sort((a, b) => b.ts - a.ts)
						return {
							...prevState,
							taskHistory: nextHistory,
							currentTaskItem:
								prevState.currentTaskItem?.id === item.id ? item : prevState.currentTaskItem,
						}
					})
					break
				}
				case "taskHistoryItemDeleted": {
					const deletedId = message.taskHistoryItemId
					if (!deletedId) {
						break
					}
					setState((prevState) => ({
						...prevState,
						taskHistory: prevState.taskHistory.filter((h) => h.id !== deletedId),
						currentTaskItem:
							prevState.currentTaskItem?.id === deletedId ? undefined : prevState.currentTaskItem,
					}))
					break
				}
			}
		},
		[setListApiConfigMeta],
	)

	useEffect(() => {
		window.addEventListener("message", handleMessage)
		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [handleMessage])

	useEffect(() => {
		vscode.postMessage({ type: "webviewDidLaunch" })
	}, [])

	const contextValue: ExtensionStateContextType = {
		...state,
		reasoningBlockCollapsed: state.reasoningBlockCollapsed ?? true,
		didHydrateState,
		showWelcome,
		mcpServers,
		currentCheckpoint,
		filePaths,
		openedTabs,
		commands,
		soundVolume: state.soundVolume,
		writeDelayMs: state.writeDelayMs,
		cloudIsAuthenticated: state.cloudIsAuthenticated ?? false,
		cloudOrganizations: state.cloudOrganizations ?? [],
		organizationSettingsVersion: state.organizationSettingsVersion ?? -1,
		marketplaceItems,
		marketplaceInstalledMetadata,
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
		skills,
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
