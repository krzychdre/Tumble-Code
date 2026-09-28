import { zaiApiLineSchema } from "./provider-config/configs.js"
import type { ActiveProviderDefinition } from "./provider-registry.js"
import type { ProviderSettings } from "./provider-settings.js"
import { providerApiKeyFields } from "./provider-validation.js"
import { zaiApiLineConfigs } from "./providers/zai.js"

/**
 * Provider descriptors: what the settings UI needs to know about a provider, as data (S4).
 *
 * One row per executable provider (active and hidden lifecycles), keyed by provider id, so a
 * provider added to `providerRegistry` does not compile until it has a row here (the same
 * pattern as `TOOL_DESCRIPTORS` for tools). A row says:
 *
 * - `form`: how the webview renders the provider's settings. `fields` rows are rendered by the
 *   generic `ProviderDescriptorForm` (webview-ui/src/components/settings/providers/), so a
 *   provider whose settings are "API key, maybe an endpoint choice or a custom base URL" needs
 *   no component of its own. `custom` means a hand-written component in that directory (OAuth
 *   flows, fetched model lists, cloud credentials, model-dependent controls); `none` means the
 *   provider has no settings form (hidden providers).
 * - `service`: the name and link the model picker shows ("browse models at ...").
 * - `docsSlug`: the page under `providers/` on the docs site the settings link to.
 *
 * What is deliberately NOT repeated here, because it already has its own typed table keyed the
 * same way: the label, lifecycle and model source (`providerRegistry`), the model list, model-id
 * field and default model (`providerModelDefinitions`), the API key field
 * (`providerApiKeyFields`, which the `apiKey` field below reads) and the required fields
 * (`providerValidationRegistry`). The runtime handler and its capability flags stay in
 * `src/api/runtime-provider-registry.ts`.
 */

type DescribedProviderId = ActiveProviderDefinition["id"]

/** A `ProviderSettings` key whose value is a string (API keys, base URLs, enum choices). */
export type ProviderStringSettingKey = {
	[K in keyof ProviderSettings]-?: NonNullable<ProviderSettings[K]> extends string ? K : never
}[keyof ProviderSettings]

/**
 * Where the "get an API key" link points: a fixed URL, or one that depends on another setting
 * (the endpoint the user picked); `otherwise` covers an unset or unlisted value.
 */
export type ProviderGetKeyUrl =
	| string
	| {
			readonly field: ProviderStringSettingKey
			readonly byValue: Readonly<Record<string, string>>
			readonly otherwise: string
	  }

/**
 * The API key field, its storage notice and the "get an API key" link (shown while the key is
 * empty). The settings key is the provider's entry in `providerApiKeyFields`, so a provider
 * whose entry there is null cannot have this field (the table type below rejects it).
 */
export type ProviderApiKeyFieldDescriptor = {
	readonly kind: "apiKey"
	/** i18n key of the field label. */
	readonly labelKey: string
	readonly getKeyUrl: ProviderGetKeyUrl
	/** i18n key of the link text. */
	readonly getKeyLabelKey: string
}

/** A dropdown that writes one of a fixed set of values (an endpoint or API line). */
export type ProviderSelectFieldDescriptor = {
	readonly kind: "select"
	readonly key: ProviderStringSettingKey
	/** i18n key of the field label. */
	readonly labelKey: string
	/** i18n key of a note under the dropdown. */
	readonly descriptionKey?: string
	/**
	 * The value shown while the setting is unset (nothing is written until the user picks).
	 * Without it the dropdown shows the first option.
	 */
	readonly defaultValue?: string
	readonly options: readonly { readonly value: string; readonly label: string }[]
}

/**
 * A "Use custom base URL" checkbox that reveals a URL field. Ticking it writes nothing;
 * unticking it clears the stored URL.
 */
export type ProviderOptionalUrlFieldDescriptor = {
	readonly kind: "optionalUrl"
	readonly key: ProviderStringSettingKey
	/** i18n key of the checkbox label. */
	readonly toggleLabelKey: string
	/** i18n key of the URL field placeholder. */
	readonly placeholderKey: string
}

export type ProviderFieldDescriptor =
	| ProviderApiKeyFieldDescriptor
	| ProviderSelectFieldDescriptor
	| ProviderOptionalUrlFieldDescriptor

/** The fields a provider may use: no `apiKey` field without an API key settings key. */
type ProviderFieldDescriptorFor<P extends DescribedProviderId> = (typeof providerApiKeyFields)[P] extends null
	? Exclude<ProviderFieldDescriptor, ProviderApiKeyFieldDescriptor>
	: ProviderFieldDescriptor

