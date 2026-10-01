import { anthropicModels } from "../providers/anthropic.js"
import { bedrockModels } from "../providers/bedrock.js"
import { litellmDefaultModelId } from "../providers/lite-llm.js"
import { OPEN_ROUTER_PROMPT_CACHING_MODELS, OPEN_ROUTER_REASONING_BUDGET_MODELS } from "../providers/openrouter.js"
import { vertexModels } from "../providers/vertex.js"

// Claude models Anthropic has retired: requests to them fail on every platform,
// so no model table should offer them (Anthropic model list, 2026-09-25).
const RETIRED_CLAUDE_ID = /claude-3[-.]|claude-opus-4[-.]1/

describe("Claude model tables", () => {
	it("offer no retired Claude model", () => {
		const ids = [
			...Object.keys(anthropicModels),
			...Object.keys(vertexModels),
			...Object.keys(bedrockModels),
			...OPEN_ROUTER_PROMPT_CACHING_MODELS,
			...OPEN_ROUTER_REASONING_BUDGET_MODELS,
			litellmDefaultModelId,
		]

		expect(ids.filter((id) => RETIRED_CLAUDE_ID.test(id))).toEqual([])
	})

	// Vertex and Bedrock serve the same models with the same output limit as the
	// direct Anthropic API; the tables listed 8192 there, which capped the max
	// output slider far below what the models accept.
	it.each([
		["claude-opus-5-5", "claude-opus-5-5", "anthropic.claude-opus-5-5"],
		["claude-opus-5", "claude-opus-5", "anthropic.claude-opus-5"],
		["claude-sonnet-5", "claude-sonnet-5", "anthropic.claude-sonnet-5"],
		["claude-opus-4-8", "claude-opus-4-8", "anthropic.claude-opus-4-8"],
		["claude-opus-4-7", "claude-opus-4-7", "anthropic.claude-opus-4-7"],
		["claude-opus-4-6", "claude-opus-4-6", "anthropic.claude-opus-4-6-v1"],
		["claude-fable-5-1", "claude-fable-5-1", "anthropic.claude-fable-5-1"],
		["claude-fable-5", "claude-fable-5", "anthropic.claude-fable-5"],
	] as const)("%s has the same max output on Anthropic, Vertex and Bedrock", (anthropicId, vertexId, bedrockId) => {
		const maxTokens = anthropicModels[anthropicId].maxTokens

		expect(maxTokens).toBe(128_000)
		expect(vertexModels[vertexId].maxTokens).toBe(maxTokens)
		expect(bedrockModels[bedrockId].maxTokens).toBe(maxTokens)
	})
})
