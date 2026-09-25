import {
	activeProviderIds,
	anthropicDefaultModelId,
	getModelIdKeyForProvider,
	getProviderDefaultModelId,
	getProviderModelId,
	internationalZAiDefaultModelId,
	isTypicalProvider,
	litellmDefaultModelId,
	mainlandZAiDefaultModelId,
	modelIdKeysByProvider,
	openRouterDefaultModelId,
	providerModelDefinitions,
	resolveCatalogModel,
	unknownModelPolicies,
	vscodeLlmDefaultModelId,
	type ModelInfo,
	type ProviderName,
	type ProviderSettings,
} from "../index.js"

// API-6: one definition per executable provider names its model-id field, its
// static model list, its default model and what it does with an unknown id.

const MODEL = "api6-model"

describe("providerModelDefinitions", () => {
	it("covers every active and hidden provider", () => {
		expect(Object.keys(providerModelDefinitions).sort()).toEqual([...activeProviderIds].sort())
	})

	it("keeps unknown ids everywhere; only providers that derive info from the id honor custom ids", () => {
		const honorCustom = Object.entries(providerModelDefinitions)
			.filter(([, definition]) => definition.unknownModelPolicy === "honor-custom")
			.map(([provider]) => provider)

		expect(honorCustom.sort()).toEqual(["anthropic", "bedrock", "gemini", "gemini-cli"])
		expect(unknownModelPolicies).toEqual(["keep-id", "honor-custom"])
	})

	it.each(Object.entries(providerModelDefinitions))("%s declares its model-id field and policy", (_, definition) => {
		expect(definition).toHaveProperty("modelIdField")
		expect(unknownModelPolicies).toContain(definition.unknownModelPolicy)

		if ("models" in definition) {
			expect(definition.models).toHaveProperty(definition.defaultModelId)
		}
	})

	it.each(Object.keys(providerModelDefinitions))("derives the model-id key of %s", (provider) => {
		const field = providerModelDefinitions[provider as keyof typeof providerModelDefinitions].modelIdField
		const expectedKey = field === "vsCodeLmModelSelector" || field === null ? undefined : field

		expect(getModelIdKeyForProvider(provider)).toBe(expectedKey)

		if (isTypicalProvider(provider)) {
			expect(modelIdKeysByProvider[provider]).toBe(field)
		}

		const settings =
			field === "vsCodeLmModelSelector"
				? { apiProvider: provider, vsCodeLmModelSelector: { id: MODEL } }
				: field
					? { apiProvider: provider, [field]: MODEL }
					: { apiProvider: provider, apiModelId: MODEL }

		expect(getProviderModelId(settings as ProviderSettings)).toBe(field === null ? undefined : MODEL)
	})
})

describe("getProviderDefaultModelId (values pinned before the table existed)", () => {
	const expected: Record<string, string> = {
		openrouter: openRouterDefaultModelId,
		litellm: litellmDefaultModelId,
		openai: "",
		ollama: "",
		lmstudio: "",
		"vscode-lm": vscodeLlmDefaultModelId,
		"fake-ai": anthropicDefaultModelId,
		"gemini-cli": anthropicDefaultModelId,
		zai: internationalZAiDefaultModelId,
	}

	it.each(activeProviderIds.map((provider) => [provider]))("%s", (provider) => {
		const definition = providerModelDefinitions[provider] as { defaultModelId?: string }
		const id = getProviderDefaultModelId(provider as ProviderName)

		expect(id).toBe(expected[provider] ?? definition.defaultModelId)
	})

	it("uses the mainland Z.ai default for China", () => {
		expect(getProviderDefaultModelId("zai", { isChina: true })).toBe(mainlandZAiDefaultModelId)
	})
})

describe("resolveCatalogModel", () => {
	const info = (contextWindow: number): ModelInfo => ({ contextWindow, supportsPromptCache: false })
	const models = { base: info(1), other: info(2) }
	const catalog = (unknownModelPolicy: (typeof unknownModelPolicies)[number]) => ({
		models,
		defaultModelId: "base",
		unknownModelPolicy,
	})

	it.each(unknownModelPolicies)("selects the default for an absent or empty id (%s)", (policy) => {
		expect(resolveCatalogModel(undefined, catalog(policy))).toEqual({ id: "base", info: models.base, known: true })
		expect(resolveCatalogModel("", catalog(policy))).toEqual({ id: "base", info: models.base, known: true })
	})

	it.each(unknownModelPolicies)("selects a listed id (%s)", (policy) => {
		expect(resolveCatalogModel("other", catalog(policy))).toEqual({ id: "other", info: models.other, known: true })
	})

	// Owner decision 5: an unknown id is kept with the default capabilities,
	// never replaced by the default model.
	const pricedDefault = { ...info(1), inputPrice: 1, outputPrice: 2, cacheReadsPrice: 3, cacheWritesPrice: 4 }
	const pricedCatalog = (unknownModelPolicy: (typeof unknownModelPolicies)[number]) => ({
		models: { base: pricedDefault },
		defaultModelId: "base",
		unknownModelPolicy,
	})

	it("keep-id sends an unknown id with the default model's info", () => {
		expect(resolveCatalogModel("new", pricedCatalog("keep-id"))).toEqual({
			id: "new",
			info: pricedDefault,
			known: false,
		})
	})

	it("honor-custom keeps an unknown id with the info the provider derives, else the default info", () => {
		const customModelInfo = (id: string) => (id.startsWith("new") ? info(9) : undefined)

		expect(resolveCatalogModel("new-1", pricedCatalog("honor-custom"), { customModelInfo })).toEqual({
			id: "new-1",
			info: info(9),
			known: false,
		})
		expect(resolveCatalogModel("odd", pricedCatalog("honor-custom"), { customModelInfo })).toEqual({
			id: "odd",
			info: pricedDefault,
			known: false,
		})
	})

	it("does not treat inherited object keys as listed models", () => {
		expect(resolveCatalogModel("constructor", catalog("keep-id"))).toMatchObject({
			id: "constructor",
			known: false,
		})
	})

	it("never substitutes the default model for an unknown id, for any provider", () => {
		for (const definition of Object.values(providerModelDefinitions)) {
			if ("models" in definition) {
				expect(resolveCatalogModel("api6-unknown", definition).id).toBe("api6-unknown")
			}
		}
	})
})
