// Routing characterization test for webviewMessageHandler (CORE-R3).
//
// For every message type the handler understands, this spec sends one
// representative message against a recording provider and snapshots the
// ordered list of side effects: provider and task method calls, messages
// posted to the webview, VS Code API calls and calls into mocked modules.
// The snapshot was written before the handler was split into domain modules
// and must stay byte-identical afterwards: that is the proof the split only
// moved code.
//
// Run: cd src && ./node_modules/.bin/vitest run core/webview/__tests__/webviewMessageHandler.routing.spec.ts

import type { WebviewMessage } from "@roo-code/types"

const h = vi.hoisted(() => {
	const events: unknown[] = []
	const labels = new WeakMap<object, string>()

	const normalizeString = (value: string) => value.replace(/\\/g, "/").replace(/^[A-Za-z]:\//, "/")

	const sanitize = (value: unknown, seen: WeakSet<object> = new WeakSet()): unknown => {
		if (typeof value === "string") {
			return normalizeString(value)
		}
		if (typeof value === "function") {
			return "[Function]"
		}
		if (value === null || typeof value !== "object") {
			return value
		}
		const label = labels.get(value)
		if (label) {
			return label
		}
		if (value instanceof Error) {
			return `[Error: ${normalizeString(value.message)}]`
		}
		if (seen.has(value)) {
			return "[Circular]"
		}
		seen.add(value)
		if (Array.isArray(value)) {
			return value.map((item) => sanitize(item, seen))
		}
		const out: Record<string, unknown> = {}
		for (const [key, item] of Object.entries(value)) {
			out[key] = sanitize(item, seen)
		}
		return out
	}

	const record = (name: string, args: unknown[]) => {
		events.push(args.length > 0 ? [name, ...args.map((arg) => sanitize(arg))] : [name])
	}

	const fn = (name: string, impl?: (...args: any[]) => any) =>
		vi.fn((...args: any[]) => {
			record(name, args)
			return impl ? impl(...args) : undefined
		})

	// Wraps an object so that every method call on it is recorded under
	// `${label}.${method}`. Non-function properties are returned untouched.
	const track = <T extends object>(label: string, target: T, sanitizedAs?: string): T => {
		const cache = new Map<PropertyKey, unknown>()
		const proxy = new Proxy(target, {
			get(obj, prop, receiver) {
				const value = Reflect.get(obj, prop, receiver)
				if (typeof value !== "function" || typeof prop === "symbol") {
					return value
				}
				if (!cache.has(prop)) {
					cache.set(prop, (...args: unknown[]) => {
						record(`${label}.${String(prop)}`, args)
						return (value as (...a: unknown[]) => unknown).apply(obj, args)
					})
				}
				return cache.get(prop)
			},
		})
		if (sanitizedAs) {
			labels.set(proxy, sanitizedAs)
			labels.set(target, sanitizedAs)
		}
		return proxy
	}

	return { events, fn, track, sanitize, labels }
})

vi.mock("vscode", () => {
	const uri = (fsPath: string) => ({ fsPath, scheme: "file", path: fsPath })
	return {
		window: {
			showErrorMessage: h.fn("vscode.window.showErrorMessage", async () => undefined),
			showWarningMessage: h.fn("vscode.window.showWarningMessage", async () => undefined),
			// Every modal confirmation answers "yes" so the confirmed path runs.
			showInformationMessage: h.fn("vscode.window.showInformationMessage", async () => "common:answers.yes"),
			showSaveDialog: h.fn("vscode.window.showSaveDialog", async () => undefined),
			showOpenDialog: h.fn("vscode.window.showOpenDialog", async () => undefined),
			showTextDocument: h.fn("vscode.window.showTextDocument", async () => undefined),
		},
		workspace: {
			workspaceFolders: [{ uri: uri("/workspace") }],
			getConfiguration: h.fn("vscode.workspace.getConfiguration", () => ({
				update: h.fn("configuration.update", async () => undefined),
				get: h.fn("configuration.get", () => "setting-value"),
			})),
			openTextDocument: h.fn("vscode.workspace.openTextDocument", async (p: string) => ({ uri: uri(p) })),
		},
		env: {
			openExternal: h.fn("vscode.env.openExternal", async () => true),
			clipboard: { writeText: h.fn("vscode.env.clipboard.writeText", async () => undefined) },
		},
		commands: {
			executeCommand: h.fn("vscode.commands.executeCommand", async () => undefined),
		},
		Uri: {
			file: (p: string) => uri(p),
			parse: (value: string) => {
				const url = new URL(value)
				return {
					scheme: url.protocol.replace(":", ""),
					query: url.search.replace(/^\?/, ""),
					path: url.pathname,
				}
			},
			joinPath: (base: { fsPath: string }, ...parts: string[]) => uri([base.fsPath, ...parts].join("/")),
		},
		ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
	}
})

vi.mock("fs/promises", () => {
	const api = {
		mkdir: h.fn("fs.mkdir", async () => undefined),
		readFile: h.fn("fs.readFile", async () => "file-content"),
		writeFile: h.fn("fs.writeFile", async () => undefined),
		rm: h.fn("fs.rm", async () => undefined),
		unlink: h.fn("fs.unlink", async () => undefined),
		access: h.fn("fs.access", async () => {
			throw new Error("ENOENT")
		}),
	}
	return { ...api, default: api }
})

vi.mock("os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("os")>()
	const overrides = { homedir: () => "/home/user", tmpdir: () => "/tmp" }
	return { ...actual, ...overrides, default: { ...actual, ...overrides } }
})

