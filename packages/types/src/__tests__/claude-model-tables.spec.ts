import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { ModelInfo } from "../model.js"

import { ANTHROPIC_1M_CONTEXT_MODEL_IDS, anthropicModels } from "../providers/anthropic.js"
import { BEDROCK_1M_CONTEXT_MODEL_IDS, bedrockModels } from "../providers/bedrock.js"
import { claudeModels } from "../providers/claude.js"
import { litellmDefaultModelId } from "../providers/lite-llm.js"
import { OPEN_ROUTER_PROMPT_CACHING_MODELS, OPEN_ROUTER_REASONING_BUDGET_MODELS } from "../providers/openrouter.js"
import { VERTEX_1M_CONTEXT_MODEL_IDS, vertexModels } from "../providers/vertex.js"
import { minimaxModels } from "../providers/minimax.js"
import { resolveProviderModelSelection } from "../provider-model-selection.js"
import type { ProviderName } from "../provider-settings.js"

// Claude models Anthropic has retired: requests to them fail on every platform,
// so no model table should offer them (Anthropic model list, 2026-09-25).
const RETIRED_CLAUDE_ID = /claude-3[-.]|claude-opus-4[-.]1/

// Retired on the Claude API on 2026-06-15 (Anthropic model deprecations page, 2026-10-02). Bedrock and
// Vertex set their own retirement schedules, so only the Anthropic table drops them.
const RETIRED_ON_CLAUDE_API = ["claude-sonnet-4-20250514", "claude-opus-4-20250514"]

// One row per Claude model: its id on each platform (null where the platform no longer offers it) and the
// limits Anthropic documents for it (models overview, context windows and model deprecations pages,
// 2026-10-02). The model's limits are the same on every platform that serves it.
const CLAUDE_MODEL_LIMITS = [
	["claude-opus-5-5", "claude-opus-5-5", "anthropic.claude-opus-5-5", 128_000, 1_000_000],
	["claude-opus-5", "claude-opus-5", "anthropic.claude-opus-5", 128_000, 1_000_000],
	["claude-sonnet-5-5", "claude-sonnet-5-5", "anthropic.claude-sonnet-5-5", 128_000, 1_000_000],
	["claude-sonnet-5", "claude-sonnet-5", "anthropic.claude-sonnet-5", 128_000, 1_000_000],
	["claude-opus-4-8", "claude-opus-4-8", "anthropic.claude-opus-4-8", 128_000, 1_000_000],
	["claude-opus-4-7", "claude-opus-4-7", "anthropic.claude-opus-4-7", 128_000, 1_000_000],
	["claude-opus-4-6", "claude-opus-4-6", "anthropic.claude-opus-4-6-v1", 128_000, 1_000_000],
	["claude-sonnet-4-6", "claude-sonnet-4-6", "anthropic.claude-sonnet-4-6", 128_000, 1_000_000],
	["claude-fable-5-1", "claude-fable-5-1", "anthropic.claude-fable-5-1", 128_000, 1_000_000],
	["claude-fable-5", "claude-fable-5", "anthropic.claude-fable-5", 128_000, 1_000_000],
	["claude-haiku-5-5", "claude-haiku-5-5", "anthropic.claude-haiku-5-5", 128_000, 1_000_000],
	[
		"claude-haiku-4-5-20251001",
		"claude-haiku-4-5@20251001",
		"anthropic.claude-haiku-4-5-20251001-v1:0",
		64_000,
		200_000,
	],
	[
		"claude-opus-4-5-20251101",
		"claude-opus-4-5@20251101",
		"anthropic.claude-opus-4-5-20251101-v1:0",
		64_000,
		200_000,
	],
	["claude-sonnet-4-5", "claude-sonnet-4-5@20250929", "anthropic.claude-sonnet-4-5-20250929-v1:0", 64_000, 200_000],
	[null, "claude-sonnet-4@20250514", "anthropic.claude-sonnet-4-20250514-v1:0", 64_000, 200_000],
	[null, "claude-opus-4@20250514", "anthropic.claude-opus-4-20250514-v1:0", 32_000, 200_000],
] as const

