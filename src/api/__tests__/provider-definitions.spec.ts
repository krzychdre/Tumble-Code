// API-6: every runtime provider entry carries its model facts (model-id field,
// model list, default model, unknown-model policy), its capabilities, and a
// `resolveModel` that reports the handler's model without building a handler.

import {
	type OrganizationAllowList,
	type ProviderSettings,
	bedrockDefaultModelId,
	geminiDefaultModelId,
	getModelIdKeyForProvider,
	internationalZAiDefaultModelId,
	litellmDefaultModelId,
	minimaxDefaultModelId,
	openAiCodexDefaultModelId,
	openAiNativeDefaultModelId,
	providerModelDefinitions,
	unknownModelPolicies,
	vertexDefaultModelId,
	xaiDefaultModelId,
} from "@roo-code/types"

import { ProfileValidator } from "../../shared/ProfileValidator"
import { resolveProviderModel } from "../index"
import {
	getRuntimeProviderCapabilities,
	runtimeProviderRegistry,
	type RuntimeProviderId,
} from "../runtime-provider-registry"

const { lmStudioFetchers } = vi.hoisted(() => ({
	lmStudioFetchers: {
		hasLoadedFullDetails: vi.fn(() => false),
		forceFullModelDetailsLoad: vi.fn(async () => {}),
	},
}))

// No fetched model lists: resolveModel and a freshly built handler then see
// the same (empty) lists.
vi.mock("../providers/fetchers/modelCache", async (importOriginal) => ({
	...(await importOriginal<typeof import("../providers/fetchers/modelCache")>()),
	getModelsFromCache: () => undefined,
}))

vi.mock("../providers/fetchers/lmstudio", async (importOriginal) => ({
	...(await importOriginal<typeof import("../providers/fetchers/lmstudio")>()),
	...lmStudioFetchers,
}))

vi.mock("vscode", async (importOriginal) => {
	const original = await importOriginal<typeof import("vscode")>()

	return {
		...original,
		workspace: { ...original.workspace, onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })) },
		lm: { selectChatModels: vi.fn(async () => []) },
	}
})

const UNKNOWN_MODEL_ID = "api6-unknown-model"

const runtimeProviders = Object.keys(runtimeProviderRegistry) as RuntimeProviderId[]

// Credentials some constructors insist on; unrelated to model resolution.
const constructorOptions: Partial<ProviderSettings> = { mistralApiKey: "test-key" }

const settingsWithModelId = (provider: RuntimeProviderId, modelId: string): ProviderSettings => {
	const field = runtimeProviderRegistry[provider].modelIdField

	if (field === "vsCodeLmModelSelector") {
		return { vsCodeLmModelSelector: { id: modelId } }
	}

	return field ? { [field]: modelId } : {}
}

// The `{ id, info }` a call reports, or the error it throws (Bedrock without a
// model id throws in both paths).
const outcome = (resolve: () => { id: string; info: unknown }) => {
	try {
		const { id, info } = resolve()
		return { id, info }
	} catch (error) {
		return { error: String(error) }
	}
}

describe("runtime provider definitions", () => {
	it.each(runtimeProviders)("%s declares its model facts, capabilities and resolver", (provider) => {
		const entry = runtimeProviderRegistry[provider]

		expect(entry).toHaveProperty("modelIdField")
		expect(unknownModelPolicies).toContain(entry.unknownModelPolicy)
		expect(typeof entry.factory).toBe("function")
		expect(typeof entry.resolveModel).toBe("function")
		expect(entry.capabilities).toEqual({
			allowedFunctionNames: expect.any(Boolean),
			needsModelPreload: expect.any(Boolean),
		})
		expect(entry.preloadModel !== undefined).toBe(entry.capabilities.needsModelPreload)

		// The runtime entry extends the portable definition, it does not copy it.
		const { modelIdField, unknownModelPolicy } = providerModelDefinitions[provider]
		expect({ modelIdField: entry.modelIdField, unknownModelPolicy: entry.unknownModelPolicy }).toEqual({
			modelIdField,
			unknownModelPolicy,
		})
	})

	it("gives a model-id field to every provider except fake-ai", () => {
		expect(runtimeProviders.filter((provider) => runtimeProviderRegistry[provider].modelIdField === null)).toEqual([
			"fake-ai",
		])
	})

	it.each(runtimeProviders.filter((provider) => runtimeProviderRegistry[provider].modelIdField !== null))(
		"lets the organization allow list resolve the %s model from its model-id field",
		(provider) => {
			const profile = { apiProvider: provider, ...settingsWithModelId(provider, UNKNOWN_MODEL_ID) }
			const allowList = (models: string[]): OrganizationAllowList => ({
				allowAll: false,
				providers: { [provider]: { allowAll: false, models } },
			})

			expect(ProfileValidator.isProfileAllowed(profile, allowList([UNKNOWN_MODEL_ID]))).toBe(true)
			expect(ProfileValidator.isProfileAllowed(profile, allowList(["another-model"]))).toBe(false)

			const field = runtimeProviderRegistry[provider].modelIdField
			expect(getModelIdKeyForProvider(provider)).toBe(field === "vsCodeLmModelSelector" ? undefined : field)
		},
	)

	describe("capabilities", () => {
		it("only Gemini restricts callable tools through allowedFunctionNames", () => {
			expect(
				runtimeProviders.filter(
					(provider) => runtimeProviderRegistry[provider].capabilities.allowedFunctionNames,
				),
			).toEqual(["gemini"])
		})

		it("only LM Studio preloads its model, through the LM Studio fetcher", async () => {
			expect(
				runtimeProviders.filter((provider) => runtimeProviderRegistry[provider].capabilities.needsModelPreload),
			).toEqual(["lmstudio"])

			await runtimeProviderRegistry.lmstudio.preloadModel!({
				lmStudioModelId: "qwen",
				lmStudioBaseUrl: "http://h:1",
			})

			expect(lmStudioFetchers.forceFullModelDetailsLoad).toHaveBeenCalledWith("http://h:1", "qwen")
		})

		it("reports no capabilities for providers without a runtime handler", () => {
			expect(getRuntimeProviderCapabilities("gemini-cli")).toEqual({
				allowedFunctionNames: false,
				needsModelPreload: false,
			})
			expect(getRuntimeProviderCapabilities(undefined).allowedFunctionNames).toBe(false)
		})
	})
})

