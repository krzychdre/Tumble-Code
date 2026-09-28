// npx vitest core/config/__tests__/ContextProxy.spec.ts

import * as vscode from "vscode"

import { GLOBAL_STATE_KEYS, SECRET_STATE_KEYS, GLOBAL_SECRET_KEYS } from "@roo-code/types"

import { ContextProxy } from "../ContextProxy"

vi.mock("vscode", () => ({
	Uri: {
		file: vi.fn((path) => ({ path })),
	},
	ExtensionMode: {
		Development: 1,
		Production: 2,
		Test: 3,
	},
}))

describe("ContextProxy", () => {
	let proxy: ContextProxy
	let mockContext: any
	let mockGlobalState: any
	let mockSecrets: any

	beforeEach(async () => {
		// Reset mocks
		vi.clearAllMocks()

		// Mock globalState
		mockGlobalState = {
			get: vi.fn(),
			update: vi.fn().mockResolvedValue(undefined),
		}

		// Mock secrets
		mockSecrets = {
			get: vi.fn().mockResolvedValue("test-secret"),
			store: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
		}

		// Mock the extension context
		mockContext = {
			globalState: mockGlobalState,
			secrets: mockSecrets,
			extensionUri: { path: "/test/extension" },
			extensionPath: "/test/extension",
			globalStorageUri: { path: "/test/storage" },
			logUri: { path: "/test/logs" },
			extension: { packageJSON: { version: "1.0.0" } },
			extensionMode: vscode.ExtensionMode.Development,
		}

		// Create proxy instance
		proxy = new ContextProxy(mockContext)
		await proxy.initialize()
	})

	describe("read-only pass-through properties", () => {
		it("should return extension properties from the original context", () => {
			expect(proxy.extensionUri).toBe(mockContext.extensionUri)
			expect(proxy.extensionPath).toBe(mockContext.extensionPath)
			expect(proxy.globalStorageUri).toBe(mockContext.globalStorageUri)
			expect(proxy.logUri).toBe(mockContext.logUri)
			expect(proxy.extension).toBe(mockContext.extension)
			expect(proxy.extensionMode).toBe(mockContext.extensionMode)
		})
	})

	describe("constructor / initialize", () => {
		it("does NOT clear legacy task history keys during initialize (migration owns cleanup)", () => {
			// initialize() must not touch the legacy keys — ClineProvider
			// clears them only after a successful migration. Unconditional
			// cleanup here would orphan data on a failed migration.
			expect(mockGlobalState.update).not.toHaveBeenCalledWith("taskHistory", undefined)
			expect(mockGlobalState.update).not.toHaveBeenCalledWith("taskHistoryMigratedToFiles", undefined)
		})

		it("clearLegacyTaskHistoryKeys clears both legacy keys best-effort", async () => {
			mockGlobalState.update.mockClear()
			await proxy.clearLegacyTaskHistoryKeys()
			expect(mockGlobalState.update).toHaveBeenCalledWith("taskHistory", undefined)
			expect(mockGlobalState.update).toHaveBeenCalledWith("taskHistoryMigratedToFiles", undefined)
		})

		it("clearLegacyTaskHistoryKeys continues when clearing one key fails", async () => {
			const update = vi
				.fn()
				.mockImplementation((key: string) =>
					key === "taskHistory" ? Promise.reject(new Error("cleanup failed")) : Promise.resolve(undefined),
				)
			const context = {
				...mockContext,
				globalState: { get: vi.fn(), update },
			}
			const newProxy = new ContextProxy(context)
			await newProxy.initialize()

			// Must not throw, and must still attempt the other key.
			await expect(newProxy.clearLegacyTaskHistoryKeys()).resolves.toBeUndefined()
			expect(update).toHaveBeenCalledWith("taskHistoryMigratedToFiles", undefined)
			expect(update).toHaveBeenCalledWith("taskHistory", undefined)
		})

		it("hasLegacyTaskHistory / getLegacyTaskHistory read the key lazily", () => {
			mockGlobalState.get.mockClear()
			// No legacy value present -> false, and no array materialized
			mockGlobalState.get.mockReturnValue(undefined)
			expect(proxy.hasLegacyTaskHistory()).toBe(false)
			expect(proxy.getLegacyTaskHistory()).toBeUndefined()

			// Legacy array present -> true, and the array is returned
			const legacy = [{ id: "legacy-1", ts: 1, task: "x" }]
			mockGlobalState.get.mockReturnValue(legacy)
			expect(proxy.hasLegacyTaskHistory()).toBe(true)
			expect(proxy.getLegacyTaskHistory()).toBe(legacy)
		})

		it("should initialize state cache with all global state keys", () => {
			expect(mockGlobalState.get).toHaveBeenCalledTimes(GLOBAL_STATE_KEYS.length)
			for (const key of GLOBAL_STATE_KEYS) {
				expect(mockGlobalState.get).toHaveBeenCalledWith(key)
			}
		})

		it("should initialize secret cache with all secret keys", () => {
			expect(mockSecrets.get).toHaveBeenCalledTimes(SECRET_STATE_KEYS.length + GLOBAL_SECRET_KEYS.length)
			for (const key of SECRET_STATE_KEYS) {
				expect(mockSecrets.get).toHaveBeenCalledWith(key)
			}
			for (const key of GLOBAL_SECRET_KEYS) {
				expect(mockSecrets.get).toHaveBeenCalledWith(key)
			}
		})
	})

	describe("getGlobalState", () => {
		it("should return value from cache when it exists", async () => {
			// Manually set a value in the cache
			await proxy.updateGlobalState("apiProvider", "deepseek")

			// Should return the cached value
			const result = proxy.getGlobalState("apiProvider")
			expect(result).toBe("deepseek")

			// Original context should be read only during initialization
			expect(mockGlobalState.get).toHaveBeenCalledTimes(GLOBAL_STATE_KEYS.length)
		})

		it("should handle default values correctly", async () => {
			// No value in cache
			const result = proxy.getGlobalState("apiProvider", "deepseek")
			expect(result).toBe("deepseek")
		})

		it("should bypass cache for pass-through state keys", async () => {
			// Setup mock return value
			mockGlobalState.get.mockReturnValue(false)

			const result = proxy.getGlobalState("autoMemoryEnabled")

			// Should get value directly from original context
			expect(result).toBe(false)
			expect(mockGlobalState.get).toHaveBeenCalledWith("autoMemoryEnabled")
		})

		it("should respect default values for pass-through state keys", async () => {
			// Setup mock to return undefined
			mockGlobalState.get.mockReturnValue(undefined)

			const result = proxy.getGlobalState("autoMemoryEnabled", false)

			// Should return default value when original context returns undefined
			expect(result).toBe(false)
		})
	})

	describe("updateGlobalState", () => {
		it("should update state directly in original context", async () => {
			await proxy.updateGlobalState("apiProvider", "deepseek")

			// Should have called original context
			expect(mockGlobalState.update).toHaveBeenCalledWith("apiProvider", "deepseek")

			// Should have stored the value in cache
			const storedValue = await proxy.getGlobalState("apiProvider")
			expect(storedValue).toBe("deepseek")
		})

		it("should bypass cache for pass-through state keys", async () => {
			await proxy.updateGlobalState("autoMemoryEnabled", false)

			// Should update original context
			expect(mockGlobalState.update).toHaveBeenCalledWith("autoMemoryEnabled", false)

			// Setup mock for subsequent get
			mockGlobalState.get.mockReturnValue(false)

			// Should get fresh value from original context
			const storedValue = proxy.getGlobalState("autoMemoryEnabled")
			expect(storedValue).toBe(false)
			expect(mockGlobalState.get).toHaveBeenCalledWith("autoMemoryEnabled")
		})
	})

	describe("getSecret", () => {
		it("should return value from cache when it exists", async () => {
			// Manually set a value in the cache
			await proxy.storeSecret("apiKey", "cached-secret")

			// Should return the cached value
			const result = proxy.getSecret("apiKey")
			expect(result).toBe("cached-secret")
		})
	})

	describe("storeSecret", () => {
		it("should store secret directly in original context", async () => {
			await proxy.storeSecret("apiKey", "new-secret")

			// Should have called original context
			expect(mockSecrets.store).toHaveBeenCalledWith("apiKey", "new-secret")

			// Should have stored the value in cache
			const storedValue = await proxy.getSecret("apiKey")
			expect(storedValue).toBe("new-secret")
		})

		it("should handle undefined value for secret deletion", async () => {
			await proxy.storeSecret("apiKey", undefined)

			// Should have called delete on original context
			expect(mockSecrets.delete).toHaveBeenCalledWith("apiKey")

			// Should have stored undefined in cache
			const storedValue = await proxy.getSecret("apiKey")
			expect(storedValue).toBeUndefined()
		})
	})

	describe("setValue", () => {
		it("should route secret keys to storeSecret", async () => {
			// Spy on storeSecret
			const storeSecretSpy = vi.spyOn(proxy, "storeSecret")

			// Test with a known secret key
			await proxy.setValue("openAiApiKey", "test-api-key")

			// Should have called storeSecret
			expect(storeSecretSpy).toHaveBeenCalledWith("openAiApiKey", "test-api-key")

			// Should have stored the value in secret cache
			const storedValue = proxy.getSecret("openAiApiKey")
			expect(storedValue).toBe("test-api-key")
		})

		it("should route global state keys to updateGlobalState", async () => {
			// Spy on updateGlobalState
			const updateGlobalStateSpy = vi.spyOn(proxy, "updateGlobalState")

			// Test with a known global state key
			await proxy.setValue("apiModelId", "gpt-4")

			// Should have called updateGlobalState
			expect(updateGlobalStateSpy).toHaveBeenCalledWith("apiModelId", "gpt-4")

			// Should have stored the value in state cache
			const storedValue = proxy.getGlobalState("apiModelId")
			expect(storedValue).toBe("gpt-4")
		})
	})

	// Decision 18: the Settings view clears the memory folder by saving "".
	describe("cleared memory directory", () => {
		it("stores an empty autoMemoryDirectory as an empty string", async () => {
			await proxy.setValue("autoMemoryDirectory", "")

			expect(proxy.getValue("autoMemoryDirectory")).toBe("")
			expect(mockGlobalState.update).toHaveBeenCalledWith("autoMemoryDirectory", "")
		})

		it("keeps a stored empty autoMemoryDirectory on initialize (it means the default folder)", async () => {
			vi.clearAllMocks()
			mockGlobalState.get.mockImplementation((key: string) => (key === "autoMemoryDirectory" ? "" : undefined))

			const reloaded = new ContextProxy(mockContext)
			await reloaded.initialize()

			expect(mockGlobalState.update).not.toHaveBeenCalledWith("autoMemoryDirectory", undefined)
			expect(reloaded.getValue("autoMemoryDirectory")).toBe("")
		})

		it("writes nothing for an invalid stored autoMemoryDirectory on initialize (memory paths ignore it)", async () => {
			vi.clearAllMocks()
			mockGlobalState.get.mockImplementation((key: string) =>
				key === "autoMemoryDirectory" ? "relative/dir" : undefined,
			)

			const reloaded = new ContextProxy(mockContext)
			await reloaded.initialize()

			expect(mockGlobalState.update).not.toHaveBeenCalled()
		})
	})

	describe("setValues", () => {
		it("should process multiple values correctly", async () => {
			// Spy on setValue
			const setValueSpy = vi.spyOn(proxy, "setValue")

			// Test with multiple values
			await proxy.setValues({
				apiModelId: "gpt-4",
				apiProvider: "openai",
				mode: "test-mode",
			})

			// Should have called setValue for each key
			expect(setValueSpy).toHaveBeenCalledTimes(3)
			expect(setValueSpy).toHaveBeenCalledWith("apiModelId", "gpt-4")
			expect(setValueSpy).toHaveBeenCalledWith("apiProvider", "openai")
			expect(setValueSpy).toHaveBeenCalledWith("mode", "test-mode")

			// Should have stored all values in state cache
			expect(proxy.getGlobalState("apiModelId")).toBe("gpt-4")
			expect(proxy.getGlobalState("apiProvider")).toBe("openai")
			expect(proxy.getGlobalState("mode")).toBe("test-mode")
		})

		it("should handle both secret and global state keys", async () => {
			// Spy on storeSecret and updateGlobalState
			const storeSecretSpy = vi.spyOn(proxy, "storeSecret")
			const updateGlobalStateSpy = vi.spyOn(proxy, "updateGlobalState")

			// Test with mixed keys
			await proxy.setValues({
				apiModelId: "gpt-4", // global state
				openAiApiKey: "test-api-key", // secret
			})

			// Should have called appropriate methods
			expect(storeSecretSpy).toHaveBeenCalledWith("openAiApiKey", "test-api-key")
			expect(updateGlobalStateSpy).toHaveBeenCalledWith("apiModelId", "gpt-4")

			// Should have stored values in appropriate caches
			expect(proxy.getSecret("openAiApiKey")).toBe("test-api-key")
			expect(proxy.getGlobalState("apiModelId")).toBe("gpt-4")
		})
	})

	describe("setProviderSettings", () => {
		it("should clear old API configuration values and set new ones", async () => {
			// Set up initial API configuration values
			await proxy.updateGlobalState("apiModelId", "old-model")
			await proxy.updateGlobalState("openAiBaseUrl", "https://old-url.com")
			await proxy.updateGlobalState("modelTemperature", 0.7)

			// Spy on setValues
			const setValuesSpy = vi.spyOn(proxy, "setValues")

			// Call setProviderSettings with new configuration
			await proxy.setProviderSettings({
				apiModelId: "new-model",
				apiProvider: "anthropic",
				// Note: openAiBaseUrl is not included in the new config
			})

			// Verify setValues was called with the correct parameters
			// It should include undefined for openAiBaseUrl (to clear it)
			// and the new values for apiModelId and apiProvider
			expect(setValuesSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					apiModelId: "new-model",
					apiProvider: "anthropic",
					openAiBaseUrl: undefined,
					modelTemperature: undefined,
				}),
			)

			// Verify the state cache has been updated correctly
			expect(proxy.getGlobalState("apiModelId")).toBe("new-model")
			expect(proxy.getGlobalState("apiProvider")).toBe("anthropic")
			expect(proxy.getGlobalState("openAiBaseUrl")).toBeUndefined()
			expect(proxy.getGlobalState("modelTemperature")).toBeUndefined()
		})

		it("should handle empty API configuration", async () => {
			// Set up initial API configuration values
			await proxy.updateGlobalState("apiModelId", "old-model")
			await proxy.updateGlobalState("openAiBaseUrl", "https://old-url.com")

			// Spy on setValues
			const setValuesSpy = vi.spyOn(proxy, "setValues")

			// Call setProviderSettings with empty configuration
			await proxy.setProviderSettings({})

			// Verify setValues was called with undefined for all existing API config keys
			expect(setValuesSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					apiModelId: undefined,
					openAiBaseUrl: undefined,
				}),
			)

			// Verify the state cache has been cleared
			expect(proxy.getGlobalState("apiModelId")).toBeUndefined()
			expect(proxy.getGlobalState("openAiBaseUrl")).toBeUndefined()
		})
	})

	describe("vertex JSON credentials", () => {
		const VERTEX_JSON = JSON.stringify({ type: "service_account", client_email: "sa@p.iam.gserviceaccount.com" })

		it("stores vertexJsonCredentials in secret storage, not in global state", async () => {
			mockGlobalState.update.mockClear()
			await proxy.setProviderSettings({ apiProvider: "vertex", vertexJsonCredentials: VERTEX_JSON })

			expect(mockSecrets.store).toHaveBeenCalledWith("vertexJsonCredentials", VERTEX_JSON)
			expect(mockGlobalState.update).not.toHaveBeenCalledWith("vertexJsonCredentials", VERTEX_JSON)
		})
	})

	describe("resetAllState", () => {
		it("should clear all in-memory caches", async () => {
			// Setup initial state in caches
			await proxy.setValues({
				apiModelId: "gpt-4", // global state
				openAiApiKey: "test-api-key", // secret
			})

			// Verify initial state
			expect(proxy.getGlobalState("apiModelId")).toBe("gpt-4")
			expect(proxy.getSecret("openAiApiKey")).toBe("test-api-key")

			// Reset all state
			await proxy.resetAllState()

			// Caches should be reinitialized with values from the context
			// Since our mock globalState.get returns undefined by default,
			// the cache should now contain undefined values
			expect(proxy.getGlobalState("apiModelId")).toBeUndefined()
		})

		it("should update all global state keys to undefined", async () => {
			// Setup initial state
			await proxy.updateGlobalState("apiModelId", "gpt-4")
			await proxy.updateGlobalState("apiProvider", "openai")

			// Reset all state
			await proxy.resetAllState()

			// Should have called update with undefined for each key
			for (const key of GLOBAL_STATE_KEYS) {
				expect(mockGlobalState.update).toHaveBeenCalledWith(key, undefined)
			}

			// 2 initial setup writes (apiModelId, apiProvider) plus one clear per
			// key; initialize() itself writes nothing.
			expect(mockGlobalState.update).toHaveBeenCalledTimes(2 + GLOBAL_STATE_KEYS.length)
		})

		it("should delete all secrets", async () => {
			// Setup initial secrets
			await proxy.storeSecret("apiKey", "test-api-key")
			await proxy.storeSecret("openAiApiKey", "test-openai-key")

			// Reset all state
			await proxy.resetAllState()

			// Should have called delete for each key
			for (const key of SECRET_STATE_KEYS) {
				expect(mockSecrets.delete).toHaveBeenCalledWith(key)
			}
			for (const key of GLOBAL_SECRET_KEYS) {
				expect(mockSecrets.delete).toHaveBeenCalledWith(key)
			}

			// Total calls should equal the number of secret keys
			expect(mockSecrets.delete).toHaveBeenCalledTimes(SECRET_STATE_KEYS.length + GLOBAL_SECRET_KEYS.length)
		})

		it("should reinitialize caches after reset", async () => {
			// Spy on initialization methods
			const initializeSpy = vi.spyOn(proxy, "initialize")

			// Reset all state
			await proxy.resetAllState()

			// Should reinitialize caches
			expect(initializeSpy).toHaveBeenCalledTimes(1)
		})
	})

	describe("getProviderSettings", () => {
		it("should sanitize invalid apiProvider before parsing", async () => {
			// Reset and create a new proxy with an unknown provider in state
			vi.clearAllMocks()
			mockGlobalState.get.mockImplementation((key: string) => {
				if (key === "apiProvider") {
					return "invalid-removed-provider"
				}
				if (key === "apiModelId") {
					return "some-model"
				}
				return undefined
			})

			const proxyWithInvalidProvider = new ContextProxy(mockContext)
			await proxyWithInvalidProvider.initialize()

			const settings = proxyWithInvalidProvider.getProviderSettings()

			// The invalid apiProvider should be sanitized (removed)
			expect(settings.apiProvider).toBeUndefined()
			// Other settings should still be present
			expect(settings.apiModelId).toBe("some-model")
		})

		it("should preserve retired apiProvider and provider fields", async () => {
			await proxy.setValues({
				apiProvider: "groq",
				apiModelId: "llama3-70b",
				openAiBaseUrl: "https://api.retired-provider.example/v1",
				apiKey: "retired-provider-key",
			})

			const settings = proxy.getProviderSettings()

			expect(settings.apiProvider).toBe("groq")
			expect(settings.apiModelId).toBe("llama3-70b")
			expect(settings.openAiBaseUrl).toBe("https://api.retired-provider.example/v1")
			expect(settings.apiKey).toBe("retired-provider-key")
		})

		it("should pass through valid apiProvider", async () => {
			// Set a valid provider in state
			await proxy.updateGlobalState("apiProvider", "anthropic")
			await proxy.updateGlobalState("apiModelId", "claude-3-opus-20240229")

			const settings = proxy.getProviderSettings()

			// Valid provider should be returned
			expect(settings.apiProvider).toBe("anthropic")
			expect(settings.apiModelId).toBe("claude-3-opus-20240229")
		})

		it("should handle undefined apiProvider gracefully", async () => {
			// Ensure no provider is set
			await proxy.updateGlobalState("apiProvider", undefined)

			const settings = proxy.getProviderSettings()

			// Should not throw and should return undefined
			expect(settings.apiProvider).toBeUndefined()
		})
	})

	describe("retired one-time migrations", () => {
		// The old start-up migrations for the nested image-generation settings and the two condensing prompt
		// migrations were deleted (ai_plans/2026-09-28_delete-old-config-migrations.md). Their legacy keys are
		// neither read nor rewritten any more.
		it("does not touch customCondensingPrompt, customSupportPrompts or openRouterImageGenerationSettings", async () => {
			vi.clearAllMocks()
			const storedPrompts = { CONDENSE: "1. Previous Conversation:\n2. Current Work:" }
			mockGlobalState.get.mockImplementation((key: string) => {
				if (key === "customSupportPrompts") return storedPrompts
				if (key === "customCondensingPrompt") return "legacy prompt"
				if (key === "openRouterImageGenerationSettings") return { openRouterApiKey: "k", selectedModel: "m" }
				return undefined
			})

			await new ContextProxy(mockContext).initialize()

			const touchedKeys = mockGlobalState.update.mock.calls.map((call: any[]) => call[0])
			expect(touchedKeys).not.toContain("customSupportPrompts")
			expect(touchedKeys).not.toContain("customCondensingPrompt")
			expect(touchedKeys).not.toContain("openRouterImageGenerationSettings")
			expect(mockGlobalState.get).not.toHaveBeenCalledWith("openRouterImageGenerationSettings")
		})
	})
})
