// npx vitest run core/webview/__tests__/ClineProvider.modeProfileBinding.spec.ts
//
// Characterization matrix for the mode-to-profile binding (CORE-R6 c). The
// binding used to be resolved by three copies that drifted: the history
// restore in createTaskWithHistoryItem, handleModeSwitch and
// getApiConfigurationForMode (mode-scoped subagents). Each copy's result is
// pinned here separately, over: mode exists or not, history profile name set
// or not, lockApiConfigAcrossModes on or off, CLI per-mode settings present
// or not, and a bound profile that is empty, missing or unusable.

import * as vscode from "vscode"
import { TelemetryService } from "@roo-code/telemetry"
import { ClineProvider } from "../ClineProvider"
import type { CliModeProviderSettings, HistoryItem } from "@roo-code/types"

import { ContextProxy } from "../../config/ContextProxy"
import { getModeBySlug } from "../../../shared/modes"

vi.mock("vscode", () => ({
	ExtensionContext: vi.fn(),
	OutputChannel: vi.fn(),
	WebviewView: vi.fn(),
	Uri: {
		joinPath: vi.fn(),
		file: vi.fn(),
	},
	CodeActionKind: {
		QuickFix: { value: "quickfix" },
		RefactorRewrite: { value: "refactor.rewrite" },
	},
	commands: {
		executeCommand: vi.fn().mockResolvedValue(undefined),
	},
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({
			get: vi.fn().mockReturnValue([]),
			update: vi.fn(),
		}),
		onDidChangeConfiguration: vi.fn().mockImplementation(() => ({
			dispose: vi.fn(),
		})),
		onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
		onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
	},
	env: {
		uriScheme: "vscode",
		language: "en",
		appName: "Visual Studio Code",
	},
	ExtensionMode: {
		Production: 1,
		Development: 2,
		Test: 3,
	},
	version: "1.85.0",
}))

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation((options) => ({
		taskId: options.taskId || "test-task-id",
		saveClineMessages: vi.fn(),
		clineMessages: [],
		apiConversationHistory: [],
		overwriteClineMessages: vi.fn(),
		overwriteApiConversationHistory: vi.fn(),
		abortTask: vi.fn(),
		handleWebviewAskResponse: vi.fn(),
		getTaskNumber: vi.fn().mockReturnValue(0),
		setTaskNumber: vi.fn(),
		setParentTask: vi.fn(),
		setRootTask: vi.fn(),
		emit: vi.fn(),
		parentTask: options.parentTask,
		updateApiConfiguration: vi.fn(),
		setTaskApiConfigName: vi.fn(),
		_taskApiConfigName: options.historyItem?.apiConfigName,
		taskApiConfigName: options.historyItem?.apiConfigName,
	})),
}))

vi.mock("../../prompts/sections/custom-instructions")

vi.mock("../../../utils/safeWriteJson", () => {
	const write = vi.fn().mockResolvedValue(undefined)
	return {
		safeWriteJson: write,
		withLockedJsonTransaction: vi.fn(
			async <T>(
				_lockTarget: string,
				destination: string,
				body: (writeJson: (data: unknown) => Promise<void>) => Promise<T>,
			) => body((data) => write(destination, data)),
		),
	}
})

// The JSON transaction gateway is mocked above; keep proper-lockfile inert for
// unrelated safe-write call sites in these provider-wiring specs.
vi.mock("proper-lockfile", () => ({
	lock: vi.fn(async () => async () => {}),
	unlock: vi.fn(async () => {}),
	check: vi.fn(async () => false),
}))

vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({
		getModel: vi.fn().mockReturnValue({
			id: "claude-3-sonnet",
		}),
	}),
}))

vi.mock("../../../integrations/workspace/WorkspaceTracker", () => ({
	default: vi.fn().mockImplementation(() => ({
		initializeFilePaths: vi.fn(),
		dispose: vi.fn(),
	})),
}))

vi.mock("../../diff/strategies/multi-search-replace", () => ({
	MultiSearchReplaceDiffStrategy: vi.fn().mockImplementation(() => ({
		getName: () => "test-strategy",
		applyDiff: vi.fn(),
	})),
}))

