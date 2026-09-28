import { z } from "zod"

import { activeProviderIds, retiredProviderIds } from "../provider-registry.js"
import {
	anthropicConfigSchema,
	bedrockConfigSchema,
	deepSeekConfigSchema,
	fakeAiConfigSchema,
	geminiCliConfigSchema,
	geminiConfigSchema,
	litellmConfigSchema,
	lmStudioConfigSchema,
	minimaxConfigSchema,
	mistralConfigSchema,
	moonshotConfigSchema,
	ollamaConfigSchema,
	openAiCodexConfigSchema,
	openAiConfigSchema,
	openAiNativeConfigSchema,
	openRouterConfigSchema,
	qwenCodeConfigSchema,
	vertexConfigSchema,
	vsCodeLmConfigSchema,
	xaiConfigSchema,
	zaiConfigSchema,
} from "./configs.js"
import { sharedProfileSettingsSchema } from "./shared.js"

export * from "./configs.js"
export * from "./compatibility.js"
export * from "./shared.js"

export type KnownProviderId = (typeof activeProviderIds)[number]
export type RetiredProviderId = (typeof retiredProviderIds)[number]

export const providerConfigSchemas = {
	anthropic: anthropicConfigSchema,
	openrouter: openRouterConfigSchema,
	bedrock: bedrockConfigSchema,
	vertex: vertexConfigSchema,
	openai: openAiConfigSchema,
	ollama: ollamaConfigSchema,
	"vscode-lm": vsCodeLmConfigSchema,
	lmstudio: lmStudioConfigSchema,
	gemini: geminiConfigSchema,
	"gemini-cli": geminiCliConfigSchema,
	"openai-codex": openAiCodexConfigSchema,
	"openai-native": openAiNativeConfigSchema,
	mistral: mistralConfigSchema,
	deepseek: deepSeekConfigSchema,
	moonshot: moonshotConfigSchema,
	minimax: minimaxConfigSchema,
	"fake-ai": fakeAiConfigSchema,
	xai: xaiConfigSchema,
	litellm: litellmConfigSchema,
	zai: zaiConfigSchema,
	"qwen-code": qwenCodeConfigSchema,
} satisfies { [K in KnownProviderId]: z.ZodTypeAny }

type ProviderConfigMap = {
	[K in KnownProviderId]: z.infer<(typeof providerConfigSchemas)[K] & z.ZodTypeAny>
}

export type ProviderConfig<K extends KnownProviderId = KnownProviderId> = ProviderConfigMap[K]
export type KnownProviderConfiguration<K extends KnownProviderId = KnownProviderId> = K extends KnownProviderId
	? { providerId: K; config: ProviderConfigMap[K] }
	: never

/**
 * The settings keys of each provider's credentials: API keys, access keys, pasted service-account
 * JSON. They are kept in VS Code's secret storage, never in the persisted profile config, so they
 * are deliberately absent from `providerConfigSchemas`; the legacy flat settings arms add them
 * (`provider-settings.ts`) and `SECRET_STATE_KEYS` lists them (`global-settings.ts`), both derived
 * from this table.
 */
export const providerCredentialFields = {
	anthropic: ["apiKey"],
	openrouter: ["openRouterApiKey"],
	bedrock: ["awsAccessKey", "awsSecretKey", "awsSessionToken", "awsApiKey"],
	vertex: ["vertexJsonCredentials"],
	openai: ["openAiApiKey"],
	ollama: ["ollamaApiKey"],
	"vscode-lm": [],
	lmstudio: [],
	gemini: ["geminiApiKey"],
	"gemini-cli": [],
	// OpenAI Codex authenticates with OAuth, so it has no credential field.
	"openai-codex": [],
	"openai-native": ["openAiNativeApiKey"],
	mistral: ["mistralApiKey"],
	deepseek: ["deepSeekApiKey"],
	moonshot: ["moonshotApiKey"],
	minimax: ["minimaxApiKey"],
	"fake-ai": [],
	xai: ["xaiApiKey"],
	litellm: ["litellmApiKey"],
	zai: ["zaiApiKey"],
	"qwen-code": [],
} as const satisfies { [K in KnownProviderId]: readonly string[] }

/** A settings key that holds a provider credential. */
export type ProviderCredentialField = (typeof providerCredentialFields)[KnownProviderId][number]

// Compile-time check: a credential is never also a persisted config field of the same provider
// (it would be written to the plain profile as well as to the secret storage).
const credentialsAreNotConfig: {
	[K in KnownProviderId]: Extract<
		(typeof providerCredentialFields)[K][number],
		keyof (typeof providerConfigSchemas)[K]["shape"]
	>
}[KnownProviderId] extends never
	? true
	: never = true
void credentialsAreNotConfig

/** The known provider ids in `providerConfigSchemas` order, which the generated schemas follow. */
export const knownProviderIds = Object.keys(providerConfigSchemas) as KnownProviderId[]

/** Every provider credential key, once, in `providerCredentialFields` order. */
export const providerCredentialKeys: readonly ProviderCredentialField[] = [
	...new Set(
		knownProviderIds.flatMap(
			(providerId): readonly ProviderCredentialField[] => providerCredentialFields[providerId],
		),
	),
]

const knownProviderConfigurationArm = <K extends KnownProviderId>(providerId: K) =>
	z.object({ providerId: z.literal(providerId), config: providerConfigSchemas[providerId] })

type KnownProviderConfigurationArm = {
	[K in KnownProviderId]: ReturnType<typeof knownProviderConfigurationArm<K>>
}[KnownProviderId]

/** One arm per known provider, generated from `providerConfigSchemas`. */
export const knownProviderConfigurationSchema = z.discriminatedUnion(
	"providerId",
	knownProviderIds.map(knownProviderConfigurationArm) as [
		KnownProviderConfigurationArm,
		...KnownProviderConfigurationArm[],
	],
)

export const retiredProviderConfigurationSchema = z.object({
	providerId: z.enum(retiredProviderIds),
	opaqueLegacyPayload: z.record(z.string(), z.unknown()),
})

export const unknownProviderConfigurationSchema = z.object({
	providerId: z.string(),
	opaqueLegacyPayload: z.record(z.string(), z.unknown()),
})

export type RetiredProviderConfiguration = z.infer<typeof retiredProviderConfigurationSchema>
export type UnknownProviderConfiguration = z.infer<typeof unknownProviderConfigurationSchema>
export type OpaqueProviderConfiguration = RetiredProviderConfiguration | UnknownProviderConfiguration

export const narrowedProviderSettingsSchema = z.object({
	provider: knownProviderConfigurationSchema,
	shared: sharedProfileSettingsSchema.optional(),
})

export type NarrowedProviderSettings = z.infer<typeof narrowedProviderSettingsSchema>

export const opaqueNarrowedProviderSettingsSchema = z.object({
	provider: z.union([retiredProviderConfigurationSchema, unknownProviderConfigurationSchema]),
})

export type OpaqueNarrowedProviderSettings = z.infer<typeof opaqueNarrowedProviderSettingsSchema>
