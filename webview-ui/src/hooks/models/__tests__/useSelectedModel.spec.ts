// The parts of useSelectedModel the resolution table (useSelectedModel.resolution.spec.ts) does not
// pin: which fetches the selected provider waits for, the OpenRouter endpoint without a list entry,
// Bedrock's 1M tier, the unknown-model warning and the Z.ai line's model list.

import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import type { Mock } from "vitest"

import {
	type ModelInfo,
	type ProviderSettings,
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	anthropicDefaultModelId,
	internationalZAiModels,
	mainlandZAiModels,
	openRouterDefaultModelId,
} from "@tumble-code/types"

import { useSelectedModel } from "../useSelectedModel"
import { useProviderModels } from "../useProviderModels"
import { useOpenRouterModelProviders } from "../useOpenRouterModelProviders"

vi.mock("../useProviderModels")
vi.mock("../useOpenRouterModelProviders")

const mockUseProviderModels = useProviderModels as Mock<typeof useProviderModels>
const mockUseOpenRouterModelProviders = useOpenRouterModelProviders as Mock<typeof useOpenRouterModelProviders>

const createWrapper = () => {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	return ({ children }: { children: React.ReactNode }) =>
		React.createElement(QueryClientProvider, { client: queryClient }, children)
}

const select = (apiConfiguration?: ProviderSettings) =>
	renderHook(() => useSelectedModel(apiConfiguration), { wrapper: createWrapper() }).result.current

const providerModels = (state: { models?: Record<string, ModelInfo>; isLoading?: boolean; error?: string }) =>
	mockUseProviderModels.mockReturnValue({
		models: state.models,
		modelIds: state.models ? Object.keys(state.models) : undefined,
		isLoading: state.isLoading ?? false,
		error: state.error,
	} as any)

const openRouterProviders = (state: { data?: Record<string, ModelInfo>; isLoading?: boolean; isError?: boolean }) =>
	mockUseOpenRouterModelProviders.mockReturnValue({
		data: state.data,
		isLoading: state.isLoading ?? false,
		isError: state.isError ?? false,
	} as any)

beforeEach(() => {
	providerModels({})
	openRouterProviders({ data: {} })
})

