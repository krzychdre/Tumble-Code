// pnpm --filter roo-cline test core/webview/__tests__/ClineProvider.stateBuilder.spec.ts
//
// Characterization tests for the two state builders (CORE-R1): `getState()`
// (the settings accessor the host code reads) and `getStateToPostToWebview()`
// (what the webview receives). The golden snapshots pin every key and value,
// including null versus undefined (postMessage drops undefined keys, so the
// webview can only clear a slot through an explicit null). The parity test
// pins that a key present in both views carries the same value, except for
// the documented view-only transforms.

import * as vscode from "vscode"
import * as path from "path"
import { isDeepStrictEqual } from "util"

import type { RooCodeSettings } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { experimentDefault } from "../../../shared/experiments"
import { EMBEDDING_MODEL_PROFILES } from "../../../shared/embeddingModels"
import { ContextProxy } from "../../config/ContextProxy"
import { TaskHistoryStore } from "../../task-persistence"
import { ClineProvider } from "../ClineProvider"
import { checkAutoApproval } from "../../auto-approval"
import { webviewMessageHandler } from "../webviewMessageHandler"

vi.mock("p-wait-for", () => ({
	__esModule: true,
	default: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
	readdir: vi.fn().mockResolvedValue([]),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
	access: vi.fn().mockResolvedValue(undefined),
	rm: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("axios", () => ({
	default: { get: vi.fn().mockResolvedValue({ data: { data: [] } }), post: vi.fn() },
	get: vi.fn().mockResolvedValue({ data: { data: [] } }),
	post: vi.fn(),
}))

vi.mock("delay", () => {
	const delayFn = (_ms: number) => Promise.resolve()
	delayFn.createDelay = () => delayFn
	delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
	delayFn.range = () => Promise.resolve()
	return { default: delayFn }
})

vi.mock("../../prompts/sections/custom-instructions")

vi.mock("../../../utils/storage", () => ({
	getSettingsDirectoryPath: vi.fn().mockResolvedValue("/test/settings/path"),
	getTaskDirectoryPath: vi.fn().mockResolvedValue("/test/task/path"),
	getGlobalStoragePath: vi.fn().mockResolvedValue("/test/storage/path"),
	getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => defaultPath),
}))

vi.mock("../../../utils/safeWriteJson", () => {
	const write = vi.fn().mockResolvedValue(undefined)
	return {
		safeWriteJson: write,
		withLockedJsonTransaction: vi.fn(
			async <T>(
				_lockTarget: string,
				_destination: string,
				body: (writeJson: (data: unknown) => Promise<void>) => Promise<T>,
			) => body((data) => write(data)),
		),
	}
})

vi.mock("proper-lockfile", () => ({
	lock: vi.fn(async () => async () => {}),
	unlock: vi.fn(async () => {}),
	check: vi.fn(async () => false),
}))

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
	CallToolResultSchema: {},
	ListResourcesResultSchema: {},
	ListResourceTemplatesResultSchema: {},
	ListToolsResultSchema: {},
	ReadResourceResultSchema: {},
	ErrorCode: { InvalidRequest: "InvalidRequest", MethodNotFound: "MethodNotFound", InternalError: "InternalError" },
	McpError: class McpError extends Error {
		code: string
		constructor(code: string, message: string) {
			super(message)
			this.code = code
			this.name = "McpError"
		}
	},
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
		listTools: vi.fn().mockResolvedValue({ tools: [] }),
		callTool: vi.fn().mockResolvedValue({ content: [] }),
	})),
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn().mockImplementation(() => ({
		connect: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
	})),
}))