export type ProviderFormDescriptor<P extends DescribedProviderId = DescribedProviderId> =
	| { readonly kind: "fields"; readonly fields: readonly ProviderFieldDescriptorFor<P>[] }
	| { readonly kind: "custom" }
	| { readonly kind: "none" }

export type ProviderDescriptor<P extends DescribedProviderId = DescribedProviderId> = {
	readonly form: ProviderFormDescriptor<P>
	/** Name and link of the service in the model picker; without it the picker shows the id and no link. */
	readonly service?: { readonly name: string; readonly url: string }
	/** Page under `providers/` on the docs site; without it the settings show no docs link. */
	readonly docsSlug?: string
}

const custom = { kind: "custom" } as const

/** The API key trio of a provider that has an API key settings key. */
const apiKey = (labelKey: string, getKeyLabelKey: string, getKeyUrl: ProviderGetKeyUrl) =>
	({ kind: "apiKey", labelKey, getKeyUrl, getKeyLabelKey }) as const

const zaiChinaLines = zaiApiLineSchema.options.filter((line) => zaiApiLineConfigs[line].isChina)

export const PROVIDER_DESCRIPTORS = {
	openrouter: { form: custom, docsSlug: "openrouter" },
	litellm: { form: custom, docsSlug: "litellm" },
	deepseek: {
		form: {
			kind: "fields",
			fields: [
				apiKey(
					"settings:providers.deepSeekApiKey",
					"settings:providers.getDeepSeekApiKey",
					"https://platform.deepseek.com/",
				),
			],
		},
		service: { name: "DeepSeek", url: "https://platform.deepseek.com" },
		docsSlug: "deepseek",
	},
	ollama: { form: custom, service: { name: "Ollama", url: "https://ollama.ai" }, docsSlug: "ollama" },
	lmstudio: { form: custom, service: { name: "LM Studio", url: "https://lmstudio.ai/docs" }, docsSlug: "lmstudio" },
	"vscode-lm": {
		form: custom,
		service: { name: "VS Code LM", url: "https://code.visualstudio.com/api/extension-guides/language-model" },
		docsSlug: "vscode-lm",
	},
	openai: { form: custom, docsSlug: "openai-compatible" },
	"fake-ai": { form: { kind: "none" } },
	anthropic: {
		form: custom,
		service: { name: "Anthropic", url: "https://console.anthropic.com" },
		docsSlug: "anthropic",
	},
	bedrock: {
		form: custom,
		service: { name: "Amazon Bedrock", url: "https://aws.amazon.com/bedrock" },
		docsSlug: "bedrock",
	},
	gemini: {
		form: {
			kind: "fields",
			fields: [
				apiKey(
					"settings:providers.geminiApiKey",
					"settings:providers.getGeminiApiKey",
					"https://ai.google.dev/",
				),
				{
					kind: "optionalUrl",
					key: "googleGeminiBaseUrl",
					toggleLabelKey: "settings:providers.useCustomBaseUrl",
					placeholderKey: "settings:defaults.geminiUrl",
				},
			],
		},
		service: { name: "Google Gemini", url: "https://ai.google.dev" },
		docsSlug: "gemini",
	},
	"gemini-cli": { form: { kind: "none" } },
	mistral: { form: custom, service: { name: "Mistral", url: "https://console.mistral.ai" }, docsSlug: "mistral" },
	moonshot: {
		form: {
			kind: "fields",
			fields: [
				{
					kind: "select",
					key: "moonshotBaseUrl",
					labelKey: "settings:providers.moonshotBaseUrl",
					options: [
						{ value: "https://api.moonshot.ai/v1", label: "api.moonshot.ai" },
						{ value: "https://api.moonshot.cn/v1", label: "api.moonshot.cn" },
					],
				},
				apiKey("settings:providers.moonshotApiKey", "settings:providers.getMoonshotApiKey", {
					field: "moonshotBaseUrl",
					byValue: { "https://api.moonshot.cn/v1": "https://platform.moonshot.cn/console/api-keys" },
					otherwise: "https://platform.moonshot.ai/console/api-keys",
				}),
			],
		},
		service: { name: "Moonshot", url: "https://platform.moonshot.cn" },
		docsSlug: "moonshot",
	},
	minimax: {
		form: {
			kind: "fields",
			fields: [
				{
					kind: "select",
					key: "minimaxBaseUrl",
					labelKey: "settings:providers.minimaxBaseUrl",
					options: [
						{ value: "https://api.minimax.io/v1", label: "api.minimax.io" },
						{ value: "https://api.minimaxi.com/v1", label: "api.minimaxi.com" },
					],
				},
				apiKey("settings:providers.minimaxApiKey", "settings:providers.getMiniMaxApiKey", {
					field: "minimaxBaseUrl",
					byValue: {
						"https://api.minimaxi.com/v1":
							"https://platform.minimaxi.com/user-center/basic-information/interface-key",
					},
					otherwise: "https://www.minimax.io/platform/user-center/basic-information/interface-key",
				}),
			],
		},
		service: { name: "MiniMax", url: "https://minimax.chat" },
		docsSlug: "minimax",
	},
	"openai-codex": { form: custom, docsSlug: "openai-codex" },
	"openai-native": {
		form: custom,
		service: { name: "OpenAI", url: "https://platform.openai.com" },
		docsSlug: "openai",
	},
	"qwen-code": {
		form: custom,
		service: { name: "Qwen Code", url: "https://dashscope.console.aliyun.com" },
		docsSlug: "qwen-code",
	},
	vertex: {
		form: custom,
		service: { name: "GCP Vertex AI", url: "https://console.cloud.google.com/vertex-ai" },
		docsSlug: "vertex",
	},
	xai: {
		form: {
			kind: "fields",
			fields: [
				apiKey("settings:providers.xaiApiKey", "settings:providers.getXaiApiKey", "https://api.x.ai/docs"),
			],
		},
		service: { name: "xAI", url: "https://x.ai" },
		docsSlug: "xai",
	},
	zai: {
		form: {
			kind: "fields",
			fields: [
				{
					kind: "select",
					key: "zaiApiLine",
					labelKey: "settings:providers.zaiEntrypoint",
					descriptionKey: "settings:providers.zaiEntrypointDescription",
					defaultValue: zaiApiLineSchema.enum.international_coding,
					options: zaiApiLineSchema.options.map((line) => ({
						value: line,
						label: `${zaiApiLineConfigs[line].name} (${zaiApiLineConfigs[line].baseUrl})`,
					})),
				},
				apiKey("settings:providers.zaiApiKey", "settings:providers.getZaiApiKey", {
					field: "zaiApiLine",
					byValue: Object.fromEntries(
						zaiChinaLines.map((line) => [line, "https://open.bigmodel.cn/console/overview"]),
					),
					otherwise: "https://z.ai/manage-apikey/apikey-list",
				}),
			],
		},
		service: { name: "Z.ai", url: "https://z.ai" },
		docsSlug: "zai",
	},
} as const satisfies { [P in DescribedProviderId]: ProviderDescriptor<P> }

