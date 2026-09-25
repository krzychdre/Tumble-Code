// CLI-5: the CLI sizes its context gauge with `resolvePortableProviderModel`
// from @roo-code/types, because it cannot import the extension's handlers.
// This pins that it reports the same context window as `resolveProviderModel`
// (the handler's getModel()) for every provider it claims, over many settings.

import {
	type ModelInfo,
	type ProviderSettings,
	deepSeekModelAliases,
	providerModelDefinitions,
	resolvePortableProviderModel,
	zaiApiLineSchema,
	mainlandZAiModels,
} from "@roo-code/types"

import { resolveProviderModel } from "../index"
import { runtimeProviderRegistry, type RuntimeProviderId } from "../runtime-provider-registry"

const fetched: Record<string, Record<string, ModelInfo>> = vi.hoisted(() => {
	const info = (contextWindow: number) => ({ contextWindow, supportsPromptCache: false, maxTokens: 4096 })

	return {
		openrouter: { "vendor/fetched-model": info(111_111) },
		litellm: { "fetched-model": info(222_222) },
		ollama: { "fetched-model": info(33_333) },
		lmstudio: { "fetched-model": info(44_444) },
	}
})

vi.mock("../providers/fetchers/modelCache", async (importOriginal) => ({
	...(await importOriginal<typeof import("../providers/fetchers/modelCache")>()),
	getModelsFromCache: (provider: string) => fetched[provider],
}))

vi.mock("vscode", async (importOriginal) => {
	const original = await importOriginal<typeof import("vscode")>()

	return {
		...original,
		workspace: { ...original.workspace, onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })) },
		lm: { selectChatModels: vi.fn(async () => []) },
	}
})

// Resolved by the handler itself (custom ARN parsing, injected fake).
const handlerOnlyProviders = new Set<string>(["bedrock", "fake-ai"])

const portableProviders = [
	...(Object.keys(runtimeProviderRegistry) as RuntimeProviderId[]).filter((id) => !handlerOnlyProviders.has(id)),
	"gemini-cli" as const,
]

const modelIdsFor = (provider: string): (string | undefined)[] => {
	const definition = providerModelDefinitions[provider as keyof typeof providerModelDefinitions]
	const listed = definition && "models" in definition ? Object.keys(definition.models) : []
	const extra = provider === "zai" ? Object.keys(mainlandZAiModels) : []
	const aliases = provider === "deepseek" ? Object.keys(deepSeekModelAliases) : []

	return [
		undefined,
		"",
		"cli5-unknown-model",
		"claude-sonnet-4-5-20990101-proxy",
		...listed,
		...extra,
		...aliases,
		...Object.keys(fetched[provider] ?? {}),
	]
}

const settingsFor = (provider: string, modelId: string | undefined): ProviderSettings[] => {
	const field =
		provider === "gemini-cli"
			? "apiModelId"
			: runtimeProviderRegistry[provider as RuntimeProviderId].modelIdField
	const base: ProviderSettings = {
		apiProvider: provider as ProviderSettings["apiProvider"],
		...(field && field !== "vsCodeLmModelSelector" && modelId !== undefined ? { [field]: modelId } : {}),
	}

	return [
		base,
		{ ...base, anthropicBeta1MContext: true, vertex1MContext: true },
		...zaiApiLineSchema.options.map((zaiApiLine) => ({ ...base, zaiApiLine })),
		{ ...base, openAiCustomModelInfo: { contextWindow: 77_777, supportsPromptCache: false } },
	]
}

describe("resolvePortableProviderModel", () => {
	it.each(portableProviders)("sizes %s models like the handler", (provider) => {
		for (const modelId of modelIdsFor(provider)) {
			for (const settings of settingsFor(provider, modelId)) {
				const portable = resolvePortableProviderModel(settings, fetched[provider])

				expect(portable, JSON.stringify(settings)).toBeDefined()
				expect(portable!.info.contextWindow, JSON.stringify(settings)).toBe(
					resolveProviderModel(settings).info.contextWindow,
				)
			}
		}
	})

	it("leaves the handler-only and non-runnable providers to the caller", () => {
		expect(resolvePortableProviderModel({ apiProvider: "bedrock", apiModelId: "x" })).toBeUndefined()
		expect(resolvePortableProviderModel({ apiProvider: "fake-ai" })).toBeUndefined()
		expect(resolvePortableProviderModel({ apiProvider: "groq" as never })).toBeUndefined()
		expect(resolvePortableProviderModel({})).toBeUndefined()
	})
})