// Workspace configuration seen by the command-list merge and the `debug` flag.
// `get()` returns the value in `workspaceConfig`; `inspect()` reports the
// per-scope values from `configScopes`, or treats a plain `workspaceConfig`
// entry as a workspace-scope value (what `.vscode/settings.json` sets).
const workspaceConfig: Record<string, unknown> = {}
type ConfigScopes = { globalValue?: unknown; workspaceValue?: unknown; workspaceFolderValue?: unknown }
const configScopes: Record<string, ConfigScopes> = {}

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	OutputChannel: vi.fn(),
	WebviewView: vi.fn(),
	Uri: { joinPath: vi.fn(), file: vi.fn() },
	CodeActionKind: { QuickFix: { value: "quickfix" }, RefactorRewrite: { value: "refactor.rewrite" } },
	commands: { executeCommand: vi.fn().mockResolvedValue(undefined) },
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		getConfiguration: vi.fn().mockImplementation(() => ({
			get: vi.fn().mockImplementation((key: string, fallback?: unknown) => workspaceConfig[key] ?? fallback),
			inspect: vi.fn().mockImplementation((key: string) =>
				configScopes[key]
					? { key, ...configScopes[key] }
					: workspaceConfig[key] !== undefined
						? { key, workspaceValue: workspaceConfig[key] }
						: undefined,
			),
			update: vi.fn(),
		})),
		onDidChangeConfiguration: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: { uriScheme: "vscode", language: "en", appName: "Visual Studio Code", machineId: "test-machine-id" },
	ExtensionMode: { Production: 1, Development: 2, Test: 3 },
	version: "1.85.0",
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({ getModel: vi.fn().mockReturnValue({ id: "claude-3-sonnet" }) }),
}))

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockImplementation(async () => "mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => ({
	default: vi.fn().mockImplementation(() => ({ initializeFilePaths: vi.fn(), dispose: vi.fn() })),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("file content"),
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
	getModelsFromCache: vi.fn().mockReturnValue(undefined),
}))

vi.mock("../../../integrations/openai-codex/oauth", () => ({
	openAiCodexOAuthManager: {
		isAuthenticated: vi.fn().mockResolvedValue(false),
		getAuthenticationStatus: vi.fn().mockResolvedValue(false),
	},
}))

// Cloud facts, switchable per fixture: "signedOut" (a CloudService with no
// user), "signedIn" (every fact set) and "missing" (no CloudService at all:
// `hasInstance()` is false and `instance` throws like the real getter).
type CloudMode = "signedOut" | "signedIn" | "missing"
const cloud = vi.hoisted(() => ({ mode: "signedOut" as "signedOut" | "signedIn" | "missing" }))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockImplementation(() => cloud.mode !== "missing"),
		get instance() {
			if (cloud.mode === "missing") {
				throw new Error("CloudService not initialized")
			}
			const signedIn = cloud.mode === "signedIn"
			return {
				isCloudAgent: false,
				isAuthenticated: vi.fn().mockReturnValue(signedIn),
				getAllowList: vi
					.fn()
					.mockResolvedValue(
						signedIn ? { allowAll: false, providers: { openrouter: { allowAll: true } } } : "*",
					),
				getUserInfo: vi.fn().mockReturnValue(signedIn ? { name: "Ada", email: "ada@example.com" } : null),
				canShareTask: vi.fn().mockResolvedValue(signedIn),
				canSharePublicly: vi.fn().mockResolvedValue(signedIn),
				getOrganizationSettings: vi.fn().mockReturnValue(signedIn ? { version: 7 } : null),
				getOrganizationMemberships: vi
					.fn()
					.mockResolvedValue(
						signedIn ? [{ organization: { id: "org-1", name: "Org" }, role: "member" }] : [],
					),
				getUserSettings: vi.fn().mockReturnValue(null),
				isTaskSyncEnabled: vi.fn().mockReturnValue(signedIn),
				on: vi.fn(),
				off: vi.fn(),
				once: vi.fn(),
				emit: vi.fn(),
				removeAllListeners: vi.fn(),
			}
		},
	},
	getRooCodeApiUrl: vi.fn().mockReturnValue("http://localhost:8080"),
	getRooCodeProviderUrl: vi.fn().mockReturnValue("http://localhost:8080/proxy"),
}))

