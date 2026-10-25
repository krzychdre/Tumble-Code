// cd src && ./node_modules/.bin/vitest run core/config/__tests__/ContextProxy.spec.ts

import * as path from "path"

import type * as vscode from "vscode"

import { GLOBAL_STATE_KEYS, SECRET_STATE_KEYS, TelemetryEventName } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { ContextProxy } from "../ContextProxy"
import { logger } from "../../../utils/logging"

/** VS Code's globalState and secrets, kept in maps; the proxy is tested against what lands there. */
function createContext(state: Record<string, unknown> = {}, secrets: Record<string, string> = {}) {
	const stateMap = new Map(Object.entries(state))
	const secretMap = new Map(Object.entries(secrets))
	const globalState = {
		get: vi.fn((key: string) => stateMap.get(key)),
		update: vi.fn(async (key: string, value: unknown) => {
			if (value === undefined) stateMap.delete(key)
			else stateMap.set(key, value)
		}),
	}
	const secretStorage = {
		get: vi.fn(async (key: string) => secretMap.get(key)),
		store: vi.fn(async (key: string, value: string) => void secretMap.set(key, value)),
		delete: vi.fn(async (key: string) => void secretMap.delete(key)),
	}
	const context = { globalState, secrets: secretStorage } as unknown as vscode.ExtensionContext
	return { context, stateMap, secretMap, globalState, secretStorage }
}

async function startProxy(state?: Record<string, unknown>, secrets?: Record<string, string>) {
	const storage = createContext(state, secrets)
	const proxy = new ContextProxy(storage.context)
	await proxy.initialize()
	return { proxy, ...storage }
}

