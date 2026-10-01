import type { ModelInfo } from "@roo-code/types"
import type { ServiceTier } from "@roo-code/types"

export interface ApiCostResult {
	totalInputTokens: number
	totalOutputTokens: number
	totalCost: number
}

function applyLongContextPricing(modelInfo: ModelInfo, totalInputTokens: number, serviceTier?: ServiceTier): ModelInfo {
	const pricing = modelInfo.longContextPricing
	if (!pricing || totalInputTokens <= pricing.thresholdTokens) {
		return modelInfo
	}

	const effectiveServiceTier = serviceTier ?? "default"
	if (pricing.appliesToServiceTiers && !pricing.appliesToServiceTiers.includes(effectiveServiceTier)) {
		return modelInfo
	}

	return {
		...modelInfo,
		inputPrice:
			modelInfo.inputPrice !== undefined && pricing.inputPriceMultiplier !== undefined
				? modelInfo.inputPrice * pricing.inputPriceMultiplier
				: modelInfo.inputPrice,
		outputPrice:
			modelInfo.outputPrice !== undefined && pricing.outputPriceMultiplier !== undefined
				? modelInfo.outputPrice * pricing.outputPriceMultiplier
				: modelInfo.outputPrice,
		cacheWritesPrice:
			modelInfo.cacheWritesPrice !== undefined && pricing.cacheWritesPriceMultiplier !== undefined
				? modelInfo.cacheWritesPrice * pricing.cacheWritesPriceMultiplier
				: modelInfo.cacheWritesPrice,
		cacheReadsPrice:
			modelInfo.cacheReadsPrice !== undefined && pricing.cacheReadsPriceMultiplier !== undefined
				? modelInfo.cacheReadsPrice * pricing.cacheReadsPriceMultiplier
				: modelInfo.cacheReadsPrice,
	}
}

/**
 * How a provider counts input tokens:
 * - "anthropic": `inputTokens` is the uncached input only; cache writes and reads come on top.
 * - "openai": `inputTokens` is the whole prompt, cache writes and reads included.
 */
export type CostProtocol = "anthropic" | "openai"

export interface CostUsage {
	inputTokens: number
	outputTokens: number
	cacheWriteTokens?: number
	cacheReadTokens?: number
}

export interface CostOptions {
	/**
	 * The OpenAI service tier the request ran on. The tier of that name in `tiers` replaces the
	 * prices, and `longContextPricing.appliesToServiceTiers` is checked against it.
	 */
	serviceTier?: ServiceTier
	/**
	 * Price by prompt size (Gemini): the first unnamed tier whose `contextWindow` holds the whole
	 * input replaces the prices. Off by default because the Claude tables use `tiers` for the
	 * 1M-context variant, whose prices apply only when that variant is enabled.
	 */
	promptSizeTiers?: boolean
}

/** The model's prices after the service tier or the prompt-size tier is applied. */
export function selectTierPrices(
	modelInfo: ModelInfo,
	totalInputTokens: number,
	{ serviceTier, promptSizeTiers }: CostOptions = {},
): ModelInfo {
	const tier =
		serviceTier && serviceTier !== "default"
			? modelInfo.tiers?.find((candidate) => candidate.name === serviceTier)
			: promptSizeTiers
				? modelInfo.tiers?.find((candidate) => !candidate.name && totalInputTokens <= candidate.contextWindow)
				: undefined

	if (!tier) {
		return modelInfo
	}

	return {
		...modelInfo,
		inputPrice: tier.inputPrice ?? modelInfo.inputPrice,
		outputPrice: tier.outputPrice ?? modelInfo.outputPrice,
		cacheWritesPrice: tier.cacheWritesPrice ?? modelInfo.cacheWritesPrice,
		cacheReadsPrice: tier.cacheReadsPrice ?? modelInfo.cacheReadsPrice,
	}
}

/** The cost of one request in USD, with the model's prices per million tokens. */
export function calculateApiCost(
	protocol: CostProtocol,
	modelInfo: ModelInfo,
	usage: CostUsage,
	options: CostOptions = {},
): ApiCostResult {
	const cacheWriteTokens = usage.cacheWriteTokens || 0
	const cacheReadTokens = usage.cacheReadTokens || 0
	const { outputTokens } = usage

	const totalInputTokens =
		protocol === "anthropic" ? usage.inputTokens + cacheWriteTokens + cacheReadTokens : usage.inputTokens
	const uncachedInputTokens =
		protocol === "anthropic"
			? usage.inputTokens
			: Math.max(0, usage.inputTokens - cacheWriteTokens - cacheReadTokens)

	const prices = applyLongContextPricing(
		selectTierPrices(modelInfo, totalInputTokens, options),
		totalInputTokens,
		options.serviceTier,
	)

	// A model without a write price still pays for the tokens it writes: they
	// are input the provider processed, so they cost the input price (DEF-C39).
	// An explicit `cacheWritesPrice: 0` means the provider does not charge for
	// writes and stays free.
	const cacheWritesPrice = prices.cacheWritesPrice ?? prices.inputPrice ?? 0
	const cacheWritesCost = (cacheWritesPrice / 1_000_000) * cacheWriteTokens
	const cacheReadsCost = ((prices.cacheReadsPrice || 0) / 1_000_000) * cacheReadTokens
	const baseInputCost = ((prices.inputPrice || 0) / 1_000_000) * uncachedInputTokens
	const outputCost = ((prices.outputPrice || 0) / 1_000_000) * outputTokens

	return {
		totalInputTokens,
		totalOutputTokens: outputTokens,
		totalCost: cacheWritesCost + cacheReadsCost + baseInputCost + outputCost,
	}
}

export const parseApiPrice = (price: unknown) => (price ? parseFloat(price as string) * 1_000_000 : undefined)