const tables = [
	["anthropic", anthropicModels as Record<string, ModelInfo>, ANTHROPIC_1M_CONTEXT_MODEL_IDS],
	["vertex", vertexModels as Record<string, ModelInfo>, VERTEX_1M_CONTEXT_MODEL_IDS],
	["bedrock", bedrockModels as Record<string, ModelInfo>, BEDROCK_1M_CONTEXT_MODEL_IDS],
] as const

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

	// OpenRouter names the Claude 5 models with a dotted version (claude-opus-5.5); each one the
	// Anthropic table offers must get prompt caching and the reasoning toggle there too.
	it("list every Claude 5 model of the Anthropic table in the OpenRouter capability sets", () => {
		const openRouterIds = Object.keys(anthropicModels)
			.filter((id) => /^claude-(opus|sonnet|fable)-5(-\d)?$/.test(id))
			.map((id) => `anthropic/${id.replace(/-5-(\d)$/, "-5.$1")}`)

		expect(openRouterIds).toContain("anthropic/claude-sonnet-5.5")
		for (const id of openRouterIds) {
			expect(OPEN_ROUTER_PROMPT_CACHING_MODELS.has(id)).toBe(true)
			expect(OPEN_ROUTER_REASONING_BUDGET_MODELS.has(id)).toBe(true)
		}
	})

	it("default LiteLLM to a model the Anthropic table offers", () => {
		expect(anthropicModels).toHaveProperty(litellmDefaultModelId)
	})

	it("drop the models retired on the Claude API from the Anthropic table only", () => {
		expect(Object.keys(anthropicModels).filter((id) => RETIRED_ON_CLAUDE_API.includes(id))).toEqual([])
		expect(vertexModels["claude-sonnet-4@20250514"]).toBeDefined()
		expect(bedrockModels["anthropic.claude-opus-4-20250514-v1:0"]).toBeDefined()
	})

	// Claude Sonnet 4.5 is deprecated on the Claude API (2026-09-30, retirement 2026-11-30). Bedrock and Vertex
	// keep their own schedules and default to it, so only the Anthropic entry is marked.
	it("mark the models deprecated on the Claude API in the Anthropic table only", () => {
		expect(
			Object.entries(anthropicModels as Record<string, ModelInfo>)
				.filter(([, info]) => info.deprecated)
				.map(([id]) => id),
		).toEqual(["claude-sonnet-4-5"])
		expect(claudeModels["sonnet-4-5"]).not.toHaveProperty("deprecated")
		expect(vertexModels["claude-sonnet-4-5@20250929"]).not.toHaveProperty("deprecated")
		expect(bedrockModels["anthropic.claude-sonnet-4-5-20250929-v1:0"]).not.toHaveProperty("deprecated")
	})

	// Haiku 5.5 is priced by prompt length: over 100K prompt tokens every price is five times higher
	// (pricing page, 2026-10-17). The same record serves all three platforms.
	it("prices the Claude Haiku 5.5 long prompt tier on every platform", () => {
		const longContextPricing = {
			thresholdTokens: 100_000,
			inputPriceMultiplier: 5,
			outputPriceMultiplier: 5,
			cacheWritesPriceMultiplier: 5,
			cacheReadsPriceMultiplier: 5,
		}
		for (const info of [
			anthropicModels["claude-haiku-5-5"],
			vertexModels["claude-haiku-5-5"],
			bedrockModels["anthropic.claude-haiku-5-5"],
		]) {
			expect(info).toMatchObject({
				inputPrice: 0.1,
				outputPrice: 0.5,
				cacheWritesPrice: 0.125,
				cacheReadsPrice: 0.01,
				longContextPricing,
			})
		}
	})

	// Vertex and Bedrock serve the same models with the same limits as the direct Anthropic API;
	// the tables listed 8192 output there, which capped the max output slider far below what the
	// models accept, and a 200K window with a priced 1M beta for models that serve 1M natively.
	it.each(CLAUDE_MODEL_LIMITS)(
		"%s / %s / %s has the documented limits on every platform",
		(anthropicId, vertexId, bedrockId, maxTokens, contextWindow) => {
			const entries = [
				...(anthropicId === null ? [] : [(anthropicModels as Record<string, ModelInfo>)[anthropicId]]),
				(vertexModels as Record<string, ModelInfo>)[vertexId],
				(bedrockModels as Record<string, ModelInfo>)[bedrockId],
			]

			for (const info of entries) {
				expect(info).toMatchObject({ maxTokens, contextWindow })
			}
		},
	)

	it("covers every Claude entry of the three tables", () => {
		const covered = new Set<string | null>(CLAUDE_MODEL_LIMITS.flatMap(([a, v, b]) => [a, v, b]))

		for (const [, table] of tables) {
			expect(Object.keys(table).filter((id) => id.includes("claude") && !covered.has(id))).toEqual([])
		}
	})

	// A model in a platform's 1M list is switched to its first tier when the beta is enabled, so it must
	// carry the long-context prices; without a tier it would be billed at the 200K prices above 200K.
	// Models with a native 1M window (Claude 4.6 and later) have no long-context premium and no beta.
	it.each(tables)(
		"%s: every 1M beta model prices the long context, native 1M models have no tier",
		(_p, table, ids) => {
			expect(ids.length).toBeGreaterThan(0)
			for (const id of ids) {
				const info = table[id]!
				const tier = info.tiers?.[0]

				expect(info.contextWindow).toBe(200_000)
				expect(tier?.contextWindow).toBe(1_000_000)
				expect(tier!.inputPrice!).toBeGreaterThan(info.inputPrice!)
				expect(tier!.outputPrice!).toBeGreaterThan(info.outputPrice!)
			}
			for (const [id, info] of Object.entries(table)) {
				if (id.includes("claude") && info.contextWindow === 1_000_000) {
					expect(info.tiers).toBeUndefined()
				}
			}
		},
	)

	it("price the same 1M tier for a model on every platform that offers the beta", () => {
		expect(vertexModels["claude-sonnet-4-5@20250929"].tiers).toEqual(anthropicModels["claude-sonnet-4-5"].tiers)
		expect(bedrockModels["anthropic.claude-sonnet-4-5-20250929-v1:0"].tiers).toEqual(
			anthropicModels["claude-sonnet-4-5"].tiers,
		)
		expect(bedrockModels["anthropic.claude-sonnet-4-20250514-v1:0"].tiers).toEqual(
			vertexModels["claude-sonnet-4@20250514"].tiers,
		)
	})

	// The Anthropic and Vertex handlers send no temperature (Anthropic API version 2026-10-21 rejects it), so
	// the settings must hide the control for every Claude model there, also for an unknown id. Bedrock and
	// MiniMax still send it.
	it("take temperature from no Claude model on Anthropic and Vertex, only on Bedrock and MiniMax", () => {
		const temperature = (apiProvider: ProviderName, apiModelId: string) =>
			resolveProviderModelSelection({ apiProvider, apiModelId })!.info.supportsTemperature !== false
		const claudeIds = (table: Record<string, ModelInfo>) => Object.keys(table).filter((id) => id.includes("claude"))

		for (const id of [...Object.keys(anthropicModels), "claude-next-preview", "proxy/claude-sonnet-4-5-x"]) {
			expect(temperature("anthropic", id), id).toBe(false)
		}
		for (const id of [...claudeIds(vertexModels), "claude-next-preview"]) {
			expect(temperature("vertex", id), id).toBe(false)
		}
		expect(temperature("vertex", "gemini-2.5-pro")).toBe(true)
		expect(
			(bedrockModels as Record<string, ModelInfo>)["anthropic.claude-sonnet-4-5-20250929-v1:0"]!
				.supportsTemperature,
		).not.toBe(false)
		for (const id of Object.keys(minimaxModels)) {
			expect(temperature("minimax", id), id).toBe(true)
		}
	})

	// Bedrock sends adaptive thinking for Opus 4.7+ and Haiku 5.5 by model id (isAdaptiveThinkingModel), the same
	// request it sends for the Claude 5 models, so the settings show the same on/off toggle there.
	it.each([
		["claude-opus-4-7", "claude-opus-4-7", "anthropic.claude-opus-4-7"],
		["claude-opus-4-8", "claude-opus-4-8", "anthropic.claude-opus-4-8"],
		["claude-haiku-5-5", "claude-haiku-5-5", "anthropic.claude-haiku-5-5"],
	] as const)("%s has the same reasoning flags on every platform", (anthropicId, vertexId, bedrockId) => {
		const flags = (info: ModelInfo) => ({
			supportsReasoningBudget: info.supportsReasoningBudget,
			supportsReasoningBinary: info.supportsReasoningBinary,
			supportsTemperature: info.supportsTemperature,
		})

		expect(flags(vertexModels[vertexId])).toEqual(flags(anthropicModels[anthropicId]))
		expect(flags(bedrockModels[bedrockId])).toEqual(flags(anthropicModels[anthropicId]))
	})

	// The three tables are derived from one record per model (providers/claude.ts). The fixture is the
	// Claude entries of the tables; when a model changes on purpose, update the record or the platform
	// override and the fixture together, and list the changed values in the plan doc.
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
