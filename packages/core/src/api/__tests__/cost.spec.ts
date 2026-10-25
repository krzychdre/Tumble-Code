// npx vitest run src/api/__tests__/cost.spec.ts

import { anthropicModels, type ModelInfo } from "@tumble-code/types"

import { calculateApiCost, parseApiPrice, selectTierPrices, type CostOptions, type CostUsage } from "../cost.js"

// The whole module is scanned for model tables below. It is loaded through a variable so knip
// does not read that scan as a use of every @tumble-code/types export.
const typesModule = "@tumble-code/types"
const rooTypes: Record<string, unknown> = await import(typesModule)

const MODEL: ModelInfo = {
	maxTokens: 8192,
	contextWindow: 200_000,
	supportsPromptCache: true,
	inputPrice: 3,
	outputPrice: 15,
	cacheWritesPrice: 3.75,
	cacheReadsPrice: 0.3,
}

/** USD for token counts at prices per million. */
const usd = (...pairs: [tokens: number, price: number][]) =>
	pairs.reduce((sum, [tokens, price]) => sum + tokens * price, 0) / 1_000_000

describe("calculateApiCost", () => {
	it.each<[string, "anthropic" | "openai", ModelInfo, CostUsage, number, number]>([
		[
			"input and output",
			"anthropic",
			MODEL,
			{ inputTokens: 1000, outputTokens: 500 },
			1000,
			usd([1000, 3], [500, 15]),
		],
		[
			"Anthropic: cache tokens come on top of the input",
			"anthropic",
			MODEL,
			{ inputTokens: 1000, outputTokens: 500, cacheWriteTokens: 2000, cacheReadTokens: 3000 },
			6000,
			usd([1000, 3], [2000, 3.75], [3000, 0.3], [500, 15]),
		],
		[
			"OpenAI: cache tokens are part of the input",
			"openai",
			MODEL,
			{ inputTokens: 6000, outputTokens: 500, cacheWriteTokens: 2000, cacheReadTokens: 3000 },
			6000,
			usd([1000, 3], [2000, 3.75], [3000, 0.3], [500, 15]),
		],
		[
			"OpenAI: never a negative uncached input",
			"openai",
			MODEL,
			{ inputTokens: 1000, outputTokens: 0, cacheReadTokens: 3000 },
			1000,
			usd([3000, 0.3]),
		],
		[
			"a model without prices is free",
			"anthropic",
			{ contextWindow: 1, supportsPromptCache: true },
			{ inputTokens: 1000, outputTokens: 500, cacheWriteTokens: 1, cacheReadTokens: 1 },
			1002,
			0,
		],
		// DEF-C39: a write the provider reports is input it processed.
		[
			"writes without a write price cost the input price",
			"anthropic",
			{ ...MODEL, cacheWritesPrice: undefined },
			{ inputTokens: 1000, outputTokens: 500, cacheWriteTokens: 2000, cacheReadTokens: 3000 },
			6000,
			usd([1000, 3], [2000, 3], [3000, 0.3], [500, 15]),
		],
		[
			"an explicit write price of 0 stays free",
			"openai",
			{ ...MODEL, cacheWritesPrice: 0 },
			{ inputTokens: 6000, outputTokens: 500, cacheWriteTokens: 2000, cacheReadTokens: 3000 },
			6000,
			usd([1000, 3], [3000, 0.3], [500, 15]),
		],
		[
			"reads without a read price are free",
			"anthropic",
			{ ...MODEL, cacheReadsPrice: undefined },
			{ inputTokens: 1000, outputTokens: 0, cacheReadTokens: 3000 },
			4000,
			usd([1000, 3]),
		],
	])("prices %s", (_name, protocol, info, usage, totalInputTokens, totalCost) => {
		const result = calculateApiCost(protocol, info, usage)

		expect(result.totalInputTokens).toBe(totalInputTokens)
		expect(result.totalOutputTokens).toBe(usage.outputTokens)
		expect(result.totalCost).toBeCloseTo(totalCost, 12)
	})

	describe("long-context pricing", () => {
		const longContext: ModelInfo = {
			...MODEL,
			longContextPricing: {
				thresholdTokens: 272_000,
				inputPriceMultiplier: 2,
				outputPriceMultiplier: 1.5,
				cacheWritesPriceMultiplier: 2,
				cacheReadsPriceMultiplier: 3,
				appliesToServiceTiers: ["default", "flex"],
			},
		}
		const usage = (inputTokens: number) => ({
			inputTokens,
			outputTokens: 1000,
			cacheWriteTokens: 20_000,
			cacheReadTokens: 100_000,
		})
		const base = (input: number) => usd([input - 120_000, 3], [20_000, 3.75], [100_000, 0.3], [1000, 15])
		const raised = (input: number) => usd([input - 120_000, 6], [20_000, 7.5], [100_000, 0.9], [1000, 22.5])

		it.each<[string, number, CostOptions, ModelInfo, number]>([
			["not at the threshold", 272_000, {}, longContext, base(272_000)],
			["above the threshold, on the default tier", 300_000, {}, longContext, raised(300_000)],
			["above the threshold, on a listed tier", 300_000, { serviceTier: "flex" }, longContext, raised(300_000)],
			["not on a tier outside the list", 300_000, { serviceTier: "priority" }, longContext, base(300_000)],
			[
				"only to the prices it has a multiplier for",
				300_000,
				{},
				{ ...MODEL, longContextPricing: { thresholdTokens: 272_000, inputPriceMultiplier: 2 } },
				usd([180_000, 6], [20_000, 3.75], [100_000, 0.3], [1000, 15]),
			],
			[
				"its input price to writes without a write price",
				300_000,
				{},
				{ ...longContext, cacheWritesPrice: undefined },
				usd([180_000, 6], [20_000, 6], [100_000, 0.9], [1000, 22.5]),
			],
		])("applies %s", (_name, input, options, info, expected) => {
			expect(calculateApiCost("openai", info, usage(input), options).totalCost).toBeCloseTo(expected, 9)
		})
	})

	// Claude Haiku 5.5 is priced by prompt length (pricing page, 2026-10-17): a request whose prompt is
	// over 100K tokens, cache reads and writes included, pays five times every price.
	it.each([
		[50_000, usd([50_000, 0.1], [10_000, 0.125], [40_000, 0.01], [2_000, 0.5])],
		[50_001, usd([50_001, 0.5], [10_000, 0.625], [40_000, 0.05], [2_000, 2.5])],
	])("bills Claude Haiku 5.5 by prompt length (%i uncached input tokens)", (inputTokens, expected) => {
		const usage = { inputTokens, outputTokens: 2_000, cacheWriteTokens: 10_000, cacheReadTokens: 40_000 }

		expect(calculateApiCost("anthropic", anthropicModels["claude-haiku-5-5"], usage).totalCost).toBeCloseTo(
			expected,
			12,
		)
	})
})

