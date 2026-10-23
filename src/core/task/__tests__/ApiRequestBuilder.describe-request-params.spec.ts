// cd src && npx vitest run core/task/__tests__/ApiRequestBuilder.describe-request-params.spec.ts

import type { ModelInfo, ProviderSettings } from "@tumble-code/types"

import { ApiRequestBuilder, type ApiRequestBuilderAccess } from "../ApiRequestBuilder"

const modelInfo: ModelInfo = { maxTokens: 4096, contextWindow: 200_000, supportsPromptCache: false }

/** The parameters the error reports and the exchange recorder show for a request on this profile. */
function requestParams(apiConfiguration: ProviderSettings, modelId: string, hasTools: boolean) {
	const access = {
		apiConfiguration,
		api: { getModel: () => ({ id: modelId, info: modelInfo }) },
	} as unknown as ApiRequestBuilderAccess
	return new ApiRequestBuilder(access).describeRequestParams("code", hasTools)
}

describe("ApiRequestBuilder.describeRequestParams", () => {
	it("describes the profile's sampling, output and tool settings", () => {
		const profile: ProviderSettings = { apiProvider: "anthropic", modelTemperature: 0.3, reasoningEffort: "high" }

		expect(requestParams(profile, "claude-sonnet-4-6", true)).toEqual({
			mode: "code",
			toolProtocol: "anthropic",
			temperature: 0.3,
			maxTokens: 4096,
			reasoningEffort: "high",
			toolChoice: "auto",
			parallelToolCalls: true,
		})
	})

	it("leaves out the tool fields without tools, an unset temperature and a disabled effort", () => {
		const profile: ProviderSettings = {
			apiProvider: "openai",
			modelTemperature: null,
			enableReasoningEffort: false,
			reasoningEffort: "high",
		}

		expect(requestParams(profile, "gpt-x", false)).toEqual({
			mode: "code",
			toolProtocol: "openai",
			temperature: undefined,
			maxTokens: 4096,
			reasoningEffort: undefined,
		})
	})

	// The protocol depends on the model too: Claude on Vertex speaks the Anthropic protocol.
	it.each([
		["claude-sonnet-4-6", "anthropic"],
		["gemini-2.5-pro", "openai"],
	])("Vertex %s: toolProtocol is %s", (modelId, toolProtocol) => {
		expect(requestParams({ apiProvider: "vertex" }, modelId, false).toolProtocol).toBe(toolProtocol)
	})

	it("reports one tool call per message on the compact profile", () => {
		expect(requestParams({ apiProvider: "openai", compactProfile: true }, "m", true).parallelToolCalls).toBe(false)
	})
})
