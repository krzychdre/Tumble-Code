// DEF-C15: every runtime provider must resolve its model id through the
// organization allow list (ProfileValidator), and the model-id key that the
// shared map assigns to a provider must be the settings field its handler
// actually reads. The provider list comes from the runtime registry, so a new
// provider is covered without editing this file.

import * as types from "@roo-code/types"
import type { OrganizationAllowList, ProviderName, ProviderSettings } from "@roo-code/types"

import { ProfileValidator } from "../../shared/ProfileValidator"
import { runtimeProviderRegistry, type RuntimeProviderId } from "../runtime-provider-registry"

const SENTINEL_MODEL_ID = "c15-sentinel-model"

// Router providers (LiteLLM) only honor ids present in the model cache, which is
// empty in tests. Serve the sentinel from the cache so they can round-trip it.
vi.mock("../providers/fetchers/modelCache", async (importOriginal) => {
	const original = await importOriginal<typeof import("../providers/fetchers/modelCache")>()

	return {
		...original,
		getModelsFromCache: () => ({
			"c15-sentinel-model": { contextWindow: 128_000, maxTokens: 8_192, supportsPromptCache: false },
		}),
	}
})

const runtimeProviders = Object.keys(runtimeProviderRegistry) as RuntimeProviderId[]

// Providers whose model is not a plain settings field.
const providersWithoutModelIdField: Partial<Record<RuntimeProviderId, string>> = {
	"fake-ai": "the fake handler object supplies its own model",
	"vscode-lm": "the model comes from the VS Code LM client picked by vsCodeLmModelSelector",
}

// Credentials some constructors insist on; unrelated to model resolution.
const constructorOptions: Partial<ProviderSettings> = {
	mistralApiKey: "test-key",
}

// Handlers that silently substitute their default for unknown ids need a real
// id from their catalog. Collect every catalog id exported by @roo-code/types.
const catalogModelIds: string[] = [
	SENTINEL_MODEL_ID,
	...new Set(
		Object.entries(types)
			.filter(([name, value]) => name.endsWith("Models") && value !== null && typeof value === "object")
			.flatMap(([, value]) =>
				Object.entries(value as Record<string, unknown>)
					.filter(([, info]) => typeof (info as { contextWindow?: unknown })?.contextWindow === "number")
					.map(([id]) => id),
			),
	),
]

const resolvedModelId = (provider: RuntimeProviderId, settings: ProviderSettings): string | undefined => {
	try {
		return runtimeProviderRegistry[provider]({ ...constructorOptions, ...settings }).getModel().id
	} catch {
		return undefined
	}
}

const allowListFor = (provider: ProviderName, models: string[]): OrganizationAllowList => ({
	allowAll: false,
	providers: { [provider]: { allowAll: false, models } },
})

describe("DEF-C15: model-id key per runtime provider", () => {
	const modelIdProviders = runtimeProviders.filter((provider) => !(provider in providersWithoutModelIdField))

	it.each(modelIdProviders)("maps %s to the settings field its handler reads", (provider) => {
		const key = types.getModelIdKeyForProvider(provider)
		expect(key).toBeDefined()

		const otherKeys = types.modelIdKeys.filter((candidate) => candidate !== key)

		// A catalog id that the handler returns when it sits in the mapped key,
		// and does not return when every other model-id field holds it instead.
		const honoredModelId = catalogModelIds.find(
			(modelId) =>
				resolvedModelId(provider, { [key!]: modelId }) === modelId &&
				resolvedModelId(provider, Object.fromEntries(otherKeys.map((other) => [other, modelId]))) !== modelId,
		)

		expect(honoredModelId, `${provider} handler does not read ${key}`).toBeDefined()
	})

	it.each(modelIdProviders)("lets the organization allow list resolve the %s model id", (provider) => {
		const key = types.getModelIdKeyForProvider(provider)!
		const profile = { apiProvider: provider, [key]: SENTINEL_MODEL_ID } as ProviderSettings

		expect(ProfileValidator.isProfileAllowed(profile, allowListFor(provider, [SENTINEL_MODEL_ID]))).toBe(true)
		expect(ProfileValidator.isProfileAllowed(profile, allowListFor(provider, ["another-model"]))).toBe(false)
	})

	it("resolves the VS Code LM model through its selector", () => {
		const profile: ProviderSettings = { apiProvider: "vscode-lm", vsCodeLmModelSelector: { id: SENTINEL_MODEL_ID } }

		expect(ProfileValidator.isProfileAllowed(profile, allowListFor("vscode-lm", [SENTINEL_MODEL_ID]))).toBe(true)
		expect(ProfileValidator.isProfileAllowed(profile, allowListFor("vscode-lm", ["another-model"]))).toBe(false)
	})

	it("leaves fake-ai to the provider-wide allowAll flag", () => {
		const profile: ProviderSettings = { apiProvider: "fake-ai", apiModelId: SENTINEL_MODEL_ID }

		expect(ProfileValidator.isProfileAllowed(profile, allowListFor("fake-ai", [SENTINEL_MODEL_ID]))).toBe(false)
		expect(
			ProfileValidator.isProfileAllowed(profile, {
				allowAll: false,
				providers: { "fake-ai": { allowAll: true } },
			}),
		).toBe(true)
	})

	it("covers every runtime provider", () => {
		expect([...modelIdProviders, ...Object.keys(providersWithoutModelIdField)].sort()).toEqual(
			[...runtimeProviders].sort(),
		)
	})
})