/** A value for every setting the builders read, each different from its default. */
const FULL_SETTINGS = {
	apiProvider: "openrouter",
	apiModelId: "model-under-test",
	openRouterModelId: "openrouter/model",
	lastShownAnnouncementId: "announcement-1",
	customInstructions: "Be terse.",
	alwaysAllowReadOnly: true,
	alwaysAllowReadOnlyOutsideWorkspace: true,
	alwaysAllowWrite: true,
	alwaysAllowWriteOutsideWorkspace: true,
	alwaysAllowWriteProtected: true,
	alwaysAllowExecute: true,
	alwaysAllowMcp: true,
	alwaysAllowModeSwitch: true,
	alwaysAllowSubtasks: true,
	alwaysApprovePlan: true,
	alwaysAllowFollowupQuestions: true,
	followupAutoApproveTimeoutMs: 12_000,
	diagnosticsEnabled: false,
	allowedMaxRequests: 42,
	allowedMaxCost: 3.5,
	autoCondenseContext: false,
	autoCondenseContextPercent: 75,
	autoCondenseContextApiConfigId: "cfg-condense",
	memoryWriterApiConfigId: "cfg-memory",
	webToolsEnabled: true,
	webSearchBackend: "searxng",
	searxngBaseUrl: "http://searx.local",
	webSearchMaxResults: 7,
	webFetchMaxBytes: 50_000,
	maxInlineToolResultBytes: 8192,
	pruneBeforeCondense: false,
	pruneToolResultBudget: 2048,
	allowedCommands: ["git status"],
	deniedCommands: ["rm -rf"],
	soundEnabled: true,
	customSoundCelebration: "celebration.mp3",
	customSoundCelebrationOriginal: "My Celebration.mp3",
	customSoundProgressLoop: "progress.mp3",
	customSoundProgressLoopOriginal: "My Progress.mp3",
	customSoundNotification: "notification.mp3",
	customSoundNotificationOriginal: "My Notification.mp3",
	enableCheckpoints: false,
	checkpointTimeout: 30,
	soundVolume: 0.8,
	writeDelayMs: 250,
	terminalShellIntegrationTimeout: 9000,
	terminalShellIntegrationDisabled: false,
	terminalCommandDelay: 10,
	terminalPowershellCounter: true,
	terminalZshClearEolMark: false,
	terminalZshOhMy: true,
	terminalZshP10k: true,
	terminalZdotdir: true,
	terminalProfile: "bash",
	mode: "architect",
	language: "pl",
	mcpEnabled: false,
	currentApiConfigName: "work",
	listApiConfigMeta: [{ id: "cfg-work", name: "work", apiProvider: "openrouter" }],
	pinnedApiConfigs: { "cfg-work": true },
	modeApiConfigs: { code: "cfg-work" },
	customModePrompts: { code: { roleDefinition: "Custom role" } },
	customSupportPrompts: { ENHANCE: "Enhance this" },
	enhancementApiConfigId: "cfg-enhance",
	experiments: { ...experimentDefault, preventFocusDisruption: true },
	autoApprovalEnabled: true,
	autoApprovalMode: "bypass",
	maxOpenTabsContext: 5,
	maxWorkspaceFiles: 50,
	disabledTools: ["codebase_search"],
	telemetrySetting: "disabled",
	showRooIgnoredFiles: true,
	enableSubfolderRules: true,
	maxImageFileSize: 7,
	maxTotalImageSize: 30,
	historyPreviewCollapsed: true,
	reasoningBlockCollapsed: false,
	enterBehavior: "newline",
	customCondensingPrompt: "Condense it.",
	codebaseIndexConfig: {
		codebaseIndexEnabled: true,
		codebaseIndexQdrantUrl: "http://qdrant.local:6333",
		codebaseIndexEmbedderProvider: "ollama",
		codebaseIndexEmbedderBaseUrl: "http://ollama.local:11434",
		codebaseIndexEmbedderModelId: "nomic-embed-text",
		codebaseIndexEmbedderModelDimension: 768,
		codebaseIndexOpenAiCompatibleBaseUrl: "http://compat.local/v1",
		codebaseIndexSearchMaxResults: 20,
		codebaseIndexSearchMinScore: 0.5,
		codebaseIndexBedrockRegion: "eu-west-1",
		codebaseIndexBedrockProfile: "profile",
		codebaseIndexOpenRouterSpecificProvider: "provider",
	},
	profileThresholds: { "cfg-work": 60 },
	includeDiagnosticMessages: false,
	maxDiagnosticMessages: 10,
	includeTaskHistoryInEnhance: false,
	includeCurrentTime: false,
	includeCurrentCost: false,
	maxGitStatusFiles: 12,
	parallelTasksMaxConcurrency: 5,
	subagentFollowupTimeoutSec: 60,
	imageGenerationProvider: "openrouter",
	openRouterImageApiKey: "sk-image",
	openRouterImageGenerationSelectedModel: "image-model",
} as unknown as RooCodeSettings

/**
 * Keys whose value in the webview state is deliberately different from
 * `getState()`. Each entry is a view-only transform, not a default.
 */
