import { z } from "zod"

import { reasoningEffortSettingSchema, verbosityLevelsSchema } from "./model.js"
import { codebaseIndexProviderSchema } from "./codebase-index.js"
import { activeProviderIdsForPublicApi, providerIdsForPublicApi, retiredProviderIds } from "./provider-registry.js"
import { getProviderModelDefinition, providerModelDefinitions } from "./provider-models.js"
import { providerConfigSchemas } from "./provider-config/index.js"

/**
 * constants
 */

export const DEFAULT_CONSECUTIVE_MISTAKE_LIMIT = 3

/**
 * InternalProvider
 *
 * Internal providers require internal VSCode API calls in order to get the
 * model list.
 */

export const internalProviders = ["vscode-lm"] as const

export type InternalProvider = (typeof internalProviders)[number]

export const isInternalProvider = (key: string): key is InternalProvider =>
	internalProviders.includes(key as InternalProvider)

/**
 * CustomProvider
 *
 * Custom providers are completely configurable within Roo Code settings.
 */

export const customProviders = ["openai"] as const

export type CustomProvider = (typeof customProviders)[number]

export const isCustomProvider = (key: string): key is CustomProvider => customProviders.includes(key as CustomProvider)

/**
 * FauxProvider
 *
 * Faux providers do not make external inference calls and therefore do not have
 * model lists.
 */

export const fauxProviders = ["fake-ai"] as const

export type FauxProvider = (typeof fauxProviders)[number]

export const isFauxProvider = (key: string): key is FauxProvider => fauxProviders.includes(key as FauxProvider)

/**
 * ProviderName
 */

export const providerNames = activeProviderIdsForPublicApi

export const providerNamesSchema = z.enum(providerNames)

export type ProviderName = z.infer<typeof providerNamesSchema>

export const isProviderName = (key: unknown): key is ProviderName =>
	typeof key === "string" && providerNames.includes(key as ProviderName)

/**
 * RetiredProviderName
 */

export const retiredProviderNames = retiredProviderIds

export const retiredProviderNamesSchema = z.enum(retiredProviderNames)

export type RetiredProviderName = z.infer<typeof retiredProviderNamesSchema>

export const isRetiredProvider = (value: string): value is RetiredProviderName =>
	retiredProviderNames.includes(value as RetiredProviderName)

export const providerNamesWithRetired = providerIdsForPublicApi

export const providerNamesWithRetiredSchema = z.union([providerNamesSchema, retiredProviderNamesSchema])

export type ProviderNameWithRetired = z.infer<typeof providerNamesWithRetiredSchema>

/**
 * ProviderSettingsEntry
 */

export const providerSettingsEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	apiProvider: providerNamesWithRetiredSchema.optional(),
	modelId: z.string().optional(),
})

export type ProviderSettingsEntry = z.infer<typeof providerSettingsEntrySchema>

/**
 * ProviderSettings
 */

const baseProviderSettingsSchema = z.object({
	includeMaxTokens: z.boolean().optional(),
	todoListEnabled: z.boolean().optional(),
	modelTemperature: z.number().nullish(),
	rateLimitSeconds: z.number().optional(),
	consecutiveMistakeLimit: z.number().min(0).optional(),

	// Slim toolset: a profile-level switch that intersects the advertised tool
	// set down to a small, unambiguous allowlist. Small models pick the wrong
	// edit verb when six of them are offered; this is the per-profile answer.
	// Profiles follow modes through `modeApiConfigs`, so the restriction
	// recomputes on every mode switch without any persisted task state.
	// Plain optional booleans (never nullish) so profiles serialized with
	// exclude_none semantics simply omit them.
	slimToolset: z.boolean().optional(),
	// Whether the slim toolset also hides MCP tools. Only consulted while
	// `slimToolset` is on, where an undefined value means true (MCP schemas are
	// the single largest tool-prompt cost).
	slimHidesMcp: z.boolean().optional(),

	// Model reasoning.
	enableReasoningEffort: z.boolean().optional(),
	reasoningEffort: reasoningEffortSettingSchema.optional(),
	modelMaxTokens: z.number().optional(),
	modelMaxThinkingTokens: z.number().optional(),

	// Model verbosity.
	verbosity: verbosityLevelsSchema.optional(),
})

/**
 * The legacy flat arm of one provider: the shared profile settings above, the
 * provider's persisted config (`providerConfigSchemas`, the one list of its
 * fields) and its credentials. Credentials live in the secret store, so they
 * are the only provider fields the persisted config deliberately leaves out.
 */
const legacyProviderArm = <Config extends z.ZodRawShape, Credentials extends z.ZodRawShape>(
	config: z.ZodObject<Config, z.UnknownKeysParam>,
	credentials: Credentials,
) => baseProviderSettingsSchema.extend(config.shape).extend(credentials)

const optionalCredential = () => z.string().optional()

