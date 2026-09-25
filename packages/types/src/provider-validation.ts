import { providerModelDefinitions } from "./provider-models.js"
import type { ProviderName, ProviderSettings } from "./provider-settings.js"

/**
 * The settings field that holds a provider's API key, or null when the
 * provider has no single API key: it signs in with OAuth (openai-codex,
 * qwen-code, gemini-cli), runs locally without one (lmstudio), borrows the
 * editor's models (vscode-lm), is the test provider (fake-ai), or resolves a
 * credential set from its cloud SDK (bedrock: AWS access keys, profile or API
 * key; vertex: a service-account file or JSON).
 *
 * A field listed here is not necessarily required: `providerRequiresApiKey`
 * says whether a profile is valid without it (Ollama takes an optional key for
 * a remote server).
 */
export const providerApiKeyFields = {
	openrouter: "openRouterApiKey",
	litellm: "litellmApiKey",
	deepseek: "deepSeekApiKey",
	ollama: "ollamaApiKey",
	lmstudio: null,
	"vscode-lm": null,
	openai: "openAiApiKey",
	"fake-ai": null,
	anthropic: "apiKey",
	bedrock: null,
	gemini: "geminiApiKey",
	"gemini-cli": null,
	mistral: "mistralApiKey",
	moonshot: "moonshotApiKey",
	minimax: "minimaxApiKey",
	"openai-codex": null,
	"openai-native": "openAiNativeApiKey",
	"qwen-code": null,
	vertex: null,
	xai: "xaiApiKey",
	zai: "zaiApiKey",
} as const satisfies { [provider in ProviderName]: keyof ProviderSettings | null }

export type ProviderValidationMessage =
	| "settings:validation.apiKey"
	| "settings:validation.awsRegion"
	| "settings:validation.googleCloud"
	| "settings:validation.openAi"
	| "settings:validation.modelId"
	| "settings:validation.modelSelector"
	| "settings:validation.qwenCodeOauthPath"

/**
 * What a provider profile must fill in before it can be used: nothing, or a
 * list of settings fields that must all be set, with the (i18n key of the)
 * message shown when one is missing.
 */
export type ProviderValidationStrategy =
	| { readonly kind: "none" }
	| {
			readonly kind: "required-fields"
			readonly fields: readonly (keyof ProviderSettings)[]
			readonly message: ProviderValidationMessage
	  }

const noValidation = { kind: "none" } as const
const apiKeyValidation = (provider: keyof typeof providerApiKeyFields) =>
	({
		kind: "required-fields",
		fields: [providerApiKeyFields[provider] as keyof ProviderSettings],
		message: "settings:validation.apiKey",
	}) as const

/**
 * The fields each provider requires. The settings UI refuses to save a
 * profile that misses one, and the CLI refuses to start a run without them
 * (API key and model id; it resolves the other fields its own way).
 */
export const providerValidationRegistry = {
	openrouter: apiKeyValidation("openrouter"),
	litellm: apiKeyValidation("litellm"),
	deepseek: apiKeyValidation("deepseek"),
	ollama: { kind: "required-fields", fields: ["ollamaModelId"], message: "settings:validation.modelId" },
	lmstudio: { kind: "required-fields", fields: ["lmStudioModelId"], message: "settings:validation.modelId" },
	"vscode-lm": {
		kind: "required-fields",
		fields: ["vsCodeLmModelSelector"],
		message: "settings:validation.modelSelector",
	},
	openai: {
		kind: "required-fields",
		fields: ["openAiBaseUrl", "openAiApiKey", "openAiModelId"],
		message: "settings:validation.openAi",
	},
	"fake-ai": noValidation,
	anthropic: apiKeyValidation("anthropic"),
	bedrock: { kind: "required-fields", fields: ["awsRegion"], message: "settings:validation.awsRegion" },
	gemini: apiKeyValidation("gemini"),
	"gemini-cli": noValidation,
	mistral: apiKeyValidation("mistral"),
	moonshot: apiKeyValidation("moonshot"),
	minimax: apiKeyValidation("minimax"),
	"openai-codex": noValidation,
	"openai-native": apiKeyValidation("openai-native"),
	"qwen-code": {
		kind: "required-fields",
		fields: ["qwenCodeOauthPath"],
		message: "settings:validation.qwenCodeOauthPath",
	},
	vertex: {
		kind: "required-fields",
		fields: ["vertexProjectId", "vertexRegion"],
		message: "settings:validation.googleCloud",
	},
	xai: apiKeyValidation("xai"),
	zai: apiKeyValidation("zai"),
} as const satisfies { [provider in ProviderName]: ProviderValidationStrategy }

const requiredFields = (provider: ProviderName): readonly string[] => {
	const strategy: ProviderValidationStrategy = providerValidationRegistry[provider]
	return strategy.kind === "required-fields" ? strategy.fields : []
}

/** The settings field that holds the provider's API key (null when it has none). */
export function getProviderApiKeyField(provider: ProviderName): keyof ProviderSettings | null {
	return providerApiKeyFields[provider]
}

/** True when a profile of this provider is not valid without its API key. */
export function providerRequiresApiKey(provider: ProviderName): boolean {
	const field = getProviderApiKeyField(provider)
	return field !== null && requiredFields(provider).includes(field)
}

/**
 * True when the user has to name the model: the provider has no default
 * model (its model list is whatever the user's server offers).
 */
export function providerRequiresModelId(provider: ProviderName): boolean {
	const field = providerModelDefinitions[provider].modelIdField
	return field !== null && requiredFields(provider).includes(field)
}
