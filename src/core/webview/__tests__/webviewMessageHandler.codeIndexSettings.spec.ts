// Characterization tests for the "saveCodeIndexSettingsAtomic" message
// (CORE-R3 moves it into its own module; these pin today's behavior first).
//
// Run: cd src && ./node_modules/.bin/vitest run core/webview/__tests__/webviewMessageHandler.codeIndexSettings.spec.ts

import type { WebviewMessage } from "@roo-code/types"

vi.mock("vscode", () => ({
	window: { showErrorMessage: vi.fn(), showInformationMessage: vi.fn() },
	workspace: { workspaceFolders: [{ uri: { fsPath: "/workspace" } }], getConfiguration: vi.fn() },
	Uri: { file: (p: string) => ({ fsPath: p }) },
}))

vi.mock("../../../i18n", () => ({
	t: (key: string) => key,
	changeLanguage: vi.fn(),
}))

vi.mock("../ClineProvider", () => ({ ClineProvider: class {} }))

import { webviewMessageHandler } from "../webviewMessageHandler"

type Manager = {
	isFeatureEnabled: boolean
	isFeatureConfigured: boolean
	isInitialized: boolean
	handleSettingsChange: ReturnType<typeof vi.fn>
	initialize: ReturnType<typeof vi.fn>
	getCurrentStatus: ReturnType<typeof vi.fn>
}

function createManager(overrides: Partial<Manager> = {}): Manager {
	return {
		isFeatureEnabled: true,
		isFeatureConfigured: true,
		isInitialized: false,
		handleSettingsChange: vi.fn().mockResolvedValue(undefined),
		initialize: vi.fn().mockResolvedValue(undefined),
		getCurrentStatus: vi.fn().mockReturnValue({ systemStatus: "Standby", message: "status" }),
		...overrides,
	}
}

function createProvider(manager: Manager | undefined, currentConfig: Record<string, unknown> | undefined) {
	const state: Record<string, unknown> = { codebaseIndexConfig: currentConfig }
	const provider = {
		contextProxy: {
			getValue: vi.fn((key: string) => state[key]),
			setValue: vi.fn(async (key: string, value: unknown) => {
				state[key] = value
			}),
			storeSecret: vi.fn().mockResolvedValue(undefined),
		},
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		getCurrentWorkspaceCodeIndexManager: vi.fn(() => manager),
		log: vi.fn(),
	}
	return { provider, state }
}

const settings = {
	codebaseIndexEnabled: true,
	codebaseIndexQdrantUrl: "http://qdrant:6333",
	codebaseIndexEmbedderProvider: "openai-compatible",
	codebaseIndexEmbedderBaseUrl: "http://embed",
	codebaseIndexEmbedderModelId: "nomic",
	codebaseIndexEmbedderModelDimension: 768,
	codebaseIndexOpenAiCompatibleBaseUrl: "http://compat",
	codebaseIndexBedrockRegion: "eu-west-1",
	codebaseIndexBedrockProfile: "default",
	codebaseIndexSearchMaxResults: 25,
	codebaseIndexSearchMinScore: 0.4,
	codebaseIndexOpenRouterSpecificProvider: "any",
	codeIndexOpenAiKey: "sk-openai",
	codebaseIndexOpenAiCompatibleApiKey: "sk-compat",
}

const send = (provider: unknown, codeIndexSettings: unknown) =>
	webviewMessageHandler(provider as any, { type: "saveCodeIndexSettingsAtomic", codeIndexSettings } as WebviewMessage)