describe("resolveModel matches the handler's getModel()", () => {
	const buildableProviders = runtimeProviders.filter((provider) => provider !== "fake-ai")

	it.each(buildableProviders)("%s without a model id", (provider) => {
		const entry = runtimeProviderRegistry[provider]

		expect(outcome(() => entry.resolveModel(constructorOptions))).toEqual(
			outcome(() => entry.factory(constructorOptions).getModel()),
		)
	})

	it.each(buildableProviders)("%s with an unknown model id", (provider) => {
		const entry = runtimeProviderRegistry[provider]
		const settings = { ...constructorOptions, ...settingsWithModelId(provider, UNKNOWN_MODEL_ID) }

		expect(outcome(() => entry.resolveModel(settings))).toEqual(outcome(() => entry.factory(settings).getModel()))
	})

	it("vertex routes Claude ids to the Anthropic Vertex resolution", () => {
		const settings = { apiModelId: "claude-sonnet-4-5@20250929" }
		const entry = runtimeProviderRegistry.vertex

		expect(outcome(() => entry.resolveModel(settings))).toEqual(outcome(() => entry.factory(settings).getModel()))
	})

	it("resolveProviderModel falls back like buildApiHandler", () => {
		expect(resolveProviderModel({}).id).toBe(runtimeProviderRegistry.anthropic.resolveModel({}).id)
		expect(resolveProviderModel({ apiProvider: "gemini-cli", apiModelId: "claude-custom-x" }).id).toBe(
			"claude-custom-x",
		)
		expect(() => resolveProviderModel({ apiProvider: "groq" })).toThrow(
			'Sorry, provider "groq" is no longer supported.',
		)
	})
})

// Today's unknown-model-id behavior, one row per provider. Three policies
// exist (owner decision 5 unifies them): keep the id with default info,
// silently substitute the default model, honor a custom id the provider can
// describe.
describe("unknown model id (today's policy)", () => {
	const kept = { policy: "keep-id", id: UNKNOWN_MODEL_ID } as const
	const substituted = (id: string) => ({ policy: "substitute-default", id }) as const

	const cases: Record<Exclude<RuntimeProviderId, "fake-ai">, { policy: string; id: string }> = {
		openrouter: kept,
		deepseek: kept,
		ollama: kept,
		lmstudio: kept,
		"vscode-lm": kept,
		openai: kept,
		mistral: kept,
		moonshot: kept,
		"qwen-code": kept,
		anthropic: { policy: "honor-custom", id: UNKNOWN_MODEL_ID },
		// Only ids that look like Gemini models are honored.
		gemini: { policy: "honor-custom", id: geminiDefaultModelId },
		litellm: substituted(litellmDefaultModelId),
		bedrock: substituted(bedrockDefaultModelId),
		minimax: substituted(minimaxDefaultModelId),
		"openai-codex": substituted(openAiCodexDefaultModelId),
		"openai-native": substituted(openAiNativeDefaultModelId),
		vertex: substituted(vertexDefaultModelId),
		xai: substituted(xaiDefaultModelId),
		zai: substituted(internationalZAiDefaultModelId),
	}

	it("covers every provider with a model-id field", () => {
		expect(Object.keys(cases).sort()).toEqual(runtimeProviders.filter((p) => p !== "fake-ai").sort())
	})

	it.each(Object.entries(cases))("%s", (provider, expected) => {
		const entry = runtimeProviderRegistry[provider as RuntimeProviderId]
		const settings = {
			...constructorOptions,
			...settingsWithModelId(provider as RuntimeProviderId, UNKNOWN_MODEL_ID),
		}

		expect(entry.unknownModelPolicy).toBe(expected.policy)
		expect(entry.resolveModel(settings).id).toBe(expected.id)
	})

	it("gemini honors an unlisted Gemini id without pricing", () => {
		const { id, info } = runtimeProviderRegistry.gemini.resolveModel({ apiModelId: "gemini-9-api6" })

		expect(id).toBe("gemini-9-api6")
		expect(info.inputPrice).toBeUndefined()
	})

	it("vertex substitutes the default for an unknown Claude id", () => {
		expect(runtimeProviderRegistry.vertex.resolveModel({ apiModelId: "claude-api6-unknown" }).id).toBe(
			vertexDefaultModelId,
		)
	})
})