vi.mock("@roo-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(true),
		get instance() {
			return {
				isAuthenticated: vi.fn().mockReturnValue(false),
			}
		},
	},
	getRooCodeApiUrl: vi.fn().mockReturnValue("http://localhost:8080"),
	getRooCodeProviderUrl: vi.fn().mockReturnValue("http://localhost:8080/proxy"),
}))

vi.mock("../../../shared/modes", () => {
	const mockModes = [
		{
			slug: "code",
			name: "Code Mode",
			roleDefinition: "You are a code assistant",
			groups: ["read", "edit"],
		},
		{
			slug: "architect",
			name: "Architect Mode",
			roleDefinition: "You are an architect",
			groups: ["read", "edit"],
		},
		{
			slug: "ask",
			name: "Ask Mode",
			roleDefinition: "You are an assistant",
			groups: ["read"],
		},
		{
			slug: "debug",
			name: "Debug Mode",
			roleDefinition: "You are a debugger",
			groups: ["read", "edit"],
		},
		{
			slug: "orchestrator",
			name: "Orchestrator Mode",
			roleDefinition: "You are an orchestrator",
			groups: [],
		},
	]

	return {
		modes: mockModes,
		getAllModes: vi.fn((customModes?: Array<{ slug: string }>) => {
			if (!customModes?.length) {
				return [...mockModes]
			}
			const allModes = [...mockModes]
			customModes.forEach((cm) => {
				const idx = allModes.findIndex((m) => m.slug === cm.slug)
				if (idx !== -1) {
					allModes[idx] = cm as (typeof mockModes)[number]
				} else {
					allModes.push(cm as (typeof mockModes)[number])
				}
			})
			return allModes
		}),
		getModeBySlug: vi.fn().mockReturnValue({
			slug: "code",
			name: "Code Mode",
			roleDefinition: "You are a code assistant",
			groups: ["read", "edit"],
		}),
		defaultModeSlug: "code",
	}
})

vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn().mockResolvedValue("mocked system prompt"),
	codeMode: "code",
}))

vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
}))

vi.mock("../../../integrations/misc/extract-text", () => ({
	extractTextFromFile: vi.fn().mockResolvedValue("Mock file content"),
}))

vi.mock("p-wait-for", () => ({
	default: vi.fn().mockImplementation(async () => Promise.resolve()),
}))

vi.mock("fs/promises", () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue(""),
	unlink: vi.fn().mockResolvedValue(undefined),
	rmdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		createInstance: vi.fn(),
		get instance() {
			return {
				trackEvent: vi.fn(),
				trackError: vi.fn(),
				setProvider: vi.fn(),
				captureModeSwitch: vi.fn(),
			}
		},
	},
}))

const CODE_MODE = {
	slug: "code",
	name: "Code Mode",
	roleDefinition: "You are a code assistant",
	groups: ["read", "edit"],
}

