// npx vitest run core/config/__tests__/CloudSecretValues.spec.ts

import type { ExtensionContext } from "vscode"

import { CloudSecretValues } from "../CloudSecretValues"
import type { ContextProxy } from "../ContextProxy"
import { ProviderSettingsManager } from "../ProviderSettingsManager"

function inMemorySecrets() {
	const store = new Map<string, string>()
	return {
		get: async (key: string) => store.get(key),
		store: async (key: string, value: string) => void store.set(key, value),
		delete: async (key: string) => void store.delete(key),
	}
}

describe("CloudSecretValues", () => {
	it("holds the keys and header values of the live settings and of every stored profile", async () => {
		const manager = new ProviderSettingsManager({ secrets: inMemorySecrets() } as unknown as ExtensionContext)
		await manager.saveConfig("active", { apiProvider: "anthropic", apiKey: "sk-TEST-LEAK-123" })
		await manager.saveConfig("other", {
			apiProvider: "openai",
			openAiApiKey: "free-form-key-7f3a9c",
			openAiHeaders: { "X-Custom-Auth": "header-secret-42" },
		})
		const contextProxy = {
			getValues: () => ({
				apiProvider: "anthropic",
				apiKey: "sk-TEST-LEAK-123",
				apiModelId: "claude-model-id",
				codeIndexQdrantApiKey: "qdrant-key-5521",
			}),
		} as unknown as ContextProxy
		const secrets = new CloudSecretValues(contextProxy, manager)

		await secrets.refresh()

		expect([...secrets.get()].sort()).toEqual(
			[
				"sk-TEST-LEAK-123",
				"qdrant-key-5521",
				"sk-TEST-LEAK-123",
				"free-form-key-7f3a9c",
				"header-secret-42",
			].sort(),
		)
	})

	it("keeps the values it has when the stored profiles cannot be read", async () => {
		const listProfileSettings = vi.fn().mockResolvedValueOnce([{ openAiApiKey: "free-form-key-7f3a9c" }])
		const secrets = new CloudSecretValues(
			{ getValues: () => ({}) } as unknown as ContextProxy,
			{ listProfileSettings } as unknown as ProviderSettingsManager,
		)
		await secrets.refresh()

		listProfileSettings.mockRejectedValueOnce(new Error("Failed to read provider profiles from secrets"))
		await secrets.refresh()

		expect(secrets.get()).toEqual(["free-form-key-7f3a9c"])
	})
})
