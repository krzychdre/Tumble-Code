import { readFileSync } from "node:fs"
import { join } from "node:path"

import { ANTHROPIC_1M_CONTEXT_MODEL_IDS, anthropicModels } from "../providers/anthropic.js"
import { BEDROCK_1M_CONTEXT_MODEL_IDS, bedrockModels } from "../providers/bedrock.js"
import { claudeModels } from "../providers/claude.js"
import { litellmDefaultModelId } from "../providers/lite-llm.js"
import { OPEN_ROUTER_PROMPT_CACHING_MODELS, OPEN_ROUTER_REASONING_BUDGET_MODELS } from "../providers/openrouter.js"
import { VERTEX_1M_CONTEXT_MODEL_IDS, vertexModels } from "../providers/vertex.js"

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

	// The three tables are derived from one record per model (providers/claude.ts). The fixture is the
	// Claude entries of the hand-written tables as they stood before the derivation; when a model
	// changes on purpose, update the record or the platform override and the fixture together.
	describe("derived from the shared Claude records", () => {
		const fixture = JSON.parse(
			readFileSync(join(__dirname, "__fixtures__", "claude-model-tables.json"), "utf8"),
		) as Record<"anthropic" | "vertex" | "bedrock", { order: string[]; models: Record<string, unknown> }> & {
			oneMillionContextIds: Record<"anthropic" | "vertex" | "bedrock", string[]>
		}
		const claudeEntries = (table: Record<string, unknown>) =>
			Object.fromEntries(Object.entries(table).filter(([id]) => id.includes("claude")))

		it.each([
			["anthropic", anthropicModels],
			["vertex", vertexModels],
			["bedrock", bedrockModels],
		] as const)("%s entries are deep-equal to the frozen table, in the same order", (platform, table) => {
			expect(claudeEntries(table)).toStrictEqual(fixture[platform].models)
			expect(Object.keys(table)).toEqual(fixture[platform].order)
		})

		it("lists the same 1M context models", () => {
			expect([...ANTHROPIC_1M_CONTEXT_MODEL_IDS].sort()).toEqual(
				[...fixture.oneMillionContextIds.anthropic].sort(),
			)
			expect([...VERTEX_1M_CONTEXT_MODEL_IDS]).toEqual(fixture.oneMillionContextIds.vertex)
			expect([...BEDROCK_1M_CONTEXT_MODEL_IDS]).toEqual(fixture.oneMillionContextIds.bedrock)
		})

		it("gives each table its own entry objects", () => {
			expect(anthropicModels["claude-opus-5"]).not.toBe(claudeModels["opus-5"])
			expect(vertexModels["claude-opus-5"]).not.toBe(anthropicModels["claude-opus-5"])
			expect(bedrockModels["anthropic.claude-opus-5"]).not.toBe(vertexModels["claude-opus-5"])
		})
	})
})