describe("ContextProxy", () => {
	beforeAll(() => {
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("initialize", () => {
		it("loads every global state key and secret, and deletes the removed image generation key", async () => {
			const { proxy, globalState, secretStorage, secretMap } = await startProxy(
				{ apiModelId: "gpt-4", mode: "code" },
				{ openAiApiKey: "sk-1", openRouterImageApiKey: "sk-image" },
			)

			expect(proxy.isInitialized).toBe(true)
			expect(proxy.getValue("apiModelId")).toBe("gpt-4")
			expect(proxy.getValue("openAiApiKey")).toBe("sk-1")
			expect(globalState.get.mock.calls.map(([key]) => key)).toEqual(
				expect.arrayContaining([...GLOBAL_STATE_KEYS]),
			)
			expect(secretStorage.get.mock.calls.map(([key]) => key).sort()).toEqual([...SECRET_STATE_KEYS].sort())
			expect(secretMap.has("openRouterImageApiKey")).toBe(false)
		})

		it("logs a key it cannot read or delete and still loads the others", async () => {
			const storage = createContext({ apiModelId: "gpt-4" }, { openAiApiKey: "sk-1" })
			storage.globalState.get.mockImplementation((key: string) => {
				if (key === "mode") throw new Error("bad state")
				return storage.stateMap.get(key)
			})
			storage.secretStorage.get.mockImplementation(async (key: string) => {
				if (key === "apiKey") throw new Error("bad secret")
				return storage.secretMap.get(key)
			})
			storage.secretStorage.delete.mockRejectedValue(new Error("locked"))
			const loggerError = vi.spyOn(logger, "error").mockImplementation(() => {})
			const proxy = new ContextProxy(storage.context)

			await proxy.initialize()

			expect(proxy.getValue("apiModelId")).toBe("gpt-4")
			expect(proxy.getValue("openAiApiKey")).toBe("sk-1")
			expect(loggerError.mock.calls.map(([message]) => message)).toEqual([
				"Error loading global mode: bad state",
				"Error loading secret apiKey: bad secret",
				"Error deleting removed secret openRouterImageApiKey: locked",
			])
		})

		// ClineProvider clears them only after a successful migration; clearing
		// here would lose the history when that migration fails.
		it("leaves the legacy task history keys alone", async () => {
			const { stateMap } = await startProxy({ taskHistory: [{ id: "t" }], taskHistoryMigratedToFiles: false })

			expect(stateMap.get("taskHistory")).toEqual([{ id: "t" }])
			expect(stateMap.has("taskHistoryMigratedToFiles")).toBe(true)
		})

		// The live provider settings are read from global state at start-up, before any profile is.
		it.each([
			["moves openAiR1FormatEnabled to openAiPreserveReasoning", { openAiR1FormatEnabled: true }, true],
			[
				"keeps an openAiPreserveReasoning value already set",
				{ openAiR1FormatEnabled: true, openAiPreserveReasoning: false },
				false,
			],
		])("%s and drops the removed key", async (_label, state, expected) => {
			const { proxy, stateMap } = await startProxy({ apiProvider: "openai", ...state })

			expect(proxy.getProviderSettings().openAiPreserveReasoning).toBe(expected)
			expect(stateMap.get("openAiPreserveReasoning")).toBe(expected)
			expect(stateMap.has("openAiR1FormatEnabled")).toBe(false)
		})

		it("writes nothing when no removed key or secret is stored", async () => {
			const { globalState, secretStorage } = await startProxy({
				apiProvider: "openai",
				autoMemoryDirectory: "relative/dir",
				customCondensingPrompt: "legacy prompt",
			})

			expect(globalState.update).not.toHaveBeenCalled()
			expect(secretStorage.store).not.toHaveBeenCalled()
		})
	})

	describe("legacy task history", () => {
		it("reads the legacy array and reports whether it is there", async () => {
			const legacy = [{ id: "legacy-1" }]
			const { proxy: withHistory } = await startProxy({ taskHistory: legacy })
			const { proxy: without } = await startProxy({ taskHistory: "not an array" })
			const { proxy: none } = await startProxy()

			expect([withHistory.hasLegacyTaskHistory(), withHistory.getLegacyTaskHistory()]).toEqual([true, legacy])
			expect([without.hasLegacyTaskHistory(), without.getLegacyTaskHistory()]).toEqual([true, undefined])
			expect([none.hasLegacyTaskHistory(), none.getLegacyTaskHistory()]).toEqual([false, undefined])
		})

		it("clears both legacy keys, the second even when the first fails", async () => {
			const { proxy, globalState, stateMap } = await startProxy({
				taskHistory: [],
				taskHistoryMigratedToFiles: true,
			})
			globalState.update.mockRejectedValueOnce(new Error("cleanup failed"))
			const loggerError = vi.spyOn(logger, "error").mockImplementation(() => {})

			await expect(proxy.clearLegacyTaskHistoryKeys()).resolves.toBeUndefined()

			expect(stateMap.has("taskHistoryMigratedToFiles")).toBe(false)
			expect(loggerError).toHaveBeenCalledWith("Error clearing legacy taskHistory key: cleanup failed")
		})
	})

	describe("values", () => {
		it("caches global state, falls back to the default and writes through", async () => {
			const { proxy, stateMap, globalState } = await startProxy()

			expect(proxy.getGlobalState("apiProvider", "deepseek")).toBe("deepseek")
			await proxy.setValue("apiProvider", "anthropic")
			stateMap.set("apiProvider", "changed behind the proxy")

			expect(proxy.getGlobalState("apiProvider", "deepseek")).toBe("anthropic")
			expect(globalState.update).toHaveBeenCalledWith("apiProvider", "anthropic")
		})

		it.each([undefined, null])(
			"reads a pass-through key from storage each time, %s meaning the default",
			async (unset) => {
				const { proxy, stateMap } = await startProxy({ autoMemoryEnabled: unset })

				expect(proxy.getGlobalState("autoMemoryEnabled", true)).toBe(true)
				stateMap.set("autoMemoryEnabled", false)
				expect(proxy.getGlobalState("autoMemoryEnabled", true)).toBe(false)
				await proxy.updateGlobalState("autoMemoryEnabled", true)
				expect(stateMap.get("autoMemoryEnabled")).toBe(true)
			},
		)

		it("keeps secrets in secret storage, never in global state, and deletes a cleared one", async () => {
			const { proxy, secretMap, stateMap } = await startProxy()
			const vertexJson = JSON.stringify({ type: "service_account" })

			await proxy.setValues({ apiModelId: "gpt-4", openAiApiKey: "sk-1", vertexJsonCredentials: vertexJson })

			expect(secretMap.get("openAiApiKey")).toBe("sk-1")
			expect(secretMap.get("vertexJsonCredentials")).toBe(vertexJson)
			expect(stateMap.has("openAiApiKey")).toBe(false)
			expect(stateMap.get("apiModelId")).toBe("gpt-4")

			await proxy.setValue("openAiApiKey", undefined)
			expect(secretMap.has("openAiApiKey")).toBe(false)
			expect(proxy.getSecret("openAiApiKey")).toBeUndefined()
		})

		it("re-reads the secrets from storage on refresh and logs one it cannot read", async () => {
			const { proxy, secretMap, secretStorage } = await startProxy({}, { apiKey: "old" })
			secretMap.set("apiKey", "new")
			secretStorage.get.mockImplementation(async (key: string) => {
				if (key === "openAiApiKey") throw new Error("bad secret")
				return secretMap.get(key)
			})
			const loggerError = vi.spyOn(logger, "error").mockImplementation(() => {})

			await proxy.refreshSecrets()

			expect(proxy.getSecret("apiKey")).toBe("new")
			expect(loggerError).toHaveBeenCalledWith("Error refreshing secret openAiApiKey: bad secret")
		})

		// Decision 18: the Settings view clears the memory folder by saving "".
		it.each([
			["an empty string as it is", "", ""],
			[
				"an absolute path with one trailing separator",
				path.resolve("/memory"),
				path.resolve("/memory") + path.sep,
			],
			["a relative path as unset", "relative/dir", undefined],
		])("stores autoMemoryDirectory: %s", async (_label, value, expected) => {
			const { proxy, stateMap } = await startProxy()
			vi.spyOn(logger, "error").mockImplementation(() => {})

			await proxy.setValue("autoMemoryDirectory", value)

			expect(stateMap.get("autoMemoryDirectory")).toBe(expected)
		})
	})

	describe("onDidChangeValues", () => {
		// The sidebar and the editor tabs share one proxy and refresh their
		// webviews from this event when another panel writes a setting.
		it("fires after every write, once the cache holds the new value", async () => {
			const { proxy } = await startProxy()
			const seen: unknown[] = []
			proxy.onDidChangeValues(() => seen.push(proxy.getValue("alwaysAllowWrite")))

			await proxy.setValue("alwaysAllowWrite", true)
			await proxy.setValue("autoMemoryEnabled", false)
			await proxy.storeSecret("apiKey", "secret")
			await proxy.setValues({ alwaysAllowWrite: false })
			await proxy.resetAllState()

			expect(seen).toEqual([true, true, true, false, undefined])
		})

		it("stops after dispose, and a throwing listener does not block the others", async () => {
			const { proxy } = await startProxy()
			const disposed = vi.fn()
			const after = vi.fn()
			const loggerError = vi.spyOn(logger, "error").mockImplementation(() => {})
			proxy.onDidChangeValues(() => {
				throw new Error("listener failed")
			})
			proxy.onDidChangeValues(disposed).dispose()
			proxy.onDidChangeValues(after)

			await proxy.setValue("alwaysAllowWrite", true)

			expect(disposed).not.toHaveBeenCalled()
			expect(after).toHaveBeenCalledTimes(1)
			expect(loggerError).toHaveBeenCalledWith("ContextProxy change listener failed: listener failed")
		})
	})

	describe("provider settings", () => {
		it("replaces the previous provider's values, keeping an empty headers object", async () => {
			const { proxy } = await startProxy({
				apiModelId: "old-model",
				openAiBaseUrl: "https://old-url.com",
				modelTemperature: 0.7,
			})

			await proxy.setProviderSettings({
				apiProvider: "anthropic",
				apiModelId: "new-model",
				openAiHeaders: null as any,
			})

			expect(proxy.getProviderSettings()).toMatchObject({ apiProvider: "anthropic", apiModelId: "new-model" })
			expect(proxy.getValue("openAiHeaders")).toEqual({})
			expect(proxy.getValue("openAiBaseUrl")).toBeUndefined()
			expect(proxy.getValue("modelTemperature")).toBeUndefined()
		})

		it.each([
			["drops an unknown provider", { apiProvider: "invalid-removed-provider", apiModelId: "m" }, undefined],
			["keeps a retired provider", { apiProvider: "groq", apiModelId: "m" }, "groq"],
			["keeps an active provider", { apiProvider: "anthropic", apiModelId: "m" }, "anthropic"],
		])("%s and the other fields", async (_label, state, apiProvider) => {
			vi.spyOn(logger, "info").mockImplementation(() => {})
			const { proxy } = await startProxy(state)

			const settings = proxy.getProviderSettings()

			expect(settings.apiProvider).toBe(apiProvider)
			expect(settings.apiModelId).toBe("m")
		})

		it("returns the raw values and reports to telemetry when a value fails the schema", async () => {
			const capture = vi.spyOn(TelemetryService.instance, "capture")
			const { proxy } = await startProxy({ apiProvider: "anthropic", modelTemperature: "hot" })

			expect(proxy.getProviderSettings()).toMatchObject({ apiProvider: "anthropic", modelTemperature: "hot" })
			expect(capture).toHaveBeenCalledWith(TelemetryEventName.SCHEMA_VALIDATION_ERROR, {
				schemaName: "ProviderSettings",
				error: expect.anything(),
			})
		})
	})

	describe("global settings and export", () => {
		it("returns the raw values and reports to telemetry when a global setting fails the schema", async () => {
			const capture = vi.spyOn(TelemetryService.instance, "capture")
			const { proxy } = await startProxy({ mode: "code", autoApprovalEnabled: "yes" })

			expect(proxy.getGlobalSettings()).toMatchObject({ mode: "code", autoApprovalEnabled: "yes" })
			expect(capture).toHaveBeenCalledWith(TelemetryEventName.SCHEMA_VALIDATION_ERROR, {
				schemaName: "GlobalSettings",
				error: expect.anything(),
			})
		})

		it("exports the set global settings with the global custom modes only", async () => {
			const customMode = (slug: string, source: "global" | "project") => ({
				slug,
				name: slug,
				roleDefinition: "role",
				groups: ["read"],
				source,
			})
			const { proxy } = await startProxy(
				{
					mode: "code",
					currentApiConfigName: "default",
					listApiConfigMeta: [{ id: "x", name: "default" }],
					customModes: [customMode("g", "global"), customMode("p", "project")],
				},
				{ apiKey: "secret" },
			)

			expect(await proxy.export()).toEqual({ mode: "code", customModes: [customMode("g", "global")] })
			expect(proxy.getGlobalSettings().mode).toBe("code")
		})

		it("exports nothing and reports to telemetry when a global setting fails the schema", async () => {
			const capture = vi.spyOn(TelemetryService.instance, "capture")
			const { proxy } = await startProxy({ autoApprovalEnabled: "yes" })

			expect(await proxy.export()).toBeUndefined()
			expect(capture).toHaveBeenCalledWith(TelemetryEventName.SCHEMA_VALIDATION_ERROR, {
				schemaName: "GlobalSettings",
				error: expect.anything(),
			})
		})
	})

	it("resetAllState clears every key and secret and the caches", async () => {
		const { proxy, stateMap, secretMap } = await startProxy({ apiModelId: "gpt-4" }, { openAiApiKey: "sk-1" })

		await proxy.resetAllState()

		expect(proxy.getValue("apiModelId")).toBeUndefined()
		expect(proxy.getValue("openAiApiKey")).toBeUndefined()
		expect([...stateMap.keys()]).toEqual([])
		expect([...secretMap.keys()]).toEqual([])
	})

	it("has one shared instance, built and initialized on first use", async () => {
		;(ContextProxy as any)._instance = null
		expect(() => ContextProxy.instance).toThrow("ContextProxy not initialized")

		const { context } = createContext({ apiModelId: "gpt-4" })
		const first = await ContextProxy.getInstance(context)

		expect(first.isInitialized).toBe(true)
		expect(await ContextProxy.getInstance(createContext().context)).toBe(first)
		expect(ContextProxy.instance).toBe(first)
		;(ContextProxy as any)._instance = null
	})
})