describe("selectTierPrices", () => {
	const base: ModelInfo = { contextWindow: 1_000_000, supportsPromptCache: true, inputPrice: 2, outputPrice: 10 }

	it("prices a named service tier only when that tier is requested, keeping prices it does not set", () => {
		const info: ModelInfo = { ...base, tiers: [{ name: "flex", contextWindow: 1_000_000, inputPrice: 1 }] }

		expect(selectTierPrices(info, 0, { serviceTier: "flex" })).toMatchObject({ inputPrice: 1, outputPrice: 10 })
		expect(selectTierPrices(info, 0, { serviceTier: "default" }).inputPrice).toBe(2)
		expect(selectTierPrices(info, 0, { serviceTier: "priority" }).inputPrice).toBe(2)
	})

	it("prices by prompt size only when asked, and only with unnamed tiers", () => {
		const info: ModelInfo = {
			...base,
			tiers: [
				{ contextWindow: 200_000, inputPrice: 1, outputPrice: 5 },
				{ contextWindow: Infinity, inputPrice: 4, outputPrice: 20 },
			],
		}

		expect(selectTierPrices(info, 150_000, { promptSizeTiers: true }).inputPrice).toBe(1)
		expect(selectTierPrices(info, 250_000, { promptSizeTiers: true }).inputPrice).toBe(4)
		// A Claude 1M-context tier applies only with prompt-size pricing.
		expect(selectTierPrices(info, 150_000).inputPrice).toBe(2)
		expect(
			selectTierPrices({ ...info, tiers: [{ name: "flex", contextWindow: Infinity, inputPrice: 9 }] }, 1, {
				promptSizeTiers: true,
			}).inputPrice,
		).toBe(2)
	})
})