vi.mock("../../../utils/safeWriteJson", () => ({ safeWriteJson: h.fn("safeWriteJson", async () => undefined) }))
vi.mock("../../../services/roo-config", () => ({
	getRooDirectoriesForCwd: h.fn("getRooDirectoriesForCwd", (cwd: string) => [`${cwd}/.roo`]),
}))
vi.mock("@roo-code/core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@roo-code/core")>()),
	customToolRegistry: {
		loadFromDirectories: h.fn("customToolRegistry.loadFromDirectories", async () => undefined),
		getAllSerialized: h.fn("customToolRegistry.getAllSerialized", () => []),
	},
}))
vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: () => true,
		instance: {
			shareTask: h.fn("CloudService.shareTask", async () => ({ success: true, shareUrl: "https://share/1" })),
			updateUserSettings: h.fn("CloudService.updateUserSettings", async () => undefined),
			login: h.fn("CloudService.login", async () => undefined),
			logout: h.fn("CloudService.logout", async () => undefined),
			handleAuthCallback: h.fn("CloudService.handleAuthCallback", async () => undefined),
			switchOrganization: h.fn("CloudService.switchOrganization", async () => undefined),
		},
	},
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: () => true,
		instance: {
			updateTelemetryState: h.fn("Telemetry.updateTelemetryState"),
			captureModeSettingChanged: h.fn("Telemetry.captureModeSettingChanged"),
			captureCustomModeCreated: h.fn("Telemetry.captureCustomModeCreated"),
			captureTelemetrySettingsChanged: h.fn("Telemetry.captureTelemetrySettingsChanged"),
			captureEvent: h.fn("Telemetry.captureEvent"),
			captureTabShown: h.fn("Telemetry.captureTabShown"),
		},
	},
}))
vi.mock("../../task-persistence", () => ({ saveTaskMessages: h.fn("saveTaskMessages", async () => undefined) }))
vi.mock("../checkpointRestoreHandler", () => ({
	handleCheckpointRestoreOperation: h.fn("handleCheckpointRestoreOperation", async () => undefined),
}))
vi.mock("../diagnosticsHandler", () => ({
	generateErrorDiagnostics: h.fn("generateErrorDiagnostics", async () => ({ success: true })),
}))
vi.mock("../skillsMessageHandler", () => ({
	handleRequestSkills: h.fn("handleRequestSkills", async () => undefined),
	handleCreateSkill: h.fn("handleCreateSkill", async () => undefined),
	handleDeleteSkill: h.fn("handleDeleteSkill", async () => undefined),
	handleUpdateSkillModes: h.fn("handleUpdateSkillModes", async () => undefined),
	handleOpenSkillFile: h.fn("handleOpenSkillFile", async () => undefined),
}))
vi.mock("../../../i18n", () => ({
	t: (key: string, args?: Record<string, unknown>) => (args ? `${key} ${JSON.stringify(args)}` : key),
	changeLanguage: h.fn("changeLanguage"),
}))
vi.mock("../messageEnhancer", () => ({
	MessageEnhancer: {
		enhanceMessage: h.fn("MessageEnhancer.enhanceMessage", async () => ({
			success: true,
			enhancedText: "enhanced",
		})),
		captureTelemetry: h.fn("MessageEnhancer.captureTelemetry"),
	},
}))
vi.mock("../../../services/code-index/manager", () => ({
	CodeIndexManager: { getAllInstances: h.fn("CodeIndexManager.getAllInstances", () => []) },
}))
vi.mock("../../../integrations/terminal/Terminal", () => ({
	Terminal: {
		setShellIntegrationTimeout: h.fn("Terminal.setShellIntegrationTimeout"),
		setShellIntegrationDisabled: h.fn("Terminal.setShellIntegrationDisabled"),
		setCommandDelay: h.fn("Terminal.setCommandDelay"),
		setPowershellCounter: h.fn("Terminal.setPowershellCounter"),
		setTerminalZshClearEolMark: h.fn("Terminal.setTerminalZshClearEolMark"),
		setTerminalZshOhMy: h.fn("Terminal.setTerminalZshOhMy"),
		setTerminalZshP10k: h.fn("Terminal.setTerminalZshP10k"),
		setTerminalZdotdir: h.fn("Terminal.setTerminalZdotdir"),
		getTerminalProfile: h.fn("Terminal.getTerminalProfile", () => "bash"),
		setTerminalProfile: h.fn("Terminal.setTerminalProfile"),
		setExecaShellPath: h.fn("Terminal.setExecaShellPath"),
		getAvailableProfileNames: h.fn("Terminal.getAvailableProfileNames", () => ["bash", "zsh"]),
	},
}))
vi.mock("../../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: { closeIdleTerminals: h.fn("TerminalRegistry.closeIdleTerminals") },
}))
vi.mock("../../../integrations/misc/open-file", () => ({ openFile: h.fn("openFile", async () => undefined) }))
vi.mock("../../../integrations/misc/image-handler", () => ({
	openImage: h.fn("openImage", async () => undefined),
	saveImage: h.fn("saveImage", async () => undefined),
}))
vi.mock("../../../integrations/misc/process-images", () => ({
	selectImages: h.fn("selectImages", async () => ["data:image/png;base64,AAA"]),
}))
vi.mock("../../../integrations/misc/custom-sounds", () => ({
	deleteCustomSound: h.fn("deleteCustomSound", async () => undefined),
	getCustomSoundOriginalSettingKey: (audioType: string) => `customSoundOriginal_${audioType}`,
	getCustomSoundSettingKey: (audioType: string) => `customSound_${audioType}`,
	selectAndStoreCustomSound: h.fn("selectAndStoreCustomSound", async () => ({
		basename: "sound.mp3",
		originalName: "Sound.mp3",
	})),
}))
vi.mock("../../../integrations/theme/getTheme", () => ({
	getTheme: h.fn("getTheme", async () => ({ name: "theme" })),
}))
vi.mock("../../../services/search/file-search", () => ({
	searchWorkspaceFiles: h.fn("searchWorkspaceFiles", async () => [
		{ path: "src/a.ts", type: "file" },
		{ path: "secret/b.ts", type: "file" },
	]),
}))
vi.mock("../../../utils/fs", () => ({ fileExistsAtPath: h.fn("fileExistsAtPath", async () => false) }))
vi.mock("../../../utils/git", () => ({ searchCommits: h.fn("searchCommits", async () => []) }))
vi.mock("../../config/importExport", () => ({
	exportSettings: h.fn("exportSettings", async () => undefined),
	importSettingsWithFeedback: h.fn("importSettingsWithFeedback", async () => undefined),
}))
vi.mock("../../../api/providers/fetchers/modelSourceRegistry", () => ({
	fetchModelSource: h.fn("fetchModelSource", async () => ({ models: { m1: { contextWindow: 1 } } })),
}))
vi.mock("../../mentions", () => ({ openMention: h.fn("openMention", async () => undefined) }))
vi.mock("../../mentions/resolveImageMentions", () => ({
	resolveImageMentions: h.fn(
		"resolveImageMentions",
		async ({ text, images }: { text: string; images?: string[] }) => ({
			text,
			images: images ?? [],
		}),
	),
}))
vi.mock("../../ignore/RooIgnoreController", () => ({
	RooIgnoreController: class {
		constructor(cwd: string) {
			h.events.push(["new RooIgnoreController", h.sanitize(cwd)])
		}
		initialize = h.fn("RooIgnoreController.initialize", async () => undefined)
		filterPaths = h.fn("RooIgnoreController.filterPaths", (paths: string[]) =>
			paths.filter((p) => !p.startsWith("secret/")),
		)
		dispose = h.fn("RooIgnoreController.dispose")
	},
}))
vi.mock("../../../utils/path", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../../utils/path")>()),
	getWorkspacePath: h.fn("getWorkspacePath", () => "/workspace"),
}))
vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: h.fn("isPathOutsideWorkspace", () => false),
}))
vi.mock("../generateSystemPrompt", () => ({
	generateSystemPrompt: h.fn("generateSystemPrompt", async () => "SYSTEM PROMPT"),
}))
vi.mock("../../../utils/export", () => ({
	resolveDefaultSaveUri: h.fn("resolveDefaultSaveUri", async (_proxy: unknown, _key: string, name: string) => ({
		fsPath: `/downloads/${name}`,
	})),
	saveLastExportPath: h.fn("saveLastExportPath", async () => undefined),
}))
vi.mock("../../tools/UpdateTodoListTool", () => ({ setPendingTodoList: h.fn("setPendingTodoList") }))
vi.mock("../worktree", () => ({
	handleListWorktrees: h.fn("handleListWorktrees", async () => ({
		worktrees: [],
		isGitRepo: true,
		isMultiRoot: false,
		isSubfolder: false,
		gitRootPath: "/workspace",
	})),
	handleCreateWorktree: h.fn("handleCreateWorktree", async () => ({ success: true, message: "created" })),
	handleDeleteWorktree: h.fn("handleDeleteWorktree", async () => ({ success: true, message: "deleted" })),
	handleSwitchWorktree: h.fn("handleSwitchWorktree", async () => ({ success: true, message: "switched" })),
	handleGetAvailableBranches: h.fn("handleGetAvailableBranches", async () => ({
		localBranches: ["main"],
		remoteBranches: [],
		currentBranch: "main",
	})),
	handleGetWorktreeDefaults: h.fn("handleGetWorktreeDefaults", async () => ({
		suggestedBranch: "wt-1",
		suggestedPath: "/wt-1",
	})),
	handleGetWorktreeIncludeStatus: h.fn("handleGetWorktreeIncludeStatus", async () => ({
		exists: true,
		hasGitignore: true,
	})),
	handleCreateWorktreeInclude: h.fn("handleCreateWorktreeInclude", async () => ({
		success: true,
		message: "include created",
	})),
}))
vi.mock("../../../services/command/commands", () => ({
	getCommands: h.fn("getCommands", async () => [
		{
			name: "deploy",
			source: "project",
			filePath: "/workspace/.roo/commands/deploy.md",
			description: "Deploy",
			argumentHint: "env",
			content: "body",
		},
	]),
	getCommand: h.fn("getCommand", async (_cwd: string, name: string) => ({
		name,
		source: "project",
		filePath: `/workspace/.roo/commands/${name}.md`,
	})),
}))
vi.mock("../../../integrations/openai-codex/oauth", () => ({
	openAiCodexOAuthManager: {
		startAuthorizationFlow: h.fn("codexOAuth.startAuthorizationFlow", () => "https://auth.example/authorize"),
		waitForCallback: h.fn("codexOAuth.waitForCallback", async () => undefined),
		clearCredentials: h.fn("codexOAuth.clearCredentials", async () => undefined),
		getAccessToken: h.fn("codexOAuth.getAccessToken", async () => "access-token"),
		getAccountId: h.fn("codexOAuth.getAccountId", async () => "account-1"),
	},
}))
vi.mock("../../../integrations/openai-codex/rate-limits", () => ({
	fetchOpenAiCodexRateLimitInfo: h.fn("fetchOpenAiCodexRateLimitInfo", async () => ({ primary: { usedPercent: 1 } })),
}))
vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: h.fn("getTaskDirectoryPath", async (base: string, id: string) => `${base}/tasks/${id}`),
}))
vi.mock("../PlanReviewPanel", () => ({
	PlanReviewPanel: { open: h.fn("PlanReviewPanel.open", async () => undefined) },
}))
vi.mock("../ClineProvider", () => ({ ClineProvider: class {} }))