describe("useSelectedModel", () => {
	it("returns the Anthropic default without a configuration", () => {
		expect(select()).toMatchObject({ provider: "anthropic", id: anthropicDefaultModelId, isUnknownModel: false })
	})

	describe("loading and error states", () => {
		// A static provider ignores the fetches it does not need.
		it.each([
			{ name: "loading model list", models: { isLoading: true }, endpoints: {} },
			{ name: "failed model list", models: { error: "boom" }, endpoints: {} },
			{ name: "loading OpenRouter endpoints", models: {}, endpoints: { isLoading: true } },
			{ name: "failed OpenRouter endpoints", models: {}, endpoints: { isError: true } },
		])("a static provider ignores a $name", ({ models, endpoints }) => {
			providerModels(models)
			openRouterProviders(endpoints)

			expect(select({ apiProvider: "anthropic" })).toMatchObject({ isLoading: false, isError: false })
		})

		it("OpenRouter waits for its model list: the default id, no info and no warning meanwhile", () => {
			providerModels({ isLoading: true })

			expect(select({ apiProvider: "openrouter", openRouterModelId: "vendor/model" })).toEqual({
				provider: "openrouter",
				id: openRouterDefaultModelId,
				info: undefined,
				isLoading: true,
				isError: false,
				isUnknownModel: false,
			})
		})

		it.each([
			{ name: "model list", models: { error: "boom" }, endpoints: { data: {} } },
			{ name: "endpoint list", models: { models: {} }, endpoints: { data: {}, isError: true } },
		])("OpenRouter reports a failed $name and no unknown-model warning", ({ models, endpoints }) => {
			providerModels(models)
			openRouterProviders(endpoints)

			expect(select({ apiProvider: "openrouter", openRouterModelId: "vendor/model" })).toMatchObject({
				isError: true,
				isUnknownModel: false,
			})
		})
	})

	// Owner decision 5: the configured id is kept (requests send it as is) and flagged as unknown.
	it("OpenRouter: an unlisted model with a chosen endpoint shows the endpoint's info and is flagged", () => {
		const endpoint: ModelInfo = { maxTokens: 8192, contextWindow: 16384, supportsPromptCache: true }
		providerModels({ models: { "listed/model": { maxTokens: 1, contextWindow: 2, supportsPromptCache: false } } })
		openRouterProviders({ data: { endpoint } })

		expect(
			select({
				apiProvider: "openrouter",
				openRouterModelId: "test-model",
				openRouterSpecificProvider: "endpoint",
			}),
		).toMatchObject({ id: "test-model", info: endpoint, isUnknownModel: true })
	})

	describe("Bedrock 1M context", () => {
		const [oneMillionModel] = BEDROCK_1M_CONTEXT_MODEL_IDS

		it.each([
			{ name: "a 1M model with the beta", id: oneMillionModel, beta: true, window: 1_000_000, input: 6.0 },
			{ name: "a 1M model without the beta", id: oneMillionModel, beta: false, window: 200_000, input: 3.0 },
			{
				name: "another model with the beta",
				id: "anthropic.claude-opus-4-20250514-v1:0",
				beta: true,
				window: 200_000,
				input: 15.0,
			},
		])("$name: window $window", ({ id, beta, window, input }) => {
			const { info } = select({ apiProvider: "bedrock", apiModelId: id, awsBedrock1MContext: beta })

			expect(info?.contextWindow).toBe(window)
			expect(info?.inputPrice).toBe(input)
		})
	})

	describe("unknown model ids (owner decision 5)", () => {
		it.each([
			["xai", { apiProvider: "xai", apiModelId: "grok-api6" }, true],
			["xai (listed)", { apiProvider: "xai", apiModelId: "grok-4.6" }, false],
			["anthropic", { apiProvider: "anthropic", apiModelId: "claude-api6" }, true],
			["zai (mainland list)", { apiProvider: "zai", zaiApiLine: "china_coding", apiModelId: "glm-api6" }, true],
			["bedrock custom ARN", { apiProvider: "bedrock", apiModelId: "custom-arn" }, false],
			["deepseek current", { apiProvider: "deepseek", apiModelId: "deepseek-flash" }, false],
			["deepseek-v4-flash legacy alias", { apiProvider: "deepseek", apiModelId: "deepseek-v4-flash" }, false],
			// Retired: listed as deprecated, so the picker says "no longer available" instead.
			["deepseek-chat retired", { apiProvider: "deepseek", apiModelId: "deepseek-chat" }, false],
			["deepseek-reasoner retired", { apiProvider: "deepseek", apiModelId: "deepseek-reasoner" }, false],
			["deepseek unknown", { apiProvider: "deepseek", apiModelId: "deepseek-api6" }, true],
			["no model id", { apiProvider: "gemini" }, false],
			["OpenAI Compatible (no list)", { apiProvider: "openai", openAiModelId: "anything" }, false],
		] as const)("%s: isUnknownModel is %s", (_, apiConfiguration, expected) => {
			const selected = select(apiConfiguration as ProviderSettings)

			expect(selected.isUnknownModel).toBe(expected)
			if (!expected && String((apiConfiguration as ProviderSettings).apiModelId).startsWith("deepseek-")) {
				expect(selected.id).toBe((apiConfiguration as ProviderSettings).apiModelId)
				expect(selected.info).toBeDefined()
			}
			if (expected) {
				expect(selected.id).toBe((apiConfiguration as ProviderSettings).apiModelId)
			}
		})
	})

	// Regression (Z.ai China API): the settings must check the model list the request uses; the
	// hook used to treat only `china_coding` as China, so `china_api` showed the international list.
	describe("Z.ai API lines use the request's model list", () => {
		const lines = [
			[undefined, internationalZAiModels],
			["international_coding", internationalZAiModels],
			["international_api", internationalZAiModels],
			["china_coding", mainlandZAiModels],
			["china_api", mainlandZAiModels],
		] as const

		it.each(lines)("%s: a model priced per line has that line's prices", (zaiApiLine, models) => {
			expect(select({ apiProvider: "zai", zaiApiLine, apiModelId: "glm-4.5" }).info).toEqual(models["glm-4.5"])
		})

		it.each(lines)(
			"%s: a model only the international list has is unknown on China lines",
			(zaiApiLine, models) => {
				const selected = select({ apiProvider: "zai", zaiApiLine, apiModelId: "glm-4-32b-0414-128k" })

				expect(selected.isUnknownModel).toBe(!("glm-4-32b-0414-128k" in models))
			},
		)
	})
})