it.each([
	["0.000003", 3],
	[0.000015, 15],
	["", undefined],
	[undefined, undefined],
	[0, undefined],
])("parseApiPrice turns the per-token price %j into %s per million", (price, expected) => {
	const parsed = parseApiPrice(price)

	if (expected === undefined) {
		expect(parsed).toBeUndefined()
	} else {
		expect(parsed).toBeCloseTo(expected, 9)
	}
})

describe("catalog models the write-price fallback could reprice (DEF-C39)", () => {
	const isModelInfo = (value: unknown): value is ModelInfo =>
		!!value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		"contextWindow" in value &&
		"supportsPromptCache" in value

	// Every model table and every single ModelInfo exported by @tumble-code/types,
	// with each pricing tier merged over its model.
	const catalog: { table: string; id: string; info: ModelInfo }[] = []
	for (const [name, value] of Object.entries(rooTypes)) {
		if (isModelInfo(value)) {
			catalog.push({ table: name, id: name, info: value })
			continue
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) continue
		const entries = Object.entries(value)
		if (entries.length === 0 || !entries.every(([, entry]) => isModelInfo(entry))) continue
		for (const [id, info] of entries as [string, ModelInfo][]) {
			catalog.push({ table: name, id, info })
			for (const [index, tier] of (info.tiers ?? []).entries()) {
				catalog.push({ table: name, id: `${id} (tier ${index})`, info: { ...info, ...tier } })
			}
		}
	}

	it("leaves models without a write price only in tables whose providers never report writes", () => {
		// No write price and a non-zero input price is where the fallback could
		// change a catalog cost. Each table below reaches the cost code with no
		// cache writes:
		// - openAiNativeModels: OpenAI reports only cached_tokens (and under the
		//   OpenAI protocol a write at the input price costs what plain input does).
		// - geminiModels, vertexModels (Gemini ids): Gemini usage has no write field.
		// - moonshotModels: the handler hardcodes cacheWriteTokens 0.
		// - bedrockModels, mistralModels: only models without prompt caching.
		const neverWrites = new Set([
			"openAiNativeModels",
			"geminiModels",
			"vertexModels",
			"moonshotModels",
			"bedrockModels",
			"mistralModels",
		])
		const exposed = catalog.filter(({ info }) => info.cacheWritesPrice === undefined && (info.inputPrice ?? 0) > 0)

		expect(exposed.length).toBeGreaterThan(0)
		expect(exposed.filter(({ table }) => !neverWrites.has(table)).map(({ table, id }) => `${table}/${id}`)).toEqual(
			[],
		)
		for (const table of ["bedrockModels", "mistralModels"]) {
			expect(
				exposed.filter((entry) => entry.table === table && entry.info.supportsPromptCache).map(({ id }) => id),
			).toEqual([])
		}
		// Vertex Claude models all carry a write price.
		expect(exposed.filter(({ table, id }) => table === "vertexModels" && id.startsWith("claude"))).toEqual([])
	})
})
