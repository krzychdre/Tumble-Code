import type { ModelInfo } from "../model.js"

// https://platform.deepseek.com/docs/api
// preserveReasoning enables interleaved thinking mode for tool calls:
// DeepSeek requires reasoning_content to be passed back during tool call
// continuation within the same turn. See: https://api-docs.deepseek.com/guides/thinking_mode
export type DeepSeekModelId = keyof typeof deepSeekModels

export const deepSeekDefaultModelId: DeepSeekModelId = "deepseek-flash"

// Catalog as documented on 2026-09-25 (see
// ai_plans/2026-09-25_deepseek-catalog-refresh.md for the sources):
// https://api-docs.deepseek.com/quick_start/pricing and
// https://api-docs.deepseek.com/api/list-models (context_window 1048576,
// max_output_tokens 393216, input modalities).
//
// DeepSeek prices vary by time of day: peak rates apply 01:00-04:00 and
// 06:00-10:00 UTC, Monday to Friday (except Chinese public holidays), and
// off-peak rates are exactly half. The figures below are the peak rates so
// cost estimates never come in under what the user is actually charged.
// A cache miss is ordinary input (there is no cache write fee), so
// cacheWritesPrice equals inputPrice.
const deepSeekFlashInfo = {
	maxTokens: 393_216,
	contextWindow: 1_048_576,
	supportsImages: true,
	supportsPromptCache: true,
	supportsReasoningEffort: ["disable", "low", "medium", "high", "xhigh"],
	preserveReasoning: true,
	reasoningEffort: "high",
	inputPrice: 0.3, // $0.30 per million tokens (cache miss, peak rate) - Updated Sep 25, 2026
	outputPrice: 1.2, // $1.20 per million tokens (peak rate) - Updated Sep 25, 2026
	cacheWritesPrice: 0.3, // $0.30 per million tokens (cache miss, peak rate) - Updated Sep 25, 2026
	cacheReadsPrice: 0.006, // $0.006 per million tokens (cache hit, peak rate) - Updated Sep 25, 2026
	description: `DeepSeek-V4.1-Flash is DeepSeek's fast, cost-efficient model with native image input. It supports thinking and non-thinking modes, JSON output, tool calls, chat prefix completion (beta), and FIM completion (beta) in non-thinking mode. Prices shown are peak rates; off-peak (outside 01:00-04:00 and 06:00-10:00 UTC on weekdays) is half.`,
} as const satisfies ModelInfo

export const deepSeekModels = {
	"deepseek-flash": deepSeekFlashInfo,
	"deepseek-v4-pro": {
		maxTokens: 393_216,
		contextWindow: 1_048_576,
		supportsImages: false,
		supportsPromptCache: true,
		supportsReasoningEffort: ["disable", "low", "medium", "high", "xhigh"],
		preserveReasoning: true,
		reasoningEffort: "high",
		inputPrice: 1.32, // $1.32 per million tokens (cache miss, peak rate) - Updated Sep 25, 2026
		outputPrice: 3.96, // $3.96 per million tokens (peak rate) - Updated Sep 25, 2026
		cacheWritesPrice: 1.32, // $1.32 per million tokens (cache miss, peak rate) - Updated Sep 25, 2026
		cacheReadsPrice: 0.044, // $0.044 per million tokens (cache hit, peak rate) - Updated Sep 25, 2026
		description: `DeepSeek-V4-Pro (0813) is DeepSeek's strongest model for reasoning, coding, long-context, and agentic workloads. Text input only. It supports thinking and non-thinking modes, JSON output, tool calls, chat prefix completion (beta), and FIM completion (beta) in non-thinking mode. Prices shown are peak rates; off-peak (outside 01:00-04:00 and 06:00-10:00 UTC on weekdays) is half.`,
	},
	// Retired on 2026-07-24 (change log of 2026-04-24) and no longer documented.
	// Kept only so an existing profile still resolves: the id is sent as
	// configured and the settings say the model is no longer available; the
	// model picker does not offer it.
	"deepseek-chat": {
		...deepSeekFlashInfo,
		deprecated: true,
		description: `Retired DeepSeek model name (was the non-thinking mode of deepseek-v4-flash). Select deepseek-flash instead.`,
	},
	"deepseek-reasoner": {
		...deepSeekFlashInfo,
		deprecated: true,
		description: `Retired DeepSeek model name (was the thinking mode of deepseek-v4-flash). Select deepseek-flash instead.`,
	},
} as const satisfies Record<string, ModelInfo>

/**
 * Legacy model names DeepSeek still accepts: V4 Flash and V4 Flash Vision Exp
 * were retired on 2026-09-10 and their names are served (and billed) as
 * DeepSeek-V4.1-Flash. They are sent to the API as configured and described
 * by deepseek-flash; the model picker lists only the current names.
 */
export const deepSeekModelAliases = {
	"deepseek-v4-flash": "deepseek-flash",
	"deepseek-v4-flash-vision-exp": "deepseek-flash",
} as const satisfies Record<string, DeepSeekModelId>

// https://api-docs.deepseek.com/quick_start/parameter_settings
export const DEEP_SEEK_DEFAULT_TEMPERATURE = 0.3
