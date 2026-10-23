// npx vitest run core/webview/__tests__/ClineProvider.lockApiConfig.spec.ts

import * as vscode from "vscode"
import { TelemetryService } from "@tumble-code/telemetry"
import { ClineProvider } from "../ClineProvider"
import { createMockContext, createMockWebviewView, createTestProvider } from "./helpers/providerHarness"

vi.mock("../../task/Task", () => ({
	Task: vi.fn().mockImplementation(function (options) {
		return {
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
		}
	}),
}))

vi.mock("../../prompts/sections/custom-instructions")

vi.mock("@tumble-code/core/fs", () => {
	const write = vi.fn().mockResolvedValue(undefined)
	return {
		safeWriteJson: write,
		writeFileAtomic: vi.fn().mockResolvedValue(undefined),
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
	default: vi.fn().mockImplementation(function () {
		return {
			initializeFilePaths: vi.fn(),
			dispose: vi.fn(),
		}
	}),
}))

vi.mock("../../diff/strategies/multi-search-replace", () => ({
	MultiSearchReplaceDiffStrategy: vi.fn().mockImplementation(() => ({
		getName: () => "test-strategy",
		applyDiff: vi.fn(),
	})),
}))

vi.mock("@tumble-code/cloud", () => ({
	CloudService: {
		hasInstance: vi.fn().mockReturnValue(true),
		get instance() {
			return {
				isAuthenticated: vi.fn().mockReturnValue(false),
			}
		},
	},
	getTumbleCodeApiUrl: vi.fn().mockReturnValue("http://localhost:8080"),
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

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn().mockReturnValue(true),
		createInstance: vi.fn(),
		get instance() {
			return {
				trackEvent: vi.fn(),
				trackError: vi.fn(),
				setProvider: vi.fn(),
				capture: vi.fn(),
			}
		},
	},
}))

describe("ClineProvider - Lock API Config Across Modes", () => {
	let provider: ClineProvider
	let mockContext: vscode.ExtensionContext
	let mockWebviewView: vscode.WebviewView

	beforeEach(() => {
		vi.clearAllMocks()

		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}

		mockContext = createMockContext()
		mockWebviewView = createMockWebviewView()
		provider = createTestProvider(mockContext)
	})

	describe("handleModeSwitch honors lockApiConfigAcrossModes as a read-time override", () => {
		beforeEach(async () => {
			await provider.resolveWebviewView(mockWebviewView)
		})

		it("skips mode-specific config lookup/load when lockApiConfigAcrossModes is true", async () => {
			await mockContext.workspaceState.update("lockApiConfigAcrossModes", true)

			const getModeConfigIdSpy = vi
				.spyOn(provider.providerSettingsManager, "getModeConfigId")
				.mockResolvedValue("architect-profile-id")
			const listConfigSpy = vi
				.spyOn(provider.providerSettingsManager, "listConfig")
				.mockResolvedValue([
					{ name: "architect-profile", id: "architect-profile-id", apiProvider: "anthropic" },
				])
			const activateProviderProfileSpy = vi
				.spyOn(provider, "activateProviderProfile")
				.mockResolvedValue(undefined)

			await provider.handleModeSwitch("architect")

			expect(getModeConfigIdSpy).not.toHaveBeenCalled()
			expect(listConfigSpy).not.toHaveBeenCalled()
			expect(activateProviderProfileSpy).not.toHaveBeenCalled()
		})

		it("keeps normal mode-specific lookup/load behavior when lockApiConfigAcrossModes is false", async () => {
			await mockContext.workspaceState.update("lockApiConfigAcrossModes", false)

			const getModeConfigIdSpy = vi
				.spyOn(provider.providerSettingsManager, "getModeConfigId")
				.mockResolvedValue("architect-profile-id")
			vi.spyOn(provider.providerSettingsManager, "listConfig").mockResolvedValue([
				{ name: "architect-profile", id: "architect-profile-id", apiProvider: "anthropic" },
			])
			vi.spyOn(provider.providerSettingsManager, "getProfile").mockResolvedValue({
				name: "architect-profile",
				apiProvider: "anthropic",
			})

			const activateProviderProfileSpy = vi
				.spyOn(provider, "activateProviderProfile")
				.mockResolvedValue(undefined)

			await provider.handleModeSwitch("architect")

			expect(getModeConfigIdSpy).toHaveBeenCalledWith("architect")
			expect(activateProviderProfileSpy).toHaveBeenCalledWith({ name: "architect-profile" })
		})
	})
})
