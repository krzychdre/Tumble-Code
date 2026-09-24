// npx vitest utils/__tests__/cost.spec.ts

import * as rooTypes from "@roo-code/types"
import type { ModelInfo } from "@roo-code/types"

import { calculateApiCostAnthropic, calculateApiCostOpenAI } from "../../shared/cost"

describe("Cost Utility", () => {
	describe("calculateApiCostAnthropic", () => {
		const mockModelInfo: ModelInfo = {
			maxTokens: 8192,
			contextWindow: 200_000,
			supportsPromptCache: true,
			inputPrice: 3.0, // $3 per million tokens
			outputPrice: 15.0, // $15 per million tokens
			cacheWritesPrice: 3.75, // $3.75 per million tokens
			cacheReadsPrice: 0.3, // $0.30 per million tokens
		}

		it("should calculate basic input/output costs correctly", () => {
			const result = calculateApiCostAnthropic(mockModelInfo, 1000, 500)

			// Input cost: (3.0 / 1_000_000) * 1000 = 0.003
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Total: 0.003 + 0.0075 = 0.0105
			expect(result.totalCost).toBe(0.0105)
			expect(result.totalInputTokens).toBe(1000)
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle cache writes cost", () => {
			const result = calculateApiCostAnthropic(mockModelInfo, 1000, 500, 2000)

			// Input cost: (3.0 / 1_000_000) * 1000 = 0.003
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Cache writes: (3.75 / 1_000_000) * 2000 = 0.0075
			// Total: 0.003 + 0.0075 + 0.0075 = 0.018
			expect(result.totalCost).toBeCloseTo(0.018, 6)
			expect(result.totalInputTokens).toBe(3000) // 1000 + 2000
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle cache reads cost", () => {
			const result = calculateApiCostAnthropic(mockModelInfo, 1000, 500, undefined, 3000)

			// Input cost: (3.0 / 1_000_000) * 1000 = 0.003
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Cache reads: (0.3 / 1_000_000) * 3000 = 0.0009
			// Total: 0.003 + 0.0075 + 0.0009 = 0.0114
			expect(result.totalCost).toBe(0.0114)
			expect(result.totalInputTokens).toBe(4000) // 1000 + 3000
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle all cost components together", () => {
			const result = calculateApiCostAnthropic(mockModelInfo, 1000, 500, 2000, 3000)

			// Input cost: (3.0 / 1_000_000) * 1000 = 0.003
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Cache writes: (3.75 / 1_000_000) * 2000 = 0.0075
			// Cache reads: (0.3 / 1_000_000) * 3000 = 0.0009
			// Total: 0.003 + 0.0075 + 0.0075 + 0.0009 = 0.0189
			expect(result.totalCost).toBe(0.0189)
			expect(result.totalInputTokens).toBe(6000) // 1000 + 2000 + 3000
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle missing prices gracefully", () => {
			const modelWithoutPrices: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsPromptCache: true,
			}

			const result = calculateApiCostAnthropic(modelWithoutPrices, 1000, 500, 2000, 3000)
			expect(result.totalCost).toBe(0)
			expect(result.totalInputTokens).toBe(6000) // 1000 + 2000 + 3000
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle zero tokens", () => {
			const result = calculateApiCostAnthropic(mockModelInfo, 0, 0, 0, 0)
			expect(result.totalCost).toBe(0)
			expect(result.totalInputTokens).toBe(0)
			expect(result.totalOutputTokens).toBe(0)
		})

		it("should handle undefined cache values", () => {
			const result = calculateApiCostAnthropic(mockModelInfo, 1000, 500)

			// Input cost: (3.0 / 1_000_000) * 1000 = 0.003
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Total: 0.003 + 0.0075 = 0.0105
			expect(result.totalCost).toBe(0.0105)
			expect(result.totalInputTokens).toBe(1000)
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle missing cache prices", () => {
			const modelWithoutCachePrices: ModelInfo = {
				...mockModelInfo,
				cacheWritesPrice: undefined,
				cacheReadsPrice: undefined,
			}

			const result = calculateApiCostAnthropic(modelWithoutCachePrices, 1000, 500, 2000, 3000)

			// Without a write price the writes are billed at the input price (DEF-C39);
			// reads without a read price stay free.
			// Input cost: (3.0 / 1_000_000) * 1000 = 0.003
			// Cache writes at the input price: (3.0 / 1_000_000) * 2000 = 0.006
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Total: 0.003 + 0.006 + 0.0075 = 0.0165
			expect(result.totalCost).toBeCloseTo(0.0165, 12)
			expect(result.totalInputTokens).toBe(6000) // 1000 + 2000 + 3000
			expect(result.totalOutputTokens).toBe(500)
		})
	})

	describe("calculateApiCostOpenAI", () => {
		const mockModelInfo: ModelInfo = {
			maxTokens: 8192,
			contextWindow: 200_000,
			supportsPromptCache: true,
			inputPrice: 3.0, // $3 per million tokens
			outputPrice: 15.0, // $15 per million tokens
			cacheWritesPrice: 3.75, // $3.75 per million tokens
			cacheReadsPrice: 0.3, // $0.30 per million tokens
		}

		it("should calculate basic input/output costs correctly", () => {
			const result = calculateApiCostOpenAI(mockModelInfo, 1000, 500)

			// Input cost: (3.0 / 1_000_000) * 1000 = 0.003
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Total: 0.003 + 0.0075 = 0.0105
			expect(result.totalCost).toBe(0.0105)
			expect(result.totalInputTokens).toBe(1000)
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle cache writes cost", () => {
			const result = calculateApiCostOpenAI(mockModelInfo, 3000, 500, 2000)

			// Input cost: (3.0 / 1_000_000) * (3000 - 2000) = 0.003
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Cache writes: (3.75 / 1_000_000) * 2000 = 0.0075
			// Total: 0.003 + 0.0075 + 0.0075 = 0.018
			expect(result.totalCost).toBeCloseTo(0.018, 6)
			expect(result.totalInputTokens).toBe(3000) // Total already includes cache
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle cache reads cost", () => {
			const result = calculateApiCostOpenAI(mockModelInfo, 4000, 500, undefined, 3000)

			// Input cost: (3.0 / 1_000_000) * (4000 - 3000) = 0.003
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Cache reads: (0.3 / 1_000_000) * 3000 = 0.0009
			// Total: 0.003 + 0.0075 + 0.0009 = 0.0114
			expect(result.totalCost).toBe(0.0114)
			expect(result.totalInputTokens).toBe(4000) // Total already includes cache
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle all cost components together", () => {
			const result = calculateApiCostOpenAI(mockModelInfo, 6000, 500, 2000, 3000)

			// Input cost: (3.0 / 1_000_000) * (6000 - 2000 - 3000) = 0.003
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Cache writes: (3.75 / 1_000_000) * 2000 = 0.0075
			// Cache reads: (0.3 / 1_000_000) * 3000 = 0.0009
			// Total: 0.003 + 0.0075 + 0.0075 + 0.0009 = 0.0189
			expect(result.totalCost).toBe(0.0189)
			expect(result.totalInputTokens).toBe(6000) // Total already includes cache
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle missing prices gracefully", () => {
			const modelWithoutPrices: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsPromptCache: true,
			}

			const result = calculateApiCostOpenAI(modelWithoutPrices, 1000, 500, 2000, 3000)
			expect(result.totalCost).toBe(0)
			expect(result.totalInputTokens).toBe(1000) // Total already includes cache
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle zero tokens", () => {
			const result = calculateApiCostOpenAI(mockModelInfo, 0, 0, 0, 0)
			expect(result.totalCost).toBe(0)
			expect(result.totalInputTokens).toBe(0)
			expect(result.totalOutputTokens).toBe(0)
		})

		it("should handle undefined cache values", () => {
			const result = calculateApiCostOpenAI(mockModelInfo, 1000, 500)

			// Input cost: (3.0 / 1_000_000) * 1000 = 0.003
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Total: 0.003 + 0.0075 = 0.0105
			expect(result.totalCost).toBe(0.0105)
			expect(result.totalInputTokens).toBe(1000)
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should handle missing cache prices", () => {
			const modelWithoutCachePrices: ModelInfo = {
				...mockModelInfo,
				cacheWritesPrice: undefined,
				cacheReadsPrice: undefined,
			}

			const result = calculateApiCostOpenAI(modelWithoutCachePrices, 6000, 500, 2000, 3000)

			// Without a write price the writes are billed at the input price (DEF-C39);
			// reads without a read price stay free.
			// Input cost: (3.0 / 1_000_000) * (6000 - 2000 - 3000) = 0.003
			// Cache writes at the input price: (3.0 / 1_000_000) * 2000 = 0.006
			// Output cost: (15.0 / 1_000_000) * 500 = 0.0075
			// Total: 0.003 + 0.006 + 0.0075 = 0.0165
			expect(result.totalCost).toBeCloseTo(0.0165, 12)
			expect(result.totalInputTokens).toBe(6000) // Total already includes cache
			expect(result.totalOutputTokens).toBe(500)
		})

		it("should not apply long-context pricing at the threshold", () => {
			const modelWithLongContextPricing: ModelInfo = {
				...mockModelInfo,
				longContextPricing: {
					thresholdTokens: 272_000,
					inputPriceMultiplier: 2,
					outputPriceMultiplier: 1.5,
					cacheWritesPriceMultiplier: 2,
					cacheReadsPriceMultiplier: 2,
				},
			}

			const result = calculateApiCostOpenAI(modelWithLongContextPricing, 272_000, 1_000, undefined, 100_000)

			// Input cost: (3.0 / 1_000_000) * (272000 - 100000) = 0.516
			// Output cost: (15.0 / 1_000_000) * 1000 = 0.015
			// Cache reads: (0.3 / 1_000_000) * 100000 = 0.03
			// Total: 0.516 + 0.015 + 0.03 = 0.561
			expect(result.totalCost).toBeCloseTo(0.561, 6)
		})

		it("should apply long-context pricing above the threshold", () => {
			const modelWithLongContextPricing: ModelInfo = {
				maxTokens: 128_000,
				contextWindow: 1_050_000,
				supportsPromptCache: true,
				inputPrice: 2.5,
				outputPrice: 15.0,
				cacheWritesPrice: 5.0,
				cacheReadsPrice: 0.25,
				longContextPricing: {
					thresholdTokens: 272_000,
					inputPriceMultiplier: 2,
					outputPriceMultiplier: 1.5,
					cacheWritesPriceMultiplier: 2,
					cacheReadsPriceMultiplier: 2,
				},
			}

			const result = calculateApiCostOpenAI(modelWithLongContextPricing, 300_000, 1_000, 20_000, 100_000)

			// Input cost: (5.0 / 1_000_000) * (300000 - 20000 - 100000) = 0.9
			// Output cost: (22.5 / 1_000_000) * 1000 = 0.0225
			// Cache writes: (10.0 / 1_000_000) * 20000 = 0.2
			// Cache reads: (0.5 / 1_000_000) * 100000 = 0.05
			// Total: 0.9 + 0.0225 + 0.2 + 0.05 = 1.1725
			expect(result.totalCost).toBeCloseTo(1.1725, 6)
		})

		it("should skip long-context pricing for service tiers outside the allowed list", () => {
			const modelWithLongContextPricing: ModelInfo = {
				maxTokens: 128_000,
				contextWindow: 1_050_000,
				supportsPromptCache: true,
				inputPrice: 5.0,
				outputPrice: 30.0,
				cacheReadsPrice: 0.5,
				longContextPricing: {
					thresholdTokens: 272_000,
					inputPriceMultiplier: 2,
					outputPriceMultiplier: 1.5,
					appliesToServiceTiers: ["default", "flex"],
				},
			}

			const result = calculateApiCostOpenAI(
				modelWithLongContextPricing,
				300_000,
				1_000,
				undefined,
				100_000,
				"priority",
			)

			// Input cost: (5.0 / 1_000_000) * (300000 - 100000) = 1.0
			// Output cost: (30.0 / 1_000_000) * 1000 = 0.03
			// Cache reads: (0.5 / 1_000_000) * 100000 = 0.05
			// Total: 1.0 + 0.03 + 0.05 = 1.08
			expect(result.totalCost).toBeCloseTo(1.08, 6)
		})
	})

	describe("cache writes without a write price (DEF-C39)", () => {
		const base: ModelInfo = {
			maxTokens: 8192,
			contextWindow: 200_000,
			supportsPromptCache: true,
			inputPrice: 3.0,
			outputPrice: 15.0,
			cacheReadsPrice: 0.3,
		}

		it("bills reported writes at the input price when cacheWritesPrice is undefined (Anthropic protocol)", () => {
			const result = calculateApiCostAnthropic(base, 1000, 500, 2000, 3000)

			const expected = (1000 * 3.0 + 2000 * 3.0 + 3000 * 0.3 + 500 * 15.0) / 1_000_000
			expect(result.totalCost).toBeCloseTo(expected, 12)
		})

		it("bills reported writes at the input price when cacheWritesPrice is undefined (OpenAI protocol)", () => {
			const result = calculateApiCostOpenAI(base, 6000, 500, 2000, 3000)

			// Same as if the provider had not split the writes out of the input.
			const expected = (1000 * 3.0 + 2000 * 3.0 + 3000 * 0.3 + 500 * 15.0) / 1_000_000
			expect(result.totalCost).toBeCloseTo(expected, 12)
			expect(result.totalCost).toBeCloseTo(calculateApiCostOpenAI(base, 6000, 500, 0, 3000).totalCost, 12)
		})

		it("keeps an explicit cacheWritesPrice of 0 free", () => {
			const free = { ...base, cacheWritesPrice: 0 }

			expect(calculateApiCostAnthropic(free, 1000, 500, 2000, 3000).totalCost).toBeCloseTo(
				(1000 * 3.0 + 3000 * 0.3 + 500 * 15.0) / 1_000_000,
				12,
			)
			expect(calculateApiCostOpenAI(free, 6000, 500, 2000, 3000).totalCost).toBeCloseTo(
				(1000 * 3.0 + 3000 * 0.3 + 500 * 15.0) / 1_000_000,
				12,
			)
		})

		it("uses a defined cacheWritesPrice as is", () => {
			const priced = { ...base, cacheWritesPrice: 3.75 }

			expect(calculateApiCostAnthropic(priced, 1000, 500, 2000, 3000).totalCost).toBeCloseTo(
				(1000 * 3.0 + 2000 * 3.75 + 3000 * 0.3 + 500 * 15.0) / 1_000_000,
				12,
			)
			expect(calculateApiCostOpenAI(priced, 6000, 500, 2000, 3000).totalCost).toBeCloseTo(
				(1000 * 3.0 + 2000 * 3.75 + 3000 * 0.3 + 500 * 15.0) / 1_000_000,
				12,
			)
		})

		it("uses the long-context input price for writes above the threshold", () => {
			const longContext: ModelInfo = {
				...base,
				longContextPricing: { thresholdTokens: 272_000, inputPriceMultiplier: 2, outputPriceMultiplier: 1.5 },
			}

			const result = calculateApiCostOpenAI(longContext, 300_000, 1000, 100_000, 50_000)

			const expected = (150_000 * 6.0 + 100_000 * 6.0 + 50_000 * 0.3 + 1000 * 22.5) / 1_000_000
			expect(result.totalCost).toBeCloseTo(expected, 12)
		})
	})

	describe("catalog models are unaffected by the write-price fallback (DEF-C39)", () => {
		const isModelInfo = (value: unknown): value is ModelInfo =>
			!!value &&
			typeof value === "object" &&
			!Array.isArray(value) &&
			"contextWindow" in value &&
			"supportsPromptCache" in value

		// Every model table and every single ModelInfo exported by @roo-code/types,
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

		// The pricing before DEF-C39: writes at `cacheWritesPrice || 0`.
		const legacyCost = (
			info: ModelInfo,
			nonCachedInput: number,
			output: number,
			writes: number,
			reads: number,
		): number =>
			((info.cacheWritesPrice || 0) * writes +
				(info.cacheReadsPrice || 0) * reads +
				(info.inputPrice || 0) * nonCachedInput +
				(info.outputPrice || 0) * output) /
			1_000_000

		// Below every long-context threshold in the catalog.
		const [input, output, writes, reads] = [1000, 500, 2000, 3000]

		it("finds the model tables", () => {
			const tables = new Set(catalog.map((entry) => entry.table))
			for (const table of ["anthropicModels", "openAiNativeModels", "geminiModels", "bedrockModels"]) {
				expect(tables).toContain(table)
			}
			expect(catalog.length).toBeGreaterThan(200)
		})

		it("prices every model with a write price exactly as before, on both protocols", () => {
			const changed = catalog
				.filter(({ info }) => info.cacheWritesPrice !== undefined)
				.filter(({ info }) => {
					const expected = legacyCost(info, input, output, writes, reads)
					const anthropic = calculateApiCostAnthropic(info, input, output, writes, reads).totalCost
					const openAi = calculateApiCostOpenAI(info, input + writes + reads, output, writes, reads).totalCost
					return Math.abs(anthropic - expected) > 1e-12 || Math.abs(openAi - expected) > 1e-12
				})
				.map(({ table, id }) => `${table}/${id}`)

			expect(changed).toEqual([])
		})

		it("leaves models without a write price only in tables whose providers never report writes", () => {
			// No write price and a non-zero input price is where the fallback could
			// change a catalog cost. Each table below reaches the cost code with no
			// cache writes:
			// - openAiNativeModels: OpenAI reports only cached_tokens (and under the
			//   OpenAI protocol a write at the input price costs what plain input does).
			// - geminiModels, vertexModels (Gemini and MaaS ids): Gemini usage has no
			//   write field, and the MaaS models have no prompt cache.
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
			const exposed = catalog.filter(
				({ info }) => info.cacheWritesPrice === undefined && (info.inputPrice ?? 0) > 0,
			)

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

		it("prices every model without a write price as before for the usage its provider reports (no writes)", () => {
			const changed = catalog
				.filter(({ info }) => info.cacheWritesPrice === undefined)
				.filter(({ info }) => {
					const expected = legacyCost(info, input, output, 0, reads)
					const anthropic = calculateApiCostAnthropic(info, input, output, 0, reads).totalCost
					const openAi = calculateApiCostOpenAI(info, input + reads, output, 0, reads).totalCost
					return Math.abs(anthropic - expected) > 1e-12 || Math.abs(openAi - expected) > 1e-12
				})
				.map(({ table, id }) => `${table}/${id}`)

			expect(changed).toEqual([])
		})
	})
})