type ProviderDescriptorTable = typeof PROVIDER_DESCRIPTORS

/** Providers whose settings form the generic descriptor form renders. */
export type DescriptorFormProviderId = {
	[P in DescribedProviderId]: ProviderDescriptorTable[P]["form"]["kind"] extends "fields" ? P : never
}[DescribedProviderId]

/** Providers with a hand-written settings component. */
export type CustomFormProviderId = {
	[P in DescribedProviderId]: ProviderDescriptorTable[P]["form"]["kind"] extends "custom" ? P : never
}[DescribedProviderId]

/** Providers without a settings form. */
export type NoFormProviderId = {
	[P in DescribedProviderId]: ProviderDescriptorTable[P]["form"]["kind"] extends "none" ? P : never
}[DescribedProviderId]

/** The descriptor of a provider id, or undefined for a retired or unknown id. */
export const getProviderDescriptor = (provider: string | undefined): ProviderDescriptor | undefined =>
	provider && Object.hasOwn(PROVIDER_DESCRIPTORS, provider)
		? PROVIDER_DESCRIPTORS[provider as DescribedProviderId]
		: undefined

/** The ids of the providers whose form the generic descriptor form renders, in table order. */
export const getDescriptorFormProviderIds = (): DescriptorFormProviderId[] =>
	(Object.keys(PROVIDER_DESCRIPTORS) as DescribedProviderId[]).filter(
		(provider): provider is DescriptorFormProviderId => PROVIDER_DESCRIPTORS[provider].form.kind === "fields",
	)

/** The "get an API key" URL for the current settings. */
export const resolveProviderGetKeyUrl = (getKeyUrl: ProviderGetKeyUrl, settings: ProviderSettings): string => {
	if (typeof getKeyUrl === "string") {
		return getKeyUrl
	}

	const value = settings[getKeyUrl.field]
	return typeof value === "string" && Object.hasOwn(getKeyUrl.byValue, value)
		? getKeyUrl.byValue[value]!
		: getKeyUrl.otherwise
}
