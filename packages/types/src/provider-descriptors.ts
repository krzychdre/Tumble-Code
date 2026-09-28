import type { ServiceTier } from "./model.js"
import type { ModelSourceOptions } from "./model-source.js"
import { zaiApiLineSchema } from "./provider-config/configs.js"
import { ANTHROPIC_1M_CONTEXT_MODEL_IDS } from "./provider-model-selection.js"
import { getProviderModelDefinition } from "./provider-models.js"
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
 *   provider whose settings are "API key, maybe an endpoint choice, URLs, checkboxes or a
 *   model-dependent choice" needs no component of its own. `custom` means a hand-written
 *   component in that directory (OAuth flows, fetched model lists, cloud credentials); `none` means the
 *   provider has no settings form (hidden providers).
 * - `service`: the name and link the model picker shows ("browse models at ...").
 * - `docsSlug`: the page under `providers/` on the docs site the settings link to.
 * - `modelPicker`: "in-form" when the provider's own form picks the model (fetched lists,
 *   OAuth), so the settings do not add the generic model picker below it.
 * - `modelSourceOptions`: for a provider whose model list is fetched, which settings keys the
 *   fetch request reads its base URL, API key and headers from.
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

/** A `ProviderSettings` key whose value is a boolean (feature toggles). */
export type ProviderBooleanSettingKey = {
	[K in keyof ProviderSettings]-?: NonNullable<ProviderSettings[K]> extends boolean ? K : never
}[keyof ProviderSettings]

/**
 * Which models a field is shown for. The model id is the one the settings resolve to: the
 * configured id, or the provider's default model when none (or an empty one) is configured,
 * which is also what the request uses (`resolveProviderFormModelId`).
 */
export type ProviderModelRule = { readonly modelIdStartsWith: string } | { readonly modelIdIn: readonly string[] }

type FieldVisibility = {
	/** Show the field only for these models; without it the field is always shown. */
	readonly visibleWhen?: ProviderModelRule
}

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
export type ProviderApiKeyFieldDescriptor = FieldVisibility & {
	readonly kind: "apiKey"
	/** i18n key of the field label. */
	readonly labelKey: string
	readonly getKeyUrl: ProviderGetKeyUrl
	/** i18n key of the link text. */
	readonly getKeyLabelKey: string
	/**
	 * `false`: render the trio directly in the form even below another field (OpenAI native,
	 * whose ungrouped base-URL checkbox sits above it). By default the trio is wrapped in its own
	 * group when it is not the first field.
	 */
	readonly grouped?: false
}

/** A dropdown that writes one of a fixed set of values (an endpoint or API line). */
export type ProviderSelectFieldDescriptor = FieldVisibility & {
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
 * A checkbox that writes a boolean setting, with an optional note under it. Inside an
 * `optionalUrl` field (`revealedFields`) it renders bare, under the URL, without the note.
 */
export type ProviderCheckboxFieldDescriptor = FieldVisibility & {
	readonly kind: "checkbox"
	readonly key: ProviderBooleanSettingKey
	/** i18n key of the checkbox label. */
	readonly labelKey: string
	/** i18n key of a note under the checkbox. */
	readonly descriptionKey?: string
}

/**
 * A dropdown whose options depend on the selected model: `baseOption` is always offered (and
 * shown while the setting is unset), each of `options` only when the selected model's `tiers`
 * list a tier of that name, in the order given here. Without any such tier the field is hidden.
 * The label and tooltip are shown as is (the OpenAI service tier has no translations).
 */
export type ProviderModelTierSelectFieldDescriptor = FieldVisibility & {
	readonly kind: "modelTierSelect"
	readonly key: ProviderStringSettingKey
	/** Label text, shown as is. */
	readonly label: string
	/** Tooltip text of the info icon next to the label, shown as is. */
	readonly tooltip?: string
	/** `data-testid` of the field's wrapper. */
	readonly testId?: string
	readonly baseOption: { readonly value: string; readonly label: string }
	readonly options: readonly { readonly value: ServiceTier; readonly label: string }[]
}

/** A URL field with a label above it and an optional note under it. */
export type ProviderUrlFieldDescriptor = FieldVisibility & {
	readonly kind: "url"
	readonly key: ProviderStringSettingKey
	/** i18n key of the field label. */
	readonly labelKey: string
	/** Placeholder text, shown as is (an example URL). */
	readonly placeholder: string
	/** i18n key of a note under the field. */
	readonly descriptionKey?: string
}

/** The URL field's placeholder: an i18n key, or text shown as is (an example URL). */
type PlaceholderText =
	| { readonly placeholderKey: string; readonly placeholder?: never }
	| { readonly placeholder: string; readonly placeholderKey?: never }

/**
 * A "Use custom base URL" checkbox that reveals a URL field (and `revealedFields` under it).
 * Ticking it writes nothing; unticking it clears the stored URL and then writes `alsoClear`,
 * in order, so settings that only make sense with a custom URL are reset with it.
 */
export type ProviderOptionalUrlFieldDescriptor = FieldVisibility &
	PlaceholderText & {
		readonly kind: "optionalUrl"
		readonly key: ProviderStringSettingKey
		/** i18n key of the checkbox label. */
		readonly toggleLabelKey: string
		/** `data-testid` of the checkbox input, for tests that tick it. */
		readonly toggleTestId?: string
		/**
		 * `false`: render the checkbox and the URL directly in the form, without the wrapping
		 * group (OpenAI native). By default they sit in their own `<div>`.
		 */
		readonly grouped?: false
		/** Values written after the URL is cleared, when the checkbox is unticked. */
		readonly alsoClear?: Readonly<Partial<ProviderSettings>>
		/** Checkboxes shown under the URL while the checkbox is ticked. */
		readonly revealedFields?: readonly Omit<ProviderCheckboxFieldDescriptor, "descriptionKey" | "visibleWhen">[]
	}

export type ProviderFieldDescriptor =
	| ProviderApiKeyFieldDescriptor
	| ProviderSelectFieldDescriptor
	| ProviderOptionalUrlFieldDescriptor
	| ProviderUrlFieldDescriptor
	| ProviderCheckboxFieldDescriptor
	| ProviderModelTierSelectFieldDescriptor

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
	/**
	 * "in-form": the provider's form has its own model selection, so the settings do not show
	 * the generic model picker. Without it, a provider with a static model list gets the
	 * generic picker.
	 */
	readonly modelPicker?: "in-form"
	/** For a fetched model list: the settings keys each request option is read from. */
	readonly modelSourceOptions?: ProviderModelSourceOptionKeys
}

