/**
 * The webview's extension state as plain data, and the pure function that
 * applies one extension host message to it.
 *
 * `applyExtensionMessage(prev, message)` never touches React, the DOM or the
 * host: it returns the next store, or `prev` itself when the message changes
 * nothing (so React skips the re-render). Side effects that belong to a
 * message (the host echo for `toggleAutoApprove`) live in
 * `ExtensionStateContextProvider`.
 */
import {
	type Command,
	type ExtensionMessage,
	type ExtensionState,
	type MarketplaceInstalledMetadata,
	type MarketplaceItem,
	type McpServer,
	type SkillMetadata,
	ORGANIZATION_ALLOW_ALL,
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	DEFAULT_ENABLE_CHECKPOINTS,
	DEFAULT_SOUND_ENABLED,
	DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS,
	WEB_TOOLS_DEFAULTS,
	PRUNE_CONDENSE_DEFAULTS,
	experimentDefault,
} from "@roo-code/types"

import { findLastIndex } from "@roo-code/core/browser"
import { checkExistKey } from "@roo/checkExistApiConfig"
import { defaultModeSlug, defaultPrompts } from "@roo/modes"

/**
 * Everything the context derives from host messages. `extensionState` is the
 * host's `ExtensionState` merged push by push; the other fields are slices
 * fed by their own message types. They are kept apart on purpose: a state
 * push also carries `mcpServers` and marketplace fields, and those must not
 * overwrite the slices (see the "state" rows of the message table test).
 */
export interface ExtensionStore {
	extensionState: ExtensionState
	didHydrateState: boolean
	showWelcome: boolean
	filePaths: string[]
	openedTabs: Array<{ label: string; isActive: boolean; path?: string }>
	commands: Command[]
	mcpServers: McpServer[]
	currentCheckpoint?: string
	marketplaceItems: MarketplaceItem[]
	marketplaceInstalledMetadata: MarketplaceInstalledMetadata
	skills: SkillMetadata[]
}

// A fresh object per provider mount, like the useState literal it replaces.
const createInitialExtensionState = (): ExtensionState => ({
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

export const createInitialExtensionStore = (): ExtensionStore => ({
	extensionState: createInitialExtensionState(),
	didHydrateState: false,
	showWelcome: false,
	filePaths: [],
	openedTabs: [],
	commands: [],
	mcpServers: [],
	currentCheckpoint: undefined,
	marketplaceItems: [],
	marketplaceInstalledMetadata: { project: {}, global: {} },
	skills: [],
})

/** The store as one flat object, the shape the context exposes (slices win over same-named state keys). */
export const flattenExtensionStore = ({ extensionState, ...slices }: ExtensionStore) => ({
	...extensionState,
	...slices,
})

/** Applies `update` to `extensionState`; returns `prev` itself when `update` does. */
export const updateExtensionState = (
	prev: ExtensionStore,
	update: (state: ExtensionState) => ExtensionState,
): ExtensionStore => {
	const extensionState = update(prev.extensionState)
	return extensionState === prev.extensionState ? prev : { ...prev, extensionState }
}

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

/**
 * Returns the store after `message`. Pure: no host posts, no timers; the only
 * output besides the return value is the diagnostic `console.warn` for a
 * `messageUpdated` whose ts is unknown.
 */
export function applyExtensionMessage(prev: ExtensionStore, message: ExtensionMessage): ExtensionStore {
	switch (message.type) {
		case "state": {
			const newState = message.state ?? {}
			const next: ExtensionStore = {
				...prev,
				extensionState: mergeExtensionState(prev.extensionState, newState),
				didHydrateState: true,
			}
			// A partial push (for example the storage-error fallback that
			// carries only storageErrorMessage) has no apiConfiguration:
			// keep the previous decision instead of reading "no key".
			if (newState.apiConfiguration !== undefined) {
				next.showWelcome = !checkExistKey(newState.apiConfiguration)
			}
			// Handle marketplace data if present in state message
			if (newState.marketplaceItems !== undefined) {
				next.marketplaceItems = newState.marketplaceItems
			}
			if (newState.marketplaceInstalledMetadata !== undefined) {
				next.marketplaceInstalledMetadata = newState.marketplaceInstalledMetadata
			}
			return next
		}
		case "action": {
			if (message.action !== "toggleAutoApprove") {
				return prev
			}
			// The provider echoes the new value to the host after the commit.
			return updateExtensionState(prev, (prevState) => ({
				...prevState,
				autoApprovalEnabled: !(prevState.autoApprovalEnabled ?? false),
			}))
		}
		case "workspaceUpdated":
			return { ...prev, filePaths: message.filePaths ?? [], openedTabs: message.openedTabs ?? [] }
		case "commands":
			return { ...prev, commands: message.commands ?? [] }
		case "messageUpdated": {
			const clineMessage = message.clineMessage!
			return updateExtensionState(prev, (prevState) => {
				// Updates from a non-current task (a watched parallel
				// subagent's live tail) are consumed by the subagent
				// panel's own listener: never merge them into the main
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
			//     accept: clearing the panel for the current task is the
			//     intent regardless of who sent it.
			return updateExtensionState(prev, (prevState) => {
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
		}
		case "memoryActivity": {
			const memoryActivity = message.memoryActivity
			if (!memoryActivity) {
				return prev
			}
			return updateExtensionState(prev, (prevState) => ({ ...prevState, memoryActivity }))
		}
		case "skills":
			return message.skills ? { ...prev, skills: message.skills } : prev
		case "mcpServers":
			return { ...prev, mcpServers: message.mcpServers ?? [] }
		case "currentCheckpointUpdated":
			return Object.is(prev.currentCheckpoint, message.text) ? prev : { ...prev, currentCheckpoint: message.text }
		case "listApiConfig": {
			const listApiConfigMeta = message.listApiConfig ?? []
			return updateExtensionState(prev, (prevState) => ({ ...prevState, listApiConfigMeta }))
		}
		case "marketplaceData": {
			const { marketplaceItems, marketplaceInstalledMetadata } = message
			if (marketplaceItems === undefined && marketplaceInstalledMetadata === undefined) {
				return prev
			}
			return {
				...prev,
				marketplaceItems: marketplaceItems ?? prev.marketplaceItems,
				marketplaceInstalledMetadata: marketplaceInstalledMetadata ?? prev.marketplaceInstalledMetadata,
			}
		}
		case "taskHistoryUpdated": {
			// Efficiently update just the task history without replacing entire state
			const taskHistory = message.taskHistory
			if (taskHistory === undefined) {
				return prev
			}
			return updateExtensionState(prev, (prevState) => ({ ...prevState, taskHistory }))
		}
		case "taskHistoryItemUpdated": {
			const item = message.taskHistoryItem
			if (!item) {
				return prev
			}
			return updateExtensionState(prev, (prevState) => {
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
					currentTaskItem: prevState.currentTaskItem?.id === item.id ? item : prevState.currentTaskItem,
				}
			})
		}
		case "taskHistoryItemDeleted": {
			const deletedId = message.taskHistoryItemId
			if (!deletedId) {
				return prev
			}
			return updateExtensionState(prev, (prevState) => ({
				...prevState,
				taskHistory: prevState.taskHistory.filter((h) => h.id !== deletedId),
				currentTaskItem: prevState.currentTaskItem?.id === deletedId ? undefined : prevState.currentTaskItem,
			}))
		}
		default:
			return prev
	}
}
