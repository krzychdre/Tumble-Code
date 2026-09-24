import {
	getModelIdKeyForProvider,
	getProviderModelId,
	modelIdKeysByProvider,
	providerNames,
	retiredProviderNames,
	type ProviderSettings,
} from "../provider-settings.js"

// DEF-C15: the organization allow list (ProfileValidator), the settings
// validation (webview-ui validate.ts) and the model-id key map each resolved the
// model id on their own and drifted apart. These tests pin the shared
// resolution for every provider name, enumerated from the registry.

const MODEL = "some-model-id"

const providersWithoutModelIdField = new Set<string>([
	// Fake AI takes its model from the injected fake handler, not from settings.
	"fake-ai",
	// VS Code LM stores a selector object, resolved separately below.
	"vscode-lm",
])

describe("getProviderModelId", () => {
	it.each([...new Set(providerNames)].filter((provider) => !providersWithoutModelIdField.has(provider)))(
		"resolves the model id of %s through its model-id key",
		(provider) => {
			const key = getModelIdKeyForProvider(provider)

			expect(key).toBeDefined()
			expect(getProviderModelId({ apiProvider: provider, [key!]: MODEL } as ProviderSettings)).toBe(MODEL)
		},
	)

	it("resolves the VS Code LM model id from the selector", () => {
		expect(getModelIdKeyForProvider("vscode-lm")).toBeUndefined()
		expect(getProviderModelId({ apiProvider: "vscode-lm", vsCodeLmModelSelector: { id: MODEL } })).toBe(MODEL)
	})

	it("has no model id for fake-ai", () => {
		expect(getModelIdKeyForProvider("fake-ai")).toBeUndefined()
		expect(getProviderModelId({ apiProvider: "fake-ai", apiModelId: MODEL })).toBeUndefined()
	})

	it("stores the openai-native model in apiModelId, like the settings UI and the handler", () => {
		expect(modelIdKeysByProvider["openai-native"]).toBe("apiModelId")
		expect(getProviderModelId({ apiProvider: "openai-native", apiModelId: MODEL })).toBe(MODEL)
		expect(getProviderModelId({ apiProvider: "openai-native", openAiModelId: MODEL })).toBeUndefined()
	})

	it("stores the OpenAI Compatible model in openAiModelId", () => {
		expect(getModelIdKeyForProvider("openai")).toBe("openAiModelId")
		expect(getProviderModelId({ apiProvider: "openai", apiModelId: MODEL })).toBeUndefined()
	})

	it.each([...retiredProviderNames])("has no model id for the retired provider %s", (provider) => {
		expect(getModelIdKeyForProvider(provider)).toBeUndefined()
		expect(getProviderModelId({ apiProvider: provider, apiModelId: MODEL })).toBeUndefined()
	})

	it("has no model id without a provider", () => {
		expect(getProviderModelId({ apiModelId: MODEL })).toBeUndefined()
	})
})