import { webviewMessageHandler } from "../webviewMessageHandler"

const TS_USER = 1000
const TS_REPLY = 1500
const TS_CHECKPOINT = 2000

function createTask(taskId: string) {
	const task = {
		taskId,
		cwd: "/workspace",
		isInitialized: true,
		rooIgnoreController: undefined,
		clineMessages: [
			{ ts: 500, type: "say", say: "text", text: "start", checkpoint: { hash: "c0" } },
			{ ts: TS_USER, type: "say", say: "user_feedback", text: "question" },
			{ ts: TS_REPLY, type: "say", say: "text", text: "answer" },
			{ ts: TS_CHECKPOINT, type: "say", say: "checkpoint_saved", text: "hash-1" },
		],
		apiConversationHistory: [
			{ ts: 500, role: "user", content: "start" },
			{ ts: TS_USER, role: "user", content: "question" },
			{ ts: TS_REPLY, role: "assistant", content: "answer" },
		],
		messageManager: h.track(`task(${taskId}).messageManager`, {
			rewindToTimestamp: async () => undefined,
		}),
		messageQueueService: h.track(`task(${taskId}).messageQueueService`, {
			addMessage: () => undefined,
			removeMessage: () => undefined,
			updateMessage: () => undefined,
		}),
		getTaskMode: async () => "code",
		handleWebviewAskResponse: () => undefined,
		handleTerminalOperation: () => undefined,
		checkpointDiff: async () => undefined,
		checkpointRestore: async () => undefined,
		cancelAutoApprovalTimeout: () => undefined,
		submitUserMessage: async () => undefined,
		abortTask: async () => undefined,
	}
	return h.track(`task(${taskId})`, task, `<task ${taskId}>`)
}

