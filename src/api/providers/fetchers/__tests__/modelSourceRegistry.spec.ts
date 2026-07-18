import { modelSources, type ModelSourceRequest } from "@roo-code/types"

import { fetchModelSource, modelSourceRegistry } from "../modelSourceRegistry"

vi.mock("../openrouter", () => ({ getOpenRouterModels: vi.fn(async () => ({ openrouter: {} })) }))
vi.mock("../requesty", () => ({ getRequestyModels: vi.fn(async () => ({ requesty: {} })) }))
vi.mock("../unbound", () => ({ getUnboundModels: vi.fn(async () => ({ unbound: {} })) }))
vi.mock("../litellm", () => ({ getLiteLLMModels: vi.fn(async () => ({ litellm: {} })) }))
vi.mock("../vercel-ai-gateway", () => ({ getVercelAiGatewayModels: vi.fn(async () => ({ vercel: {} })) }))
vi.mock("../poe", () => ({ getPoeModels: vi.fn(async () => ({ poe: {} })) }))
vi.mock("../deepseek", () => ({ getDeepSeekModels: vi.fn(async () => ({ deepseek: {} })) }))
vi.mock("../ollama", () => ({ getOllamaModels: vi.fn(async () => ({ ollama: {} })) }))
vi.mock("../lmstudio", () => ({ getLMStudioModels: vi.fn(async () => ({ lmstudio: {} })) }))
vi.mock("../../openai", () => ({ getOpenAiModels: vi.fn(async () => ["openai"]) }))
vi.mock("../../vscode-lm", () => ({ getVsCodeLmModels: vi.fn(async () => [{ vendor: "copilot", family: "gpt" }]) }))

const requestFor = (source: keyof typeof modelSources): ModelSourceRequest => ({
	requestId: `request-${source}`,
	source: modelSources[source],
})

describe("modelSourceRegistry", () => {
	it("is complete for every portable source", () => {
		expect(Object.keys(modelSourceRegistry).sort()).toEqual(Object.keys(modelSources).sort())
	})

	it.each([
		["openrouter", "openrouter"],
		["requesty", "requesty"],
		["unbound", "unbound"],
		["litellm", "litellm"],
		["vercel-ai-gateway", "vercel"],
		["poe", "poe"],
		["deepseek", "deepseek"],
		["ollama", "ollama"],
		["lmstudio", "lmstudio"],
	] as const)("routes %s to its model adapter", async (source, modelId) => {
		await expect(fetchModelSource(requestFor(source), { apiConfiguration: {} })).resolves.toEqual({
			models: { [modelId]: {} },
		})
	})

	it("normalizes ID-only adapters", async () => {
		await expect(fetchModelSource(requestFor("openai-compatible"), { apiConfiguration: {} })).resolves.toEqual({
			modelIds: ["openai"],
		})
		await expect(fetchModelSource(requestFor("vscode-lm"), { apiConfiguration: {} })).resolves.toEqual({
			modelIds: ["copilot/gpt"],
		})
	})
})