describe("ClineProvider - mode to profile binding (characterization)", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let workspaceState: Record<string, unknown>
	let globalState: Record<string, unknown>
	let architectId: string
	let defaultId: string
	const previousCliRuntime = process.env.ROO_CLI_RUNTIME

	const cliSettings: CliModeProviderSettings = {
		base: { apiProvider: "openai", openAiModelId: "cli-base-model" },
		modes: { architect: { apiProvider: "openai", openAiModelId: "cli-architect-model" } },
	}

	const manager = () => provider.providerSettingsManager
	const currentProfileName = () => provider.contextProxy.getValue("currentApiConfigName")
	const currentProvider = () => provider.contextProxy.getProviderSettings()

	const historyItem = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
		id: "history-task",
		number: 1,
		ts: 1,
		task: "resume me",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		mode: "architect",
		...overrides,
	})

	beforeEach(async () => {
		vi.clearAllMocks()
		delete process.env.ROO_CLI_RUNTIME
		vi.mocked(getModeBySlug).mockReturnValue(CODE_MODE as never)

		globalState = { mode: "code", currentApiConfigName: "default-profile" }
		workspaceState = {}
		const secrets: Record<string, string | undefined> = {}

		mockContext = {
			extensionPath: "/test/path",
			extensionUri: {} as vscode.Uri,
			globalState: {
				get: vi.fn().mockImplementation((key: string) => globalState[key]),
				update: vi.fn().mockImplementation((key: string, value: unknown) => {
					globalState[key] = value
					return Promise.resolve()
				}),
				keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
			},
			secrets: {
				get: vi.fn().mockImplementation((key: string) => secrets[key]),
				store: vi.fn().mockImplementation((key: string, value: string | undefined) => {
					secrets[key] = value
					return Promise.resolve()
				}),
				delete: vi.fn().mockImplementation((key: string) => {
					delete secrets[key]
					return Promise.resolve()
				}),
			},
			workspaceState: {
				get: vi.fn().mockImplementation((key: string, defaultValue?: unknown) => {
					return key in workspaceState ? workspaceState[key] : defaultValue
				}),
				update: vi.fn().mockImplementation((key: string, value: unknown) => {
					workspaceState[key] = value
					return Promise.resolve()
				}),
				keys: vi.fn().mockImplementation(() => Object.keys(workspaceState)),
			},
			subscriptions: [],
			extension: { packageJSON: { version: "1.0.0" } },
			globalStorageUri: { fsPath: "/test/storage/path" },
		} as unknown as vscode.ExtensionContext

		const outputChannel = {
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
		} as unknown as vscode.OutputChannel

		const webviewView = {
			webview: {
				postMessage: vi.fn(),
				html: "",
				options: {},
				onDidReceiveMessage: vi.fn(),
				asWebviewUri: vi.fn(),
				cspSource: "vscode-webview://test-csp-source",
			},
			visible: true,
			onDidDispose: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
			onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
		} as unknown as vscode.WebviewView

		provider = new ClineProvider(mockContext, outputChannel, "sidebar", new ContextProxy(mockContext))
		provider.getMcpHub = vi.fn().mockReturnValue({ getAllServers: vi.fn().mockReturnValue([]) })
		await provider.resolveWebviewView(webviewView)

		// Two usable profiles; the current one is "default-profile". Every mode
		// starts bound to the store's built-in "default" profile.
		defaultId = await manager().saveConfig("default-profile", {
			apiProvider: "anthropic",
			apiModelId: "claude-sonnet-4-5",
		})
		architectId = await manager().saveConfig("architect-profile", {
			apiProvider: "openai",
			openAiModelId: "architect-model",
		})
		await manager().setModeConfig("architect", architectId)
		await provider.contextProxy.setValue("currentApiConfigName", "default-profile")
		await provider.contextProxy.setProviderSettings({ apiProvider: "anthropic", apiModelId: "claude-sonnet-4-5" })
	})

	afterEach(() => {
		if (previousCliRuntime === undefined) {
			delete process.env.ROO_CLI_RUNTIME
		} else {
			process.env.ROO_CLI_RUNTIME = previousCliRuntime
		}
	})

	describe("handleModeSwitch", () => {
		it("activates the profile bound to the mode", async () => {
			await provider.handleModeSwitch("architect")

			expect(globalState.mode).toBe("architect")
			expect(currentProfileName()).toBe("architect-profile")
			expect(currentProvider()).toMatchObject({ apiProvider: "openai", openAiModelId: "architect-model" })
		})

		it("binds the current profile to a mode that has no binding yet", async () => {
			vi.spyOn(manager(), "getModeConfigId").mockResolvedValueOnce(undefined)
			const setModeConfig = vi.spyOn(manager(), "setModeConfig")

			await provider.handleModeSwitch("ask")

			expect(setModeConfig).toHaveBeenCalledWith("ask", defaultId)
			expect(currentProfileName()).toBe("default-profile")
		})

		it("keeps the current profile when the bound profile is empty (no apiProvider)", async () => {
			vi.spyOn(manager(), "getProfile").mockResolvedValueOnce({ id: architectId, name: "architect-profile" })
			const activate = vi.spyOn(provider, "activateProviderProfile")
			const setModeConfig = vi.spyOn(manager(), "setModeConfig")

			await provider.handleModeSwitch("architect")

			expect(activate).not.toHaveBeenCalled()
			expect(setModeConfig).not.toHaveBeenCalled()
			expect(currentProfileName()).toBe("default-profile")
		})

		it("keeps the current profile when the bound profile id no longer exists", async () => {
			await manager().setModeConfig("architect", "deleted-profile-id")
			const activate = vi.spyOn(provider, "activateProviderProfile")
			const setModeConfig = vi.spyOn(manager(), "setModeConfig")

			await provider.handleModeSwitch("architect")

			expect(activate).not.toHaveBeenCalled()
			expect(setModeConfig).not.toHaveBeenCalled()
			expect(currentProfileName()).toBe("default-profile")
		})

		it("refreshes listApiConfigMeta before resolving the binding", async () => {
			await provider.handleModeSwitch("architect")

			const names = (globalState.listApiConfigMeta as { name: string }[]).map(({ name }) => name)
			expect(names).toEqual(expect.arrayContaining(["default-profile", "architect-profile"]))
		})

		it("does not touch the profile store while lockApiConfigAcrossModes is on", async () => {
			workspaceState.lockApiConfigAcrossModes = true
			const getModeConfigId = vi.spyOn(manager(), "getModeConfigId")
			const setModeConfig = vi.spyOn(manager(), "setModeConfig")

			await provider.handleModeSwitch("architect")

			expect(globalState.mode).toBe("architect")
			expect(getModeConfigId).not.toHaveBeenCalled()
			expect(setModeConfig).not.toHaveBeenCalled()
			expect(currentProfileName()).toBe("default-profile")
		})

		it("applies CLI per-mode settings before the lock and the profile store", async () => {
			workspaceState.lockApiConfigAcrossModes = true
			provider.setCliModeProviderSettings(cliSettings)
			const getModeConfigId = vi.spyOn(manager(), "getModeConfigId")

			await provider.handleModeSwitch("architect")

			expect(currentProvider()).toMatchObject(cliSettings.modes.architect)
			expect(currentProfileName()).toBe("default-profile")
			expect(getModeConfigId).not.toHaveBeenCalled()
		})

		it("uses the profile store in the CLI runtime when the CLI sent no per-mode settings", async () => {
			process.env.ROO_CLI_RUNTIME = "1"

			await provider.handleModeSwitch("architect")

			expect(currentProfileName()).toBe("architect-profile")
		})

		it("propagates a failure to read the bound profile", async () => {
			vi.spyOn(manager(), "getProfile").mockRejectedValueOnce(new Error("disk gone"))

			await expect(provider.handleModeSwitch("architect")).rejects.toThrow("disk gone")
			expect(currentProfileName()).toBe("default-profile")
		})

		it("throws after the mode changed when the bound profile uses a retired provider", async () => {
			const retiredId = await manager().saveConfig("retired-profile", { apiProvider: "cerebras" as never })
			await manager().setModeConfig("architect", retiredId)

			await expect(provider.handleModeSwitch("architect")).rejects.toThrow(/unavailable/)
			expect(globalState.mode).toBe("architect")
			expect(currentProfileName()).toBe("default-profile")
		})
	})

	describe("getApiConfigurationForMode", () => {
		it("returns the profile bound to the mode", async () => {
			const activateProfile = vi.spyOn(manager(), "activateProfile")

			const resolved = await provider.getApiConfigurationForMode("architect")

			expect(resolved?.name).toBe("architect-profile")
			expect(resolved?.apiConfiguration).toMatchObject({
				apiProvider: "openai",
				openAiModelId: "architect-model",
			})
			expect(resolved?.apiConfiguration).not.toHaveProperty("name")
			// It resolves through the store's activateProfile (which also records
			// the store's own currentApiConfigName) but leaves the live profile alone.
			expect(activateProfile).toHaveBeenCalledWith({ id: architectId })
			expect(currentProfileName()).toBe("default-profile")
			expect(currentProvider().apiProvider).toBe("anthropic")
		})

		it("returns undefined for a mode without a binding and binds nothing", async () => {
			vi.spyOn(manager(), "getModeConfigId").mockResolvedValueOnce(undefined)
			const setModeConfig = vi.spyOn(manager(), "setModeConfig")

			expect(await provider.getApiConfigurationForMode("ask")).toBeUndefined()
			expect(setModeConfig).not.toHaveBeenCalled()
		})

		it("returns undefined for an empty bound profile", async () => {
			vi.spyOn(manager(), "getProfile").mockResolvedValueOnce({ id: architectId, name: "architect-profile" })

			expect(await provider.getApiConfigurationForMode("architect")).toBeUndefined()
		})

		it("returns undefined when the bound profile id no longer exists", async () => {
			await manager().setModeConfig("architect", "deleted-profile-id")

			expect(await provider.getApiConfigurationForMode("architect")).toBeUndefined()
		})

		it("returns undefined while lockApiConfigAcrossModes is on", async () => {
			workspaceState.lockApiConfigAcrossModes = true

			expect(await provider.getApiConfigurationForMode("architect")).toBeUndefined()
		})

		it("returns the CLI settings under the current profile name, even when locked", async () => {
			workspaceState.lockApiConfigAcrossModes = true
			provider.setCliModeProviderSettings(cliSettings)

			expect(await provider.getApiConfigurationForMode("architect")).toEqual({
				apiConfiguration: cliSettings.modes.architect,
				name: "default-profile",
			})
			expect(await provider.getApiConfigurationForMode("ask")).toEqual({
				apiConfiguration: cliSettings.base,
				name: "default-profile",
			})
		})

		it("swallows read failures and retired providers (undefined = use the current profile)", async () => {
			vi.spyOn(manager(), "getProfile").mockRejectedValueOnce(new Error("disk gone"))
			expect(await provider.getApiConfigurationForMode("architect")).toBeUndefined()

			const retiredId = await manager().saveConfig("retired-profile", { apiProvider: "cerebras" as never })
			await manager().setModeConfig("architect", retiredId)
			expect(await provider.getApiConfigurationForMode("architect")).toBeUndefined()
		})
	})

	describe("createTaskWithHistoryItem", () => {
		it("activates the profile bound to the saved mode when the item has no profile name", async () => {
			await provider.createTaskWithHistoryItem(historyItem())

			expect(globalState.mode).toBe("architect")
			expect(currentProfileName()).toBe("architect-profile")
			expect(currentProvider()).toMatchObject({ apiProvider: "openai", openAiModelId: "architect-model" })
		})

		it("falls back to the default mode (and its binding) when the saved mode no longer exists", async () => {
			vi.mocked(getModeBySlug).mockReturnValue(undefined)
			const item = historyItem({ mode: "deleted-mode" })

			await provider.createTaskWithHistoryItem(item)

			expect(item.mode).toBe("code")
			expect(globalState.mode).toBe("code")
			// "code" is still bound to the store's built-in "default" profile.
			expect(currentProfileName()).toBe("default")
		})

		it("restores the item's own profile instead of the mode binding, without rebinding the mode", async () => {
			const getModeConfigId = vi.spyOn(manager(), "getModeConfigId")
			const setModeConfig = vi.spyOn(manager(), "setModeConfig")

			await provider.createTaskWithHistoryItem(historyItem({ mode: "ask", apiConfigName: "architect-profile" }))

			expect(getModeConfigId).not.toHaveBeenCalled()
			expect(setModeConfig).not.toHaveBeenCalled()
			expect(currentProfileName()).toBe("architect-profile")
		})

		it("keeps the current profile when the saved mode has no binding (and binds nothing)", async () => {
			vi.spyOn(manager(), "getModeConfigId").mockResolvedValueOnce(undefined)
			const setModeConfig = vi.spyOn(manager(), "setModeConfig")

			await provider.createTaskWithHistoryItem(historyItem({ mode: "ask" }))

			expect(setModeConfig).not.toHaveBeenCalled()
			expect(currentProfileName()).toBe("default-profile")
		})

		it("keeps the current profile when the bound profile is empty", async () => {
			vi.spyOn(manager(), "getProfile").mockResolvedValueOnce({ id: architectId, name: "architect-profile" })

			await provider.createTaskWithHistoryItem(historyItem())

			expect(currentProfileName()).toBe("default-profile")
		})

		it("keeps the current profile when the bound profile id no longer exists", async () => {
			await manager().setModeConfig("architect", "deleted-profile-id")

			await provider.createTaskWithHistoryItem(historyItem())

			expect(currentProfileName()).toBe("default-profile")
		})

		it("ignores the mode binding while lockApiConfigAcrossModes is on", async () => {
			workspaceState.lockApiConfigAcrossModes = true
			const getModeConfigId = vi.spyOn(manager(), "getModeConfigId")

			await provider.createTaskWithHistoryItem(historyItem())

			expect(getModeConfigId).not.toHaveBeenCalled()
			expect(currentProfileName()).toBe("default-profile")
		})

		it("logs and continues when the bound profile cannot be read or activated", async () => {
			vi.spyOn(manager(), "getProfile").mockRejectedValueOnce(new Error("disk gone"))
			await expect(provider.createTaskWithHistoryItem(historyItem())).resolves.toBeDefined()
			expect(currentProfileName()).toBe("default-profile")

			const retiredId = await manager().saveConfig("retired-profile", { apiProvider: "cerebras" as never })
			await manager().setModeConfig("architect", retiredId)
			await expect(provider.createTaskWithHistoryItem(historyItem())).resolves.toBeDefined()
			expect(currentProfileName()).toBe("default-profile")
		})

		it("never touches the profile store in the CLI runtime without per-mode settings", async () => {
			process.env.ROO_CLI_RUNTIME = "1"
			const getModeConfigId = vi.spyOn(manager(), "getModeConfigId")

			await provider.createTaskWithHistoryItem(historyItem({ apiConfigName: "architect-profile" }))

			expect(getModeConfigId).not.toHaveBeenCalled()
			expect(currentProfileName()).toBe("default-profile")
			expect(currentProvider().apiProvider).toBe("anthropic")
		})

		it("applies the saved mode's CLI settings in the CLI runtime, even when locked", async () => {
			process.env.ROO_CLI_RUNTIME = "1"
			workspaceState.lockApiConfigAcrossModes = true
			provider.setCliModeProviderSettings(cliSettings)

			await provider.createTaskWithHistoryItem(historyItem())

			expect(currentProvider()).toMatchObject(cliSettings.modes.architect)
			expect(currentProfileName()).toBe("default-profile")
		})

		// Drift: the setter's contract says that while CLI per-mode settings are
		// set, resumed tasks take their provider settings from them "instead of
		// the profile store". handleModeSwitch and getApiConfigurationForMode
		// honour that; the history restore only skipped the store because the
		// CLI also sets ROO_CLI_RUNTIME, so it still activated (and persisted)
		// the mode's bound profile, or the item's own profile, whenever that
		// variable was missing.
		it("does not activate a stored profile while CLI per-mode settings are set", async () => {
			provider.setCliModeProviderSettings(cliSettings)
			const activate = vi.spyOn(provider, "activateProviderProfile")

			await provider.createTaskWithHistoryItem(historyItem())

			expect(activate).not.toHaveBeenCalled()
			expect(currentProfileName()).toBe("default-profile")
			expect(currentProvider()).toMatchObject(cliSettings.modes.architect)
		})

		it("does not restore the item's stored profile while CLI per-mode settings are set", async () => {
			provider.setCliModeProviderSettings(cliSettings)
			const activate = vi.spyOn(provider, "activateProviderProfile")

			await provider.createTaskWithHistoryItem(historyItem({ mode: "ask", apiConfigName: "architect-profile" }))

			expect(activate).not.toHaveBeenCalled()
			expect(currentProfileName()).toBe("default-profile")
			expect(currentProvider()).toMatchObject(cliSettings.base)
		})
	})
})