describe("webviewMessageHandler: saveCodeIndexSettingsAtomic", () => {
	it("does nothing without codeIndexSettings", async () => {
		const { provider } = createProvider(createManager(), {})
		await send(provider, undefined)
		expect(provider.contextProxy.setValue).not.toHaveBeenCalled()
		expect(provider.postMessageToWebview).not.toHaveBeenCalled()
	})

	it("merges the settings into the stored config and stores only the secrets that were sent", async () => {
		const { provider, state } = createProvider(undefined, { unrelatedKey: "kept", codebaseIndexEnabled: false })
		await send(provider, settings)

		expect(state.codebaseIndexConfig).toEqual({
			unrelatedKey: "kept",
			codebaseIndexEnabled: true,
			codebaseIndexQdrantUrl: "http://qdrant:6333",
			codebaseIndexEmbedderProvider: "openai-compatible",
			codebaseIndexEmbedderBaseUrl: "http://embed",
			codebaseIndexEmbedderModelId: "nomic",
			codebaseIndexEmbedderModelDimension: 768,
			codebaseIndexOpenAiCompatibleBaseUrl: "http://compat",
			codebaseIndexBedrockRegion: "eu-west-1",
			codebaseIndexBedrockProfile: "default",
			codebaseIndexSearchMaxResults: 25,
			codebaseIndexSearchMinScore: 0.4,
			codebaseIndexOpenRouterSpecificProvider: "any",
		})
		expect(provider.contextProxy.storeSecret.mock.calls).toEqual([
			["codeIndexOpenAiKey", "sk-openai"],
			["codebaseIndexOpenAiCompatibleApiKey", "sk-compat"],
		])
	})

	it("stores every secret key when all are present, including empty strings", async () => {
		const { provider } = createProvider(undefined, {})
		await send(provider, {
			codeIndexOpenAiKey: "",
			codeIndexQdrantApiKey: "q",
			codebaseIndexOpenAiCompatibleApiKey: "c",
			codebaseIndexGeminiApiKey: "g",
			codebaseIndexMistralApiKey: "m",
			codebaseIndexVercelAiGatewayApiKey: "v",
			codebaseIndexOpenRouterApiKey: "o",
		})
		expect(provider.contextProxy.storeSecret.mock.calls.map(([key]) => key)).toEqual([
			"codeIndexOpenAiKey",
			"codeIndexQdrantApiKey",
			"codebaseIndexOpenAiCompatibleApiKey",
			"codebaseIndexGeminiApiKey",
			"codebaseIndexMistralApiKey",
			"codebaseIndexVercelAiGatewayApiKey",
			"codebaseIndexOpenRouterApiKey",
		])
	})

	it("reports success, then an error status when no workspace is open", async () => {
		const { provider } = createProvider(undefined, {})
		await send(provider, settings)

		expect(provider.postMessageToWebview.mock.calls[0][0]).toMatchObject({
			type: "codeIndexSettingsSaved",
			success: true,
		})
		expect(provider.postStateToWebview).toHaveBeenCalledTimes(1)
		expect(provider.postMessageToWebview.mock.calls[1][0]).toEqual({
			type: "indexingStatusUpdate",
			values: {
				systemStatus: "Error",
				message: "embeddings:orchestrator.indexingRequiresWorkspace",
				processedItems: 0,
				totalItems: 0,
				currentItemUnit: "items",
			},
		})
		expect(provider.log).toHaveBeenCalledWith("Cannot save code index settings: No workspace folder open")
	})

	it("applies the settings and initializes an enabled, configured, uninitialized manager", async () => {
		const manager = createManager()
		const { provider } = createProvider(manager, { codebaseIndexEmbedderProvider: "openai-compatible" })
		await send(provider, settings)

		expect(manager.handleSettingsChange).toHaveBeenCalledTimes(1)
		expect(manager.initialize).toHaveBeenCalledWith(provider.contextProxy)
		expect(provider.log).toHaveBeenCalledWith("Code index manager initialized after settings save")
		expect(provider.postMessageToWebview).toHaveBeenCalledTimes(1)
	})

	it("does not initialize a manager that is already initialized or not configured", async () => {
		const initialized = createManager({ isInitialized: true })
		await send(createProvider(initialized, {}).provider, settings)
		expect(initialized.initialize).not.toHaveBeenCalled()

		const unconfigured = createManager({ isFeatureConfigured: false })
		await send(createProvider(unconfigured, {}).provider, settings)
		expect(unconfigured.initialize).not.toHaveBeenCalled()
	})

	it("stops after a failed validation when the embedder provider changed", async () => {
		const manager = createManager({ handleSettingsChange: vi.fn().mockRejectedValue(new Error("bad key")) })
		const { provider } = createProvider(manager, { codebaseIndexEmbedderProvider: "openai" })
		await send(provider, settings)

		expect(provider.log).toHaveBeenCalledWith("Embedder validation failed after provider change: bad key")
		expect(provider.postMessageToWebview).toHaveBeenLastCalledWith({
			type: "indexingStatusUpdate",
			values: { systemStatus: "Standby", message: "status" },
		})
		expect(manager.initialize).not.toHaveBeenCalled()
	})

	it("logs a settings-change error and continues when the provider did not change", async () => {
		const manager = createManager({ handleSettingsChange: vi.fn().mockRejectedValue(new Error("hiccup")) })
		const { provider } = createProvider(manager, { codebaseIndexEmbedderProvider: "openai-compatible" })
		await send(provider, settings)

		expect(provider.log).toHaveBeenCalledWith("Settings change handling error: hiccup")
		expect(manager.initialize).toHaveBeenCalledTimes(1)
	})

	it("posts the manager status when initialization fails", async () => {
		const manager = createManager({ initialize: vi.fn().mockRejectedValue(new Error("qdrant down")) })
		const { provider } = createProvider(manager, { codebaseIndexEmbedderProvider: "openai-compatible" })
		await send(provider, settings)

		expect(provider.log).toHaveBeenCalledWith("Code index initialization failed: qdrant down")
		expect(provider.postMessageToWebview).toHaveBeenLastCalledWith({
			type: "indexingStatusUpdate",
			values: { systemStatus: "Standby", message: "status" },
		})
	})

	it("reports a failed save when persisting the config throws", async () => {
		const { provider } = createProvider(createManager(), {})
		provider.contextProxy.setValue.mockRejectedValueOnce(new Error("disk full"))
		await send(provider, settings)

		expect(provider.log).toHaveBeenCalledWith("Error saving code index settings: disk full")
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "codeIndexSettingsSaved",
			success: false,
			error: "disk full",
		})
		expect(provider.postStateToWebview).not.toHaveBeenCalled()
	})
})
