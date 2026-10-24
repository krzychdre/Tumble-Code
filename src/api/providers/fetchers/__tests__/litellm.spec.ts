// cd src && ./node_modules/.bin/vitest run api/providers/fetchers/__tests__/litellm.spec.ts

vi.mock("axios")
vi.mock("../../../../utils/logging", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import axios from "axios"

import { getLiteLLMModels } from "../litellm"
import { DEFAULT_HEADERS } from "../../constants"

const get = vi.mocked(axios.get)

function entry(
	modelName: string,
	modelInfo: Record<string, unknown> | undefined,
	litellmModel: string | null = "anthropic/x",
) {
	return { model_name: modelName, model_info: modelInfo, litellm_params: litellmModel && { model: litellmModel } }
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(axios.isAxiosError).mockImplementation((error: any) => Boolean(error?.isAxiosError))
})

describe("getLiteLLMModels", () => {
	it.each([
		["http://localhost:4000", "http://localhost:4000/v1/model/info"],
		["http://localhost:4000/", "http://localhost:4000/v1/model/info"],
		["http://localhost:4000/litellm", "http://localhost:4000/litellm/v1/model/info"],
		["http://localhost:4000/litellm//", "http://localhost:4000/litellm/v1/model/info"],
		["http://localhost:4000//api//v1", "http://localhost:4000/api/v1/v1/model/info"],
		["http://localhost:4000/litellm?key=1", "http://localhost:4000/litellm/v1/model/info?key=1"],
		["http://localhost:4000/litellm#frag", "http://localhost:4000/litellm/v1/model/info#frag"],
	])("requests the model info of %s at %s with the key and a timeout", async (baseUrl, url) => {
		get.mockResolvedValueOnce({ data: { data: [] } })
		expect(await getLiteLLMModels("test-key", baseUrl)).toEqual({})
		expect(get).toHaveBeenCalledWith(url, {
			headers: { "Content-Type": "application/json", ...DEFAULT_HEADERS, Authorization: "Bearer test-key" },
			timeout: 5000,
		})
	})

	it("sends no Authorization header without a key", async () => {
		get.mockResolvedValueOnce({ data: { data: [] } })
		await getLiteLLMModels("", "http://localhost:4000")
		expect(get.mock.calls[0][1]!.headers).not.toHaveProperty("Authorization")
	})

	it("maps the model info, prices per million tokens, and skips incomplete entries", async () => {
		get.mockResolvedValueOnce({
			data: {
				data: [
					entry("claude", {
						max_output_tokens: 64_000,
						max_tokens: 4096,
						max_input_tokens: 1_000_000,
						supports_vision: true,
						supports_prompt_caching: true,
						input_cost_per_token: 0.000003,
						output_cost_per_token: 0.000015,
						cache_creation_input_token_cost: 0.00000375,
						cache_read_input_token_cost: 0.0000003,
					}),
					entry("small", { max_tokens: 4096 }),
					entry("bare", {}),
					entry("", { max_tokens: 1 }),
					entry("no-info", undefined),
					entry("no-litellm-model", { max_tokens: 1 }, null),
				],
			},
		})

		const models = await getLiteLLMModels("key", "http://localhost:4000")

		expect(Object.keys(models)).toEqual(["claude", "small", "bare"])
		expect(models.claude).toEqual({
			maxTokens: 64_000,
			contextWindow: 1_000_000,
			supportsImages: true,
			supportsPromptCache: true,
			inputPrice: expect.closeTo(3, 10),
			outputPrice: expect.closeTo(15, 10),
			cacheWritesPrice: expect.closeTo(3.75, 10),
			cacheReadsPrice: expect.closeTo(0.3, 10),
			description: "claude via LiteLLM proxy",
		})
		expect(models.small).toMatchObject({ maxTokens: 4096, contextWindow: 200_000, supportsImages: false })
		expect(models.bare).toMatchObject({ maxTokens: 8192, inputPrice: undefined, cacheReadsPrice: undefined })
	})

	it.each([
		[
			"an unexpected response shape",
			{ data: { models: [] } },
			"Failed to fetch LiteLLM models: Unexpected response format.",
		],
		[
			"an HTTP error",
			Object.assign(new Error("401"), {
				isAxiosError: true,
				response: { status: 401, statusText: "Unauthorized" },
			}),
			"Failed to fetch LiteLLM models: 401 Unauthorized. Check base URL and API key.",
		],
		[
			"no answer",
			Object.assign(new Error("timeout"), { isAxiosError: true, request: {} }),
			"Failed to fetch LiteLLM models: No response from server. Check LiteLLM server status and base URL.",
		],
		["any other failure", new Error("boom"), "Failed to fetch LiteLLM models: boom"],
	])("explains %s", async (_label, outcome, message) => {
		if (outcome instanceof Error) {
			get.mockRejectedValueOnce(outcome)
		} else {
			get.mockResolvedValueOnce(outcome)
		}
		await expect(getLiteLLMModels("key", "http://localhost:4000")).rejects.toThrow(message)
	})

	it("explains an invalid base URL", async () => {
		await expect(getLiteLLMModels("key", "not a url")).rejects.toThrow(/^Failed to fetch LiteLLM models: /)
		expect(get).not.toHaveBeenCalled()
	})
})