function createProvider() {
	const globalState: Record<string, unknown> = {
		currentApiConfigName: "default",
		customModePrompts: { code: { roleDefinition: "old" } },
		pinnedApiConfigs: { default: true },
		dismissedUpsells: ["seen"],
		telemetrySetting: "enabled",
		codebaseIndexConfig: { codebaseIndexEnabled: false, codebaseIndexEmbedderProvider: "openai" },
		experiments: { preventFocusDisruption: false },
	}
	const currentTask = createTask("task-1")
	const childTask = createTask("child-1")
	const mcpHub = h.track("mcpHub", {
		getAllServers: () => [{ name: "srv" }],
		handleMcpEnabledChange: async () => undefined,
		getMcpSettingsFilePath: async () => "/global/mcp_settings.json",
		deleteServer: async () => undefined,
		restartConnection: async () => undefined,
		toggleToolAlwaysAllow: async () => undefined,
		toggleToolEnabledForPrompt: async () => undefined,
		toggleServerDisabled: async () => undefined,
		refreshAllConnections: async () => undefined,
		updateServerTimeout: async () => undefined,
	})
	const provider = {
		cwd: "/workspace",
		latestAnnouncementId: "announcement-1",
		isViewLaunched: false,
		workspaceTracker: h.track("workspaceTracker", { initializeFilePaths: () => undefined }),
		context: {
			workspaceState: h.track("context.workspaceState", { update: async () => undefined }),
			secrets: h.track("context.secrets", {
				get: async (key: string) => (key === "codeIndexOpenAiKey" ? "sk" : undefined),
			}),
		},
		contextProxy: h.track("contextProxy", {
			globalStorageUri: { fsPath: "/storage" },
			getValue: (key: string) => globalState[key],
			setValue: async (key: string, value: unknown) => {
				globalState[key] = value
			},
			storeSecret: async () => undefined,
		}),
		customModesManager: h.track("customModesManager", {
			getCustomModes: async () => [
				{ slug: "m1", name: "M1", roleDefinition: "r", groups: [], source: "project" },
			],
			getCustomModesFilePath: async () => "/global/custom_modes.yaml",
			updateCustomMode: async () => undefined,
			deleteCustomMode: async () => undefined,
			exportModeWithRules: async () => ({ success: true, yaml: "slug: code" }),
			importModeWithRules: async () => ({ success: true, slug: "imported" }),
			checkRulesDirectoryHasContent: async () => true,
		}),
		providerSettingsManager: h.track("providerSettingsManager", {
			listConfig: async () => [
				{ name: "default", id: "id-default", apiProvider: "anthropic" },
				{ name: "other", id: "id-other", apiProvider: "openai" },
			],
			hasConfig: async () => true,
			saveConfig: async () => "id",
			getProfile: async ({ name }: { name: string }) => ({ id: `id-${name}`, name }),
			deleteConfig: async () => undefined,
			setModeConfigs: async () => undefined,
		}),
		subagentRegistry: h.track("subagentRegistry", {
			watch: () => undefined,
			unwatch: () => undefined,
			markTerminal: () => undefined,
		}),
		getCurrentTask: () => currentTask,
		getBackgroundTask: (id: string) => (id === "child-1" ? childTask : undefined),
		getMcpHub: () => mcpHub,
		getSkillsManager: () => undefined,
		getCurrentWorkspaceCodeIndexManager: () => undefined,
		getState: async () => ({
			mode: "code",
			apiConfiguration: { apiProvider: "anthropic", apiKey: "key" },
			customSupportPrompts: {},
			listApiConfigMeta: [],
			enhancementApiConfigId: undefined,
			includeTaskHistoryInEnhance: true,
			showRooIgnoredFiles: false,
			maxImageFileSize: 5,
			maxTotalImageSize: 20,
		}),
		getStateToPostToWebview: async () => ({ mode: "code", hasOpenedModeSelector: undefined }),
		postMessageToWebview: async () => undefined,
		postStateToWebview: async () => undefined,
		log: () => undefined,
		createTask: async () => currentTask,
		updateCustomInstructions: async () => undefined,
		clearTask: async () => undefined,
		exportTaskWithId: async () => undefined,
		showTaskWithId: async () => undefined,
		condenseTaskContext: async () => undefined,
		deleteTaskWithId: async () => undefined,
		getTaskWithAggregatedCosts: async (id: string) => ({ historyItem: { id }, aggregatedCosts: { totalCost: 1 } }),
		resetState: async () => undefined,
		cancelTask: async () => undefined,
		showOutputChannel: () => undefined,
		handleModeSwitch: async () => undefined,
		setCliModeProviderSettings: () => undefined,
		activateProviderProfile: async () => undefined,
		upsertProviderProfile: async () => "id",
		fetchMarketplaceData: async () => undefined,
		getModes: async () => [{ slug: "code", name: "Code" }],
	}
	return h.track("provider", provider, "<provider>")
}