const anthropicSchema = legacyProviderArm(providerConfigSchemas.anthropic, { apiKey: optionalCredential() })
const openRouterSchema = legacyProviderArm(providerConfigSchemas.openrouter, { openRouterApiKey: optionalCredential() })
const bedrockSchema = legacyProviderArm(providerConfigSchemas.bedrock, {
	awsAccessKey: optionalCredential(),
	awsSecretKey: optionalCredential(),
	awsSessionToken: optionalCredential(),
	awsApiKey: optionalCredential(),
})
// `vertexJsonCredentials` is not in SECRET_STATE_KEYS either, so a saved vertex
// profile does not keep it (a known gap, tracked outside this schema).
const vertexSchema = legacyProviderArm(providerConfigSchemas.vertex, { vertexJsonCredentials: optionalCredential() })
const openAiSchema = legacyProviderArm(providerConfigSchemas.openai, { openAiApiKey: optionalCredential() })
const ollamaSchema = legacyProviderArm(providerConfigSchemas.ollama, { ollamaApiKey: optionalCredential() })
const vsCodeLmSchema = legacyProviderArm(providerConfigSchemas["vscode-lm"], {})
const lmStudioSchema = legacyProviderArm(providerConfigSchemas.lmstudio, {})
const geminiSchema = legacyProviderArm(providerConfigSchemas.gemini, { geminiApiKey: optionalCredential() })
const geminiCliSchema = legacyProviderArm(providerConfigSchemas["gemini-cli"], {})
// OpenAI Codex authenticates with OAuth, so it has no credential field.
const openAiCodexSchema = legacyProviderArm(providerConfigSchemas["openai-codex"], {})
const openAiNativeSchema = legacyProviderArm(providerConfigSchemas["openai-native"], {
	openAiNativeApiKey: optionalCredential(),
})
const mistralSchema = legacyProviderArm(providerConfigSchemas.mistral, { mistralApiKey: optionalCredential() })
const deepSeekSchema = legacyProviderArm(providerConfigSchemas.deepseek, { deepSeekApiKey: optionalCredential() })
const moonshotSchema = legacyProviderArm(providerConfigSchemas.moonshot, { moonshotApiKey: optionalCredential() })
const minimaxSchema = legacyProviderArm(providerConfigSchemas.minimax, { minimaxApiKey: optionalCredential() })
const fakeAiSchema = legacyProviderArm(providerConfigSchemas["fake-ai"], {})
const xaiSchema = legacyProviderArm(providerConfigSchemas.xai, { xaiApiKey: optionalCredential() })
const litellmSchema = legacyProviderArm(providerConfigSchemas.litellm, { litellmApiKey: optionalCredential() })
const qwenCodeSchema = legacyProviderArm(providerConfigSchemas["qwen-code"], {})
const zaiSchema = legacyProviderArm(providerConfigSchemas.zai, { zaiApiKey: optionalCredential() })

const defaultSchema = z.object({
	apiProvider: z.undefined(),
})

export const providerSettingsSchemaDiscriminated = z.discriminatedUnion("apiProvider", [
	anthropicSchema.merge(z.object({ apiProvider: z.literal("anthropic") })),
	openRouterSchema.merge(z.object({ apiProvider: z.literal("openrouter") })),
	bedrockSchema.merge(z.object({ apiProvider: z.literal("bedrock") })),
	vertexSchema.merge(z.object({ apiProvider: z.literal("vertex") })),
	openAiSchema.merge(z.object({ apiProvider: z.literal("openai") })),
	ollamaSchema.merge(z.object({ apiProvider: z.literal("ollama") })),
	vsCodeLmSchema.merge(z.object({ apiProvider: z.literal("vscode-lm") })),
	lmStudioSchema.merge(z.object({ apiProvider: z.literal("lmstudio") })),
	geminiSchema.merge(z.object({ apiProvider: z.literal("gemini") })),
	geminiCliSchema.merge(z.object({ apiProvider: z.literal("gemini-cli") })),
	openAiCodexSchema.merge(z.object({ apiProvider: z.literal("openai-codex") })),
	openAiNativeSchema.merge(z.object({ apiProvider: z.literal("openai-native") })),
	mistralSchema.merge(z.object({ apiProvider: z.literal("mistral") })),
	deepSeekSchema.merge(z.object({ apiProvider: z.literal("deepseek") })),
	moonshotSchema.merge(z.object({ apiProvider: z.literal("moonshot") })),
	minimaxSchema.merge(z.object({ apiProvider: z.literal("minimax") })),
	fakeAiSchema.merge(z.object({ apiProvider: z.literal("fake-ai") })),
	xaiSchema.merge(z.object({ apiProvider: z.literal("xai") })),
	litellmSchema.merge(z.object({ apiProvider: z.literal("litellm") })),
	zaiSchema.merge(z.object({ apiProvider: z.literal("zai") })),
	qwenCodeSchema.merge(z.object({ apiProvider: z.literal("qwen-code") })),
	defaultSchema,
])