const VIEW_ONLY_TRANSFORMS: Record<string, string> = {
	taskHistory: "getState() never materializes the history (hot path); the full push carries it",
}

/** Replace large, fixture-independent constants with markers to keep the snapshots readable. */
const normalize = (state: Record<string, unknown>): Record<string, unknown> => {
	const out: Record<string, unknown> = { ...state }
	// The provider profile has one slot per provider field; only the set ones matter here.
	out.apiConfiguration = Object.fromEntries(
		Object.entries(out.apiConfiguration as Record<string, unknown>).filter(([, value]) => value !== undefined),
	)
	if (isDeepStrictEqual(out.experiments, experimentDefault)) out.experiments = "<experimentDefault>"
	if (isDeepStrictEqual(out.codebaseIndexModels, EMBEDDING_MODEL_PROFILES)) {
		out.codebaseIndexModels = "<EMBEDDING_MODEL_PROFILES>"
	}
	// Sort keys so the snapshot does not depend on the builder's key order.
	return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

describe("ClineProvider state builders (CORE-R1 characterization)", () => {
	let workspaceState: Record<string, unknown>
	let globalState: Record<string, unknown>
	let mockContext: vscode.ExtensionContext
	let mockOutputChannel: vscode.OutputChannel
	const providers: ClineProvider[] = []

	const flush = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

	const makeProvider = async (options: { cloudMode: CloudMode; settings?: RooCodeSettings }) => {
		cloud.mode = options.cloudMode
		const provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))
		providers.push(provider)
		await flush()
		;(provider as any).customModesManager = {
			getCustomModes: vi
				.fn()
				.mockResolvedValue(
					options.settings
						? [{ slug: "reviewer", name: "Reviewer", roleDefinition: "Review", groups: ["read"] }]
						: [],
				),
			dispose: vi.fn(),
		}
		if (options.settings) {
			await provider.contextProxy.setValues(options.settings)
			workspaceState.lockApiConfigAcrossModes = true
			workspaceConfig.allowedCommands = ["npm test", "git status"]
			workspaceConfig.deniedCommands = ["git push --force"]
			workspaceConfig.debug = true
		}
		return provider
	}

	const fixtures: Array<[string, { cloudMode: CloudMode; settings?: RooCodeSettings }]> = [
		["an empty ContextProxy", { cloudMode: "signedOut" }],
		["a fully populated ContextProxy", { cloudMode: "signedIn", settings: FULL_SETTINGS }],
		["a missing CloudService", { cloudMode: "missing" }],
	]

	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(console, "error").mockImplementation(() => {})
		delete process.env.POSTHOG_API_KEY
		for (const key of Object.keys(workspaceConfig)) delete workspaceConfig[key]
		for (const key of Object.keys(configScopes)) delete configScopes[key]

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		globalState = {}
		workspaceState = {}
		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi.fn().mockImplementation((key: string, value: unknown) => {
					globalState[key] = value
				}),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
				delete: vi.fn().mockImplementation((key: string) => delete secrets[key]),
			},
			workspaceState: {
				// Mirrors VS Code's Memento.get(key, defaultValue).
				get: vi.fn().mockImplementation((key: string, fallback?: unknown) => workspaceState[key] ?? fallback),
				update: vi.fn().mockImplementation((key: string, value: unknown) => {
					workspaceState[key] = value
				}),
				keys: vi.fn().mockImplementation(() => Object.keys(workspaceState)),
			},
			subscriptions: [],
			extension: { packageJSON: { version: "1.0.0" } },
			globalStorageUri: { fsPath: "/test/storage/path" },
		} as unknown as vscode.ExtensionContext

		mockOutputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel
	})

	afterEach(async () => {
		for (const provider of providers.splice(0)) {
			await provider.dispose()
		}
		TaskHistoryStore.resetSharedStoresForTests()
		cloud.mode = "signedOut"
	})

	describe.each(fixtures)("with %s", (_name, fixture) => {
		it("getState() matches the golden snapshot", async () => {
			const provider = await makeProvider(fixture)
			expect(normalize(await provider.getState())).toMatchSnapshot()
		})

		it("getStateToPostToWebview() matches the golden snapshot", async () => {
			const provider = await makeProvider(fixture)
			expect(normalize(await provider.getStateToPostToWebview())).toMatchSnapshot()
		})

		it("every key present in both views has the same value, except the view-only transforms", async () => {
			const provider = await makeProvider(fixture)
			const state = (await provider.getState()) as Record<string, unknown>
			const posted = (await provider.getStateToPostToWebview()) as unknown as Record<string, unknown>

			const mismatches = Object.keys(state)
				.filter((key) => key in posted && !(key in VIEW_ONLY_TRANSFORMS))
				.filter((key) => !isDeepStrictEqual(state[key], posted[key]))
				.map((key) => ({ key, getState: state[key], posted: posted[key] }))

			expect(mismatches).toEqual([])
		})
	})

	it("the posted state sends null, not undefined, for an unset custom sound (postMessage drops undefined)", async () => {
		const provider = await makeProvider({ cloudMode: "signedOut" })
		const posted = await provider.getStateToPostToWebview()
		for (const key of [
			"customSoundCelebration",
			"customSoundCelebrationOriginal",
			"customSoundProgressLoop",
			"customSoundProgressLoopOriginal",
			"customSoundNotification",
			"customSoundNotificationOriginal",
		] as const) {
			expect(posted[key]).toBeNull()
		}
	})

	it("the posted state omits the host-only keys that getState() carries", async () => {
		const provider = await makeProvider({ cloudMode: "signedIn", settings: FULL_SETTINGS })
		const posted = await provider.getStateToPostToWebview()
		for (const key of ["lastShownAnnouncementId", "apiModelId", "diagnosticsEnabled", "modeApiConfigs"]) {
			expect(posted).not.toHaveProperty(key)
		}
	})
	// Decision 18: "use current profile" and an empty memory folder are saved
	// as "", stored as "" and posted back as "", so the Settings view shows the
	// cleared value and the host readers fall back to their defaults.
	it("saving the cleared profile ids and memory directory as empty strings stores and posts them back", async () => {
		const provider = await makeProvider({ cloudMode: "signedOut" })
		await provider.contextProxy.setValues({
			autoCondenseContextApiConfigId: "cfg-condense",
			memoryWriterApiConfigId: "cfg-memory",
			autoMemoryDirectory: path.resolve("/srv/memories"),
		})

		await webviewMessageHandler(provider, {
			type: "updateSettings",
			updatedSettings: JSON.parse(
				JSON.stringify({
					autoCondenseContextApiConfigId: "",
					memoryWriterApiConfigId: "",
					autoMemoryDirectory: "",
				}),
			),
		} as any)

		expect(provider.contextProxy.getValue("autoCondenseContextApiConfigId")).toBe("")
		expect(provider.contextProxy.getValue("memoryWriterApiConfigId")).toBe("")
		expect(provider.contextProxy.getValue("autoMemoryDirectory")).toBe("")

		const posted = await provider.getStateToPostToWebview()
		expect(posted.autoCondenseContextApiConfigId).toBe("")
		expect(posted.memoryWriterApiConfigId).toBe("")
		expect(posted.autoMemoryDirectory).toBe("")
	})

	// Without them in the push, the Memory tab showed its defaults and Save
	// sent those defaults back (a turned-off memory came back on).
	it("the posted state carries the stored memory settings", async () => {
		const provider = await makeProvider({ cloudMode: "signedOut" })
		const memorySettings = {
			autoMemoryEnabled: false,
			autoMemoryDirectory: path.resolve("/srv/memories") + path.sep,
			autoMemoryShareWithClaudeCode: true,
			memoryRecallEnabled: false,
			autoDreamEnabled: false,
			autoDreamMinHours: 48,
			autoDreamMinSessions: 9,
		}
		await provider.contextProxy.setValues(memorySettings)

		const posted = await provider.getStateToPostToWebview()
		for (const [key, value] of Object.entries(memorySettings)) {
			expect(posted).toHaveProperty(key, value)
		}
	})

	// DEF-C41: the approval decision must use the command lists the UI shows.
	describe("command lists (DEF-C41)", () => {
		/** Sets a configuration value per scope; `get()` returns the most specific one, like VS Code. */
		const setConfigScopes = (key: "allowedCommands" | "deniedCommands", scopes: ConfigScopes) => {
			configScopes[key] = scopes
			workspaceConfig[key] = scopes.workspaceFolderValue ?? scopes.workspaceValue ?? scopes.globalValue
		}

		const makeExecuteProvider = async (allowedCommands: string[], deniedCommands: string[] = []) => {
			const provider = await makeProvider({ cloudMode: "signedOut" })
			await provider.contextProxy.setValues({
				autoApprovalEnabled: true,
				alwaysAllowExecute: true,
				allowedCommands,
				deniedCommands,
			})
			return provider
		}

		const decide = async (provider: ClineProvider, command: string) =>
			(await checkAutoApproval({ state: await provider.getState(), ask: "command", text: command })).decision

		it("denies a command denied only in the workspace settings although a global allowed prefix matches", async () => {
			const provider = await makeExecuteProvider(["git"])
			setConfigScopes("deniedCommands", { workspaceValue: ["git push"] })

			// The UI lists the command as denied ...
			const posted = await provider.getStateToPostToWebview()
			expect(posted.deniedCommands).toContain("git push")
			// ... so the approval decision must deny it too.
			expect(await decide(provider, "git push origin main")).toBe("deny")
			expect(await decide(provider, "git status")).toBe("approve")
		})

		it("denies a command denied in the user settings of VS Code only", async () => {
			const provider = await makeExecuteProvider(["npm"])
			setConfigScopes("deniedCommands", { globalValue: ["npm publish"] })

			expect(await decide(provider, "npm publish")).toBe("deny")
		})

		it("never auto-approves a command allowed only by the workspace settings, and the UI does not list it", async () => {
			// A cloned repository can ship .vscode/settings.json; it must not be
			// able to grant itself auto-execution.
			const provider = await makeExecuteProvider(["git status"])
			setConfigScopes("allowedCommands", { workspaceValue: ["curl"] })

			expect(await decide(provider, "curl https://example.com/x.sh")).toBe("ask")
			const posted = await provider.getStateToPostToWebview()
			expect(posted.allowedCommands).not.toContain("curl")
		})

		it("honours a command allowed in the user settings of VS Code", async () => {
			const provider = await makeExecuteProvider([])
			setConfigScopes("allowedCommands", { globalValue: ["pnpm test"] })

			expect(await decide(provider, "pnpm test")).toBe("approve")
			const posted = await provider.getStateToPostToWebview()
			expect(posted.allowedCommands).toContain("pnpm test")
		})

		it("the UI and the approval decision see the same lists", async () => {
			const provider = await makeExecuteProvider(["git", "ls"], ["rm"])
			setConfigScopes("allowedCommands", { globalValue: ["pnpm test"], workspaceValue: ["curl"] })
			setConfigScopes("deniedCommands", { globalValue: ["npm publish"], workspaceValue: ["git push"] })

			const state = await provider.getState()
			const posted = await provider.getStateToPostToWebview()
			expect(posted.allowedCommands).toEqual(state.allowedCommands)
			expect(posted.deniedCommands).toEqual(state.deniedCommands)
			expect(state.deniedCommands).toEqual(["rm", "npm publish", "git push"])
		})
	})

	// DEF-C42: an embedding dimension the user never entered must not be stored.
	it("saving the code-index settings back untouched does not store a dimension the user never entered", async () => {
		const provider = await makeProvider({ cloudMode: "signedOut" })
		// An Ollama model the profiles do not know: its dimension comes only from the setting.
		await provider.contextProxy.setValues({
			codebaseIndexConfig: {
				codebaseIndexEnabled: true,
				codebaseIndexQdrantUrl: "http://localhost:6333",
				codebaseIndexEmbedderProvider: "ollama",
				codebaseIndexEmbedderBaseUrl: "http://localhost:11434",
				codebaseIndexEmbedderModelId: "custom-embedder",
			},
		})

		// The popover shows what the webview state carries and sends every field back on save.
		const posted = await provider.getStateToPostToWebview()
		await webviewMessageHandler(provider, {
			type: "saveCodeIndexSettingsAtomic",
			codeIndexSettings: { ...posted.codebaseIndexConfig, codebaseIndexSearchMaxResults: 25 },
		} as any)

		const saved = (await provider.getState()).codebaseIndexConfig
		expect(saved?.codebaseIndexSearchMaxResults).toBe(25)
		expect(saved?.codebaseIndexEmbedderModelDimension).toBeUndefined()
		// The dimension field stays empty (its placeholder shows) instead of a made-up 1536.
		expect(posted.codebaseIndexConfig?.codebaseIndexEmbedderModelDimension).toBeUndefined()
	})
})