function createMarketplaceManager() {
	return h.track(
		"marketplaceManager",
		{
			updateWithFilteredItems: async () => undefined,
			installMarketplaceItem: async () => "/workspace/.roo/mcp.json",
			removeInstalledMarketplaceItem: async () => undefined,
		},
		"<marketplaceManager>",
	)
}

const mcpItem = { id: "item-1", type: "mcp", name: "Item", description: "d", url: "u", content: "c" }

// One representative message per handled type. Types not listed here are sent
// as a bare `{ type }`. Labels after a "#" are extra variants of the same type.
const ROUTES: Array<[string, Record<string, unknown>]> = [
	["webviewDidLaunch", {}],
	["newTask", { text: "build it", images: ["data:image/png;base64,AAA"] }],
	["customInstructions", { text: "be brief" }],
	["askResponse", { askResponse: "messageResponse", text: "yes", images: [] }],
	["askResponse#subagent", { askResponse: "messageResponse", text: "child answer", taskId: "child-1" }],
	[
		"updateSettings",
		{
			updatedSettings: {
				language: "de",
				allowedCommands: ["ls", "ls", " git "],
				terminalShellIntegrationTimeout: 1000,
				terminalShellIntegrationDisabled: true,
				terminalCommandDelay: 5,
				terminalPowershellCounter: true,
				terminalZshClearEolMark: true,
				terminalZshOhMy: true,
				terminalZshP10k: true,
				terminalZdotdir: true,
				terminalProfile: "zsh",
				execaShellPath: "/bin/zsh",
				mcpEnabled: false,
				experiments: { imageGeneration: true },
				customSupportPrompts: undefined,
				alwaysAllowReadOnly: true,
			},
		},
	],
	["terminalOperation", { terminalOperation: "continue" }],
	["clearTask", {}],
	["didShowAnnouncement", {}],
	["selectImages", { context: "chat", messageTs: 42 }],
	["selectCustomSound", { audioType: "notification" }],
	["resetCustomSound", { audioType: "celebration" }],
	["exportCurrentTask", {}],
	["shareCurrentTask", { visibility: "public" }],
	["showTaskWithId", { text: "task-2" }],
	["condenseTaskContextRequest", { text: "task-1" }],
	["deleteTaskWithId", { text: "task-2" }],
	["deleteMultipleTasksWithIds", { ids: ["a", "b"] }],
	["exportTaskWithId", { text: "task-2" }],
	["getTaskWithAggregatedCosts", { text: "task-1" }],
	["importSettings", {}],
	["exportSettings", {}],
	["resetState", {}],
	["requestProviderModels", { modelSourceRequest: { requestId: "req-1", source: { id: "openrouter" } } }],
	["openImage", { text: "data:image/png;base64,AAA", values: { a: 1 } }],
	["saveImage", { dataUri: "data:image/png;base64,AAA" }],
	["openFile", { text: "src/a.ts", values: { line: 3 } }],
	["readFileContent", { text: "src/a.ts" }],
	["openMention", { text: "/src/a.ts" }],
	["openExternal", { url: "https://example.com/" }],
	["checkpointDiff", { payload: { ts: TS_CHECKPOINT, commitHash: "hash-1", mode: "checkpoint" } }],
	["checkpointRestore", { payload: { ts: TS_CHECKPOINT, commitHash: "hash-1", mode: "restore" } }],
	["cancelTask", {}],
	["subscribeSubagentMessages", { taskId: "child-1" }],
	["unsubscribeSubagentMessages", { taskId: "child-1" }],
	["cancelSubagent", { taskId: "child-1" }],
	["queueSubagentMessage", { taskId: "child-1", text: "hint" }],
	["cancelAutoApproval", {}],
	["openCustomModesSettings", {}],
	["openTerminalProfilePicker", {}],
	["openKeyboardShortcuts", { text: "tumble" }],
	["openMcpSettings", {}],
	["openExtensionLogs", {}],
	["openProjectMcpSettings", {}],
	["deleteMcpServer", { serverName: "srv", source: "global" }],
	["restartMcpServer", { text: "srv", source: "project" }],
	["toggleToolAlwaysAllow", { serverName: "srv", source: "global", toolName: "tool", alwaysAllow: true }],
	["toggleToolEnabledForPrompt", { serverName: "srv", source: "global", toolName: "tool", isEnabled: false }],
	["toggleMcpServer", { serverName: "srv", disabled: true, source: "global" }],
	["taskSyncEnabled", { bool: true }],
	["refreshAllMcpServers", {}],
	["updateVSCodeSetting", { setting: "terminal.integrated.inheritEnv", value: false }],
	["updateVSCodeSetting#restricted", { setting: "editor.fontSize", value: 20 }],
	["getVSCodeSetting", { setting: "editor.fontSize" }],
	["requestTerminalProfiles", {}],
	["mode", { text: "architect" }],
	["updatePrompt", { promptMode: "code", customPrompt: { roleDefinition: "new" } }],
	["deleteMessage", { value: TS_REPLY }],
	["submitEditedMessage", { value: TS_REPLY, editedMessageContent: "edited", images: [] }],
	["hasOpenedModeSelector", { bool: true }],
	["lockApiConfigAcrossModes", { bool: true }],
	["cliModeProviderSettings", { cliModeProviderSettings: { code: { apiProvider: "openai" } } }],
	["assignCurrentApiConfigToModes", { values: { configId: "id-default", modeSlugs: ["code", "ask"] } }],
	["toggleApiConfigPin", { text: "default" }],
	["enhancementApiConfigId", { text: "id-other" }],
	["autoApprovalEnabled", { bool: true }],
	["enhancePrompt", { text: "make it better" }],
	["getSystemPrompt", { mode: "code" }],
	["copySystemPrompt", { mode: "code" }],
	["searchCommits", { query: "fix" }],
	["searchFiles", { query: "a", requestId: "search-1" }],
	["updateTodoList", { payload: { todos: [{ id: "1", content: "x", status: "pending" }] } }],
	["updateTodoList#subagent", { taskId: "child-1", payload: { todos: [] } }],
	["refreshCustomTools", {}],
	["upsertApiConfiguration", { text: "profile", apiConfiguration: { apiProvider: "anthropic" } }],
	[
		"renameApiConfiguration",
		{ values: { oldName: "default", newName: "renamed" }, apiConfiguration: { apiProvider: "anthropic" } },
	],
	["loadApiConfiguration", { text: "other" }],
	["loadApiConfigurationById", { text: "id-other" }],
	["deleteApiConfiguration", { text: "default" }],
	["deleteMessageConfirm", { messageTs: TS_REPLY }],
	["deleteMessageConfirm#restoreCheckpoint", { messageTs: TS_REPLY, restoreCheckpoint: true }],
	["editMessageConfirm", { messageTs: TS_REPLY, text: "edited", images: [] }],
	["editMessageConfirm#restoreCheckpoint", { messageTs: TS_REPLY, text: "edited", restoreCheckpoint: true }],
	["updateMcpTimeout", { serverName: "srv", timeout: 30, source: "global" }],
	["updateCustomMode", { modeConfig: { slug: "m1", name: "M1 renamed", roleDefinition: "r", groups: [] } }],
	["updateCustomMode#new", { modeConfig: { slug: "m2", name: "M2", roleDefinition: "r", groups: [] } }],
	["deleteCustomMode", { slug: "m1" }],
	["deleteCustomMode#checkOnly", { slug: "m1", checkOnly: true }],
	["exportMode", { slug: "code" }],
	["importMode", { source: "global" }],
	["checkRulesDirectory", { slug: "code" }],
	["telemetrySetting", { text: "disabled" }],
	["debugSetting", { bool: true }],
	["rooCloudSignIn", { useProviderSignup: true }],
	["rooCloudSignOut", {}],
	["openAiCodexSignIn", {}],
	["openAiCodexSignOut", {}],
	["rooCloudManualUrl", { text: "vscode://ext/callback?code=c1&state=s1&organizationId=null" }],
	["switchOrganization", { organizationId: "org-1" }],
	[
		"saveCodeIndexSettingsAtomic",
		{
			codeIndexSettings: {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://qdrant",
				codebaseIndexEmbedderProvider: "ollama",
				codebaseIndexEmbedderModelId: "nomic",
				codeIndexOpenAiKey: "sk-new",
			},
		},
	],
	["requestIndexingStatus", {}],
	["requestCodeIndexSecretStatus", {}],
	["startIndexing", {}],
	["stopIndexing", {}],
	["toggleWorkspaceIndexing", { bool: true }],
	["setAutoEnableDefault", { bool: false }],
	["clearIndexData", {}],
	["focusPanelRequest", {}],
	["filterMarketplaceItems", { filters: { type: "mcp", search: "x", tags: ["a"] } }],
	["fetchMarketplaceData", {}],
	["installMarketplaceItem", { mpItem: mcpItem, mpInstallOptions: { target: "project" } }],
	["removeInstalledMarketplaceItem", { mpItem: mcpItem, mpInstallOptions: { target: "project" } }],
	["switchTab", { tab: "settings", values: { section: "about" } }],
	["requestCommands", {}],
	["requestModes", {}],
	["requestSkills", {}],
	["createSkill", { skillName: "s1", source: "project" }],
	["deleteSkill", { skillName: "s1", source: "project" }],
	["updateSkillModes", { skillName: "s1", source: "project", skillModeSlugs: ["code"] }],
	["openSkillFile", { skillName: "s1", source: "project" }],
	["openCommandFile", { text: "deploy" }],
	["deleteCommand", { text: "deploy", values: { source: "project" } }],
	["createCommand", { text: "/My Command.md", values: { source: "project" } }],
	["createCommand#global-generated-name", { values: { source: "global" } }],
	["showMdmAuthRequiredNotification", {}],
	["queueMessage", { text: "later", images: [] }],
	["removeQueuedMessage", { text: "queued-1" }],
	["editQueuedMessage", { payload: { id: "queued-1", text: "changed", images: [] } }],
	["dismissUpsell", { upsellId: "new-upsell" }],
	["getDismissedUpsells", {}],
	["openMarkdownPreview", { text: "# Title" }],
	["openPlanReview", { text: "plans/plan.md" }],
	["openPlanReview#markdown", { values: { markdown: "# Plan" } }],
	["requestOpenAiCodexRateLimits", {}],
	["openDebugApiHistory", {}],
	["openDebugUiHistory", {}],
	["downloadErrorDiagnostics", { values: { note: "n" } }],
	["listWorktrees", {}],
	[
		"createWorktree",
		{
			worktreePath: "/wt-1",
			worktreeBranch: "wt-1",
			worktreeBaseBranch: "main",
			worktreeCreateNewBranch: true,
		},
	],
	["deleteWorktree", { worktreePath: "/wt-1", worktreeForce: true }],
	["switchWorktree", { worktreePath: "/wt-1", worktreeNewWindow: false }],
	["getAvailableBranches", {}],
	["getWorktreeDefaults", {}],
	["getWorktreeIncludeStatus", {}],
	["createWorktreeInclude", { worktreeIncludeContent: "node_modules" }],
	["browseForWorktreePath", {}],
	// Not handled: must produce no side effect at all.
	["enhancedPrompt#unhandled", {}],
]

/** Every message type the handler routes today (137 types). */
const ROUTED_TYPES = [...new Set(ROUTES.map(([label]) => label.split("#")[0]))].filter(
	(type) => type !== "enhancedPrompt",
)

async function flush() {
	for (let i = 0; i < 10; i++) {
		await new Promise((resolve) => setImmediate(resolve))
	}
}

describe("webviewMessageHandler routing (characterization, CORE-R3)", () => {
	let dateNow: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		dateNow = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000)
	})

	afterEach(() => {
		dateNow.mockRestore()
	})

	it("covers every routed message type exactly once in the route list", () => {
		expect(ROUTED_TYPES).toHaveLength(137)
	})

	it.each(ROUTES)("%s", async (label, fields) => {
		const type = label.split("#")[0]
		const provider = createProvider()
		const marketplaceManager = createMarketplaceManager()
		h.events.length = 0

		let outcome = "resolved"
		try {
			await webviewMessageHandler(
				provider as any,
				{ type, ...fields } as unknown as WebviewMessage,
				marketplaceManager as any,
			)
		} catch (error) {
			outcome = `rejected: ${error instanceof Error ? error.message : String(error)}`
		}
		await flush()

		expect({ outcome, events: [...h.events] }).toMatchSnapshot()
	})
})