/** For each model-source request option, a settings key holding a value of that option's type. */
export type ProviderModelSourceOptionKeys = {
	readonly [O in keyof ModelSourceOptions]?: {
		[K in keyof ProviderSettings]-?: NonNullable<ProviderSettings[K]> extends NonNullable<ModelSourceOptions[O]>
			? K
			: never
	}[keyof ProviderSettings]
}

const custom = { kind: "custom" } as const

/** The API key trio of a provider that has an API key settings key. */
const apiKey = (labelKey: string, getKeyLabelKey: string, getKeyUrl: ProviderGetKeyUrl) =>
	({ kind: "apiKey", labelKey, getKeyUrl, getKeyLabelKey }) as const

const zaiChinaLines = zaiApiLineSchema.options.filter((line) => zaiApiLineConfigs[line].isChina)

export const PROVIDER_DESCRIPTORS = {
	openrouter: { form: custom, docsSlug: "openrouter", modelPicker: "in-form" },
	litellm: {
		form: custom,
		docsSlug: "litellm",
		modelPicker: "in-form",
		modelSourceOptions: { liteLlmBaseUrl: "litellmBaseUrl", liteLlmApiKey: "litellmApiKey" },
	},
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
		modelSourceOptions: { baseUrl: "deepSeekBaseUrl", apiKey: "deepSeekApiKey" },
	},
	ollama: {
		form: custom,
		service: { name: "Ollama", url: "https://ollama.ai" },
		docsSlug: "ollama",
		modelPicker: "in-form",
		modelSourceOptions: { baseUrl: "ollamaBaseUrl", apiKey: "ollamaApiKey" },
	},
	lmstudio: {
		form: custom,
		service: { name: "LM Studio", url: "https://lmstudio.ai/docs" },
		docsSlug: "lmstudio",
		modelPicker: "in-form",
		modelSourceOptions: { baseUrl: "lmStudioBaseUrl" },
	},
	"vscode-lm": {
		form: custom,
		service: { name: "VS Code LM", url: "https://code.visualstudio.com/api/extension-guides/language-model" },
		docsSlug: "vscode-lm",
		modelPicker: "in-form",
	},
	openai: {
		form: custom,
		docsSlug: "openai-compatible",
		modelPicker: "in-form",
		modelSourceOptions: { baseUrl: "openAiBaseUrl", apiKey: "openAiApiKey", headers: "openAiHeaders" },
	},
	"fake-ai": { form: { kind: "none" } },
	anthropic: {
		form: {
			kind: "fields",
			fields: [
				apiKey(
					"settings:providers.anthropicApiKey",
					"settings:providers.getAnthropicApiKey",
					"https://console.anthropic.com/settings/keys",
				),
				{
					kind: "optionalUrl",
					key: "anthropicBaseUrl",
					toggleLabelKey: "settings:providers.useCustomBaseUrl",
					placeholder: "https://api.anthropic.com",
					// The auth-token switch only applies to a custom endpoint.
					alsoClear: { anthropicUseAuthToken: false },
					revealedFields: [
						{
							kind: "checkbox",
							key: "anthropicUseAuthToken",
							labelKey: "settings:providers.anthropicUseAuthToken",
						},
					],
				},
				{
					kind: "checkbox",
					key: "anthropicBeta1MContext",
					labelKey: "settings:providers.anthropic1MContextBetaLabel",
					descriptionKey: "settings:providers.anthropic1MContextBetaDescription",
					visibleWhen: { modelIdIn: ANTHROPIC_1M_CONTEXT_MODEL_IDS },
				},
			],
		},
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
					toggleTestId: "checkbox-custom-base-url",
					placeholderKey: "settings:defaults.geminiUrl",
				},
			],
		},
		service: { name: "Google Gemini", url: "https://ai.google.dev" },
		docsSlug: "gemini",
	},
	"gemini-cli": { form: { kind: "none" } },
	mistral: {
		form: {
			kind: "fields",
			fields: [
				apiKey(
					"settings:providers.mistralApiKey",
					"settings:providers.getMistralApiKey",
					"https://console.mistral.ai/",
				),
				{
					kind: "url",
					key: "mistralCodestralUrl",
					labelKey: "settings:providers.codestralBaseUrl",
					placeholder: "https://codestral.mistral.ai",
					descriptionKey: "settings:providers.codestralBaseUrlDesc",
					visibleWhen: { modelIdStartsWith: "codestral-" },
				},
			],
		},
		service: { name: "Mistral", url: "https://console.mistral.ai" },
		docsSlug: "mistral",
	},
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
	"openai-codex": { form: custom, docsSlug: "openai-codex", modelPicker: "in-form" },
	"openai-native": {
		form: {
			kind: "fields",
			fields: [
				{
					kind: "optionalUrl",
					key: "openAiNativeBaseUrl",
					toggleLabelKey: "settings:providers.useCustomBaseUrl",
					placeholder: "https://api.openai.com/v1",
					grouped: false,
				},
				{
					...apiKey(
						"settings:providers.openAiApiKey",
						"settings:providers.getOpenAiApiKey",
						"https://platform.openai.com/api-keys",
					),
					grouped: false,
				},
				{
					kind: "modelTierSelect",
					key: "openAiNativeServiceTier",
					label: "Service tier",
					tooltip:
						"For faster processing of API requests, try the priority processing service tier. For lower prices with higher latency, try the flex processing tier.",
					testId: "openai-service-tier",
					baseOption: { value: "default", label: "Standard" },
					options: [
						{ value: "flex", label: "Flex" },
						{ value: "priority", label: "Priority" },
					],
				},
			],
		},
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

/**
 * The model id the settings form sees: the configured id, or the provider's default model when
 * none (or an empty one) is configured, the same rule the request uses (`resolveCatalogModel`).
 * Z.ai's mainland default is not considered (no Z.ai field has a model rule).
 */
export const resolveProviderFormModelId = (provider: string | undefined, settings: ProviderSettings): string => {
	const definition = getProviderModelDefinition(provider)
	const field = definition?.modelIdField
	const configured = field && field !== "vsCodeLmModelSelector" ? settings[field] : undefined
	return configured || definition?.defaultModelId || ""
}

/** Whether a model id satisfies a field's `visibleWhen` rule. */
export const matchesProviderModelRule = (rule: ProviderModelRule, modelId: string): boolean =>
	"modelIdStartsWith" in rule ? modelId.startsWith(rule.modelIdStartsWith) : rule.modelIdIn.includes(modelId)

/** The providers whose own form selects the model (`modelPicker: "in-form"`), in table order. */
export const getInFormModelPickerProviderIds = (): DescribedProviderId[] =>
	(Object.keys(PROVIDER_DESCRIPTORS) as DescribedProviderId[]).filter(
		(provider) => (PROVIDER_DESCRIPTORS[provider] as ProviderDescriptor).modelPicker === "in-form",
	)

/**
 * The options of the model-list request for the settings' provider, read from the keys its
 * `modelSourceOptions` names (an unset key stays as an undefined option); `{}` for a provider
 * without a fetched list.
 */
export const resolveProviderModelSourceOptions = (settings: ProviderSettings): ModelSourceOptions => {
	const keys = getProviderDescriptor(settings.apiProvider)?.modelSourceOptions
	return keys ? Object.fromEntries(Object.entries(keys).map(([option, key]) => [option, settings[key]])) : {}
}
