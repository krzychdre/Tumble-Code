import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { ModelInfo } from "../model.js"

import { ANTHROPIC_1M_CONTEXT_MODEL_IDS, anthropicModels } from "../providers/anthropic.js"
import { BEDROCK_1M_CONTEXT_MODEL_IDS, bedrockModels } from "../providers/bedrock.js"
import { claudeModels } from "../providers/claude.js"
import { litellmDefaultModelId } from "../providers/lite-llm.js"
import { OPEN_ROUTER_PROMPT_CACHING_MODELS, OPEN_ROUTER_REASONING_BUDGET_MODELS } from "../providers/openrouter.js"
import { VERTEX_1M_CONTEXT_MODEL_IDS, vertexModels } from "../providers/vertex.js"

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
	["claude-sonnet-5", "claude-sonnet-5", "anthropic.claude-sonnet-5", 128_000, 1_000_000],
	["claude-opus-4-8", "claude-opus-4-8", "anthropic.claude-opus-4-8", 128_000, 1_000_000],
	["claude-opus-4-7", "claude-opus-4-7", "anthropic.claude-opus-4-7", 128_000, 1_000_000],
	["claude-opus-4-6", "claude-opus-4-6", "anthropic.claude-opus-4-6-v1", 128_000, 1_000_000],
	["claude-sonnet-4-6", "claude-sonnet-4-6", "anthropic.claude-sonnet-4-6", 128_000, 1_000_000],
	["claude-fable-5-1", "claude-fable-5-1", "anthropic.claude-fable-5-1", 128_000, 1_000_000],
	["claude-fable-5", "claude-fable-5", "anthropic.claude-fable-5", 128_000, 1_000_000],
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

	it("drop the models retired on the Claude API from the Anthropic table only", () => {
		expect(Object.keys(anthropicModels).filter((id) => RETIRED_ON_CLAUDE_API.includes(id))).toEqual([])
		expect(vertexModels["claude-sonnet-4@20250514"]).toBeDefined()
		expect(bedrockModels["anthropic.claude-opus-4-20250514-v1:0"]).toBeDefined()
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

	// Bedrock sends adaptive thinking for Opus 4.7+ by model id (isAdaptiveThinkingModel), the same
	// request it sends for the Claude 5 models, so the settings show the same on/off toggle there.
	it.each([
		["claude-opus-4-7", "claude-opus-4-7", "anthropic.claude-opus-4-7"],
		["claude-opus-4-8", "claude-opus-4-8", "anthropic.claude-opus-4-8"],
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