export const providerSettingsSchema = z.object({
	apiProvider: providerNamesWithRetiredSchema.optional(),
	...anthropicSchema.shape,
	...openRouterSchema.shape,
	...bedrockSchema.shape,
	...vertexSchema.shape,
	...openAiSchema.shape,
	...ollamaSchema.shape,
	...vsCodeLmSchema.shape,
	...lmStudioSchema.shape,
	...geminiSchema.shape,
	...geminiCliSchema.shape,
	...openAiCodexSchema.shape,
	...openAiNativeSchema.shape,
	...mistralSchema.shape,
	...deepSeekSchema.shape,
	...moonshotSchema.shape,
	...minimaxSchema.shape,
	...fakeAiSchema.shape,
	...xaiSchema.shape,
	...litellmSchema.shape,
	...zaiSchema.shape,
	...qwenCodeSchema.shape,
	...codebaseIndexProviderSchema.shape,
})

export type ProviderSettings = z.infer<typeof providerSettingsSchema>

export const providerSettingsWithIdSchema = providerSettingsSchema.extend({ id: z.string().optional() })

export const discriminatedProviderSettingsWithIdSchema = providerSettingsSchemaDiscriminated.and(
	z.object({ id: z.string().optional() }),
)

export type ProviderSettingsWithId = z.infer<typeof providerSettingsWithIdSchema>

export const PROVIDER_SETTINGS_KEYS = providerSettingsSchema.keyof().options

/**
 * ModelIdKey
 */

export const modelIdKeys = [
	"apiModelId",
	"openRouterModelId",
	"openAiModelId",
	"ollamaModelId",
	"lmStudioModelId",
	"lmStudioDraftModelId",
	"litellmModelId",
] as const satisfies readonly (keyof ProviderSettings)[]

export type ModelIdKey = (typeof modelIdKeys)[number]

export const getModelId = (settings: ProviderSettings): string | undefined => {
	const modelIdKey = modelIdKeys.find((key) => settings[key])
	return modelIdKey ? settings[modelIdKey] : undefined
}

/**
 * TypicalProvider
 */

export type TypicalProvider = Exclude<ProviderName, InternalProvider | CustomProvider | FauxProvider>

export const isTypicalProvider = (key: unknown): key is TypicalProvider =>
	isProviderName(key) && !isInternalProvider(key) && !isCustomProvider(key) && !isFauxProvider(key)

/**
 * The model-id settings field of every typical provider, derived from
 * `providerModelDefinitions` (the one place that names it).
 */
export const modelIdKeysByProvider = Object.fromEntries(
	Object.entries(providerModelDefinitions)
		.filter(([provider]) => isTypicalProvider(provider))
		.map(([provider, definition]) => [provider, definition.modelIdField]),
) as Record<TypicalProvider, ModelIdKey>

// Compile-time check: every typical provider stores its model id in a plain
// model-id field, so the cast above cannot hide a selector or a missing field.
const typicalProvidersHaveModelIdKeys: {
	[P in TypicalProvider]: (typeof providerModelDefinitions)[P]["modelIdField"]
} extends Record<TypicalProvider, ModelIdKey>
	? true
	: never = true
void typicalProvidersHaveModelIdKeys

/**
 * The settings field that holds the model id of `provider`, or `undefined` when
 * the provider has no plain model-id field (`vscode-lm` stores a selector,
 * `fake-ai` takes its model from the injected handler, retired and unknown
 * providers have none). It must match the field the provider's handler reads.
 */
export const getModelIdKeyForProvider = (provider: string | undefined): ModelIdKey | undefined => {
	const field = getProviderModelDefinition(provider)?.modelIdField

	return field && field !== "vsCodeLmModelSelector" ? field : undefined
}

/**
 * The model id of the profile's own provider. Unlike `getModelId`, which takes
 * the first non-empty model-id field, this ignores fields left over from other
 * providers.
 */
export const getProviderModelId = (settings: ProviderSettings): string | undefined => {
	const field = getProviderModelDefinition(settings.apiProvider)?.modelIdField

	if (field === "vsCodeLmModelSelector") {
		return settings.vsCodeLmModelSelector?.id
	}

	return field ? settings[field] : undefined
}

/**
 * ANTHROPIC_STYLE_PROVIDERS
 */

// Providers that use Anthropic-style API protocol.
export const ANTHROPIC_STYLE_PROVIDERS: ProviderName[] = ["anthropic", "bedrock", "minimax"]

export const getApiProtocol = (provider: ProviderName | undefined, modelId?: string): "anthropic" | "openai" => {
	if (provider && ANTHROPIC_STYLE_PROVIDERS.includes(provider)) {
		return "anthropic"
	}

	if (provider && provider === "vertex" && modelId && modelId.toLowerCase().includes("claude")) {
		return "anthropic"
	}

	return "openai"
}
