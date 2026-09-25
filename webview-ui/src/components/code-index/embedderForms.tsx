import React from "react"
import { z } from "zod"

import type { EmbedderProvider } from "@roo-code/types"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@src/components/ui"
import { OPENROUTER_DEFAULT_PROVIDER_NAME } from "@src/components/ui/hooks/useOpenRouterModelProviders"

import { DEFAULT_OLLAMA_URL, type CodeIndexSettingKey, type CodeIndexTranslate } from "./codeIndexSettings"
import {
	ApiKeyAndModelFields,
	ModelDimensionField,
	ModelDropdownField,
	ModelIdTextField,
	SettingTextField,
	type EmbedderFormContext,
} from "./EmbedderFormFields"

type EmbedderFormDefinition = {
	/** Label of the provider in the embedder provider dropdown. */
	readonly labelKey: string
	/** The provider's API key, when it has one: the setting and the `codeIndexSecretStatus` flag that reports it stored. */
	readonly secret?: { readonly field: CodeIndexSettingKey; readonly statusFlag: string }
	/** Validation added on top of the shared Qdrant fields. */
	readonly schema: (t: CodeIndexTranslate) => z.ZodRawShape
	readonly render: (context: EmbedderFormContext) => React.ReactNode
}

const modelSelectionRequired = (t: CodeIndexTranslate) =>
	z.string().min(1, t("settings:codeIndex.validation.modelSelectionRequired"))

/** Provider routing for the OpenRouter embedding model, shown once the model's providers are known. */
const OpenRouterProviderRouting = ({ context }: { context: EmbedderFormContext }) => {
	const { settings, updateSetting, openRouterEmbeddingProviders, t } = context
	if (!openRouterEmbeddingProviders || Object.keys(openRouterEmbeddingProviders).length === 0) {
		return null
	}
	return (
		<div className="space-y-2">
			<label className="text-sm font-medium">
				<a
					href="https://openrouter.ai/docs/features/provider-routing"
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1 hover:underline">
					{t("settings:codeIndex.openRouterProviderRoutingLabel")}
					<span className="codicon codicon-link-external text-xs" />
				</a>
			</label>
			<Select
				value={settings.codebaseIndexOpenRouterSpecificProvider || OPENROUTER_DEFAULT_PROVIDER_NAME}
				onValueChange={(value) => updateSetting("codebaseIndexOpenRouterSpecificProvider", value)}>
				<SelectTrigger className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={OPENROUTER_DEFAULT_PROVIDER_NAME}>{OPENROUTER_DEFAULT_PROVIDER_NAME}</SelectItem>
					{Object.entries(openRouterEmbeddingProviders).map(([value, { label }]) => (
						<SelectItem key={value} value={value}>
							{label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-xs text-vscode-descriptionForeground mt-1 mb-0">
				{t("settings:codeIndex.openRouterProviderRoutingDescription")}
			</p>
		</div>
	)
}

/**
 * One entry per embedder provider, in the order the provider dropdown lists them.
 * `satisfies` makes a new `EmbedderProvider` a compile error until it gets a form.
 */
export const EMBEDDER_FORMS = {
	openai: {
		labelKey: "settings:codeIndex.openaiProvider",
		secret: { field: "codeIndexOpenAiKey", statusFlag: "hasOpenAiKey" },
		schema: (t) => ({
			codeIndexOpenAiKey: z.string().min(1, t("settings:codeIndex.validation.openaiApiKeyRequired")),
			codebaseIndexEmbedderModelId: modelSelectionRequired(t),
		}),
		render: (context) => (
			<ApiKeyAndModelFields
				context={context}
				apiKeyField="codeIndexOpenAiKey"
				apiKeyLabelKey="settings:codeIndex.openAiKeyLabel"
				apiKeyPlaceholderKey="settings:codeIndex.openAiKeyPlaceholder"
			/>
		),
	},
	ollama: {
		labelKey: "settings:codeIndex.ollamaProvider",
		schema: (t) => ({
			codebaseIndexEmbedderBaseUrl: z
				.string()
				.min(1, t("settings:codeIndex.validation.ollamaBaseUrlRequired"))
				.url(t("settings:codeIndex.validation.invalidOllamaUrl")),
			codebaseIndexEmbedderModelId: z.string().min(1, t("settings:codeIndex.validation.modelIdRequired")),
			codebaseIndexEmbedderModelDimension: z
				.number()
				.min(1, t("settings:codeIndex.validation.modelDimensionRequired"))
				.optional(),
		}),
		render: (context) => (
			<>
				<SettingTextField
					context={context}
					field="codebaseIndexEmbedderBaseUrl"
					labelKey="settings:codeIndex.ollamaBaseUrlLabel"
					placeholderKey="settings:codeIndex.ollamaUrlPlaceholder"
					onBlur={(e: any) => {
						// Set default Ollama URL if field is empty
						if (!e.target.value.trim()) {
							e.target.value = DEFAULT_OLLAMA_URL
							context.updateSetting("codebaseIndexEmbedderBaseUrl", DEFAULT_OLLAMA_URL)
						}
					}}
				/>
				<ModelIdTextField context={context} />
				<ModelDimensionField context={context} />
			</>
		),
	},
	"openai-compatible": {
		labelKey: "settings:codeIndex.openaiCompatibleProvider",
		secret: { field: "codebaseIndexOpenAiCompatibleApiKey", statusFlag: "hasOpenAiCompatibleApiKey" },
		schema: (t) => ({
			codebaseIndexOpenAiCompatibleBaseUrl: z
				.string()
				.min(1, t("settings:codeIndex.validation.baseUrlRequired"))
				.url(t("settings:codeIndex.validation.invalidBaseUrl")),
			codebaseIndexOpenAiCompatibleApiKey: z.string().min(1, t("settings:codeIndex.validation.apiKeyRequired")),
			codebaseIndexEmbedderModelId: z.string().min(1, t("settings:codeIndex.validation.modelIdRequired")),
			codebaseIndexEmbedderModelDimension: z
				.number()
				.min(1, t("settings:codeIndex.validation.modelDimensionRequired")),
		}),
		render: (context) => (
			<>
				<SettingTextField
					context={context}
					field="codebaseIndexOpenAiCompatibleBaseUrl"
					labelKey="settings:codeIndex.openAiCompatibleBaseUrlLabel"
					placeholderKey="settings:codeIndex.openAiCompatibleBaseUrlPlaceholder"
				/>
				<SettingTextField
					context={context}
					field="codebaseIndexOpenAiCompatibleApiKey"
					labelKey="settings:codeIndex.openAiCompatibleApiKeyLabel"
					placeholderKey="settings:codeIndex.openAiCompatibleApiKeyPlaceholder"
					type="password"
				/>
				<ModelIdTextField context={context} />
				<ModelDimensionField context={context} />
			</>
		),
	},
	gemini: {
		labelKey: "settings:codeIndex.geminiProvider",
		secret: { field: "codebaseIndexGeminiApiKey", statusFlag: "hasGeminiApiKey" },
		schema: (t) => ({
			codebaseIndexGeminiApiKey: z.string().min(1, t("settings:codeIndex.validation.geminiApiKeyRequired")),
			codebaseIndexEmbedderModelId: modelSelectionRequired(t),
		}),
		render: (context) => (
			<ApiKeyAndModelFields
				context={context}
				apiKeyField="codebaseIndexGeminiApiKey"
				apiKeyLabelKey="settings:codeIndex.geminiApiKeyLabel"
				apiKeyPlaceholderKey="settings:codeIndex.geminiApiKeyPlaceholder"
			/>
		),
	},
	mistral: {
		labelKey: "settings:codeIndex.mistralProvider",
		secret: { field: "codebaseIndexMistralApiKey", statusFlag: "hasMistralApiKey" },
		schema: (t) => ({
			codebaseIndexMistralApiKey: z.string().min(1, t("settings:codeIndex.validation.mistralApiKeyRequired")),
			codebaseIndexEmbedderModelId: modelSelectionRequired(t),
		}),
		render: (context) => (
			<ApiKeyAndModelFields
				context={context}
				apiKeyField="codebaseIndexMistralApiKey"
				apiKeyLabelKey="settings:codeIndex.mistralApiKeyLabel"
				apiKeyPlaceholderKey="settings:codeIndex.mistralApiKeyPlaceholder"
			/>
		),
	},
	"vercel-ai-gateway": {
		labelKey: "settings:codeIndex.vercelAiGatewayProvider",
		secret: { field: "codebaseIndexVercelAiGatewayApiKey", statusFlag: "hasVercelAiGatewayApiKey" },
		schema: (t) => ({
			codebaseIndexVercelAiGatewayApiKey: z
				.string()
				.min(1, t("settings:codeIndex.validation.vercelAiGatewayApiKeyRequired")),
			codebaseIndexEmbedderModelId: modelSelectionRequired(t),
		}),
		render: (context) => (
			<ApiKeyAndModelFields
				context={context}
				apiKeyField="codebaseIndexVercelAiGatewayApiKey"
				apiKeyLabelKey="settings:codeIndex.vercelAiGatewayApiKeyLabel"
				apiKeyPlaceholderKey="settings:codeIndex.vercelAiGatewayApiKeyPlaceholder"
			/>
		),
	},
	bedrock: {
		labelKey: "settings:codeIndex.bedrockProvider",
		schema: (t) => ({
			codebaseIndexBedrockRegion: z.string().min(1, t("settings:codeIndex.validation.bedrockRegionRequired")),
			codebaseIndexBedrockProfile: z.string().optional(),
			codebaseIndexEmbedderModelId: modelSelectionRequired(t),
		}),
		render: (context) => (
			<>
				<SettingTextField
					context={context}
					field="codebaseIndexBedrockRegion"
					labelKey="settings:codeIndex.bedrockRegionLabel"
					placeholderKey="settings:codeIndex.bedrockRegionPlaceholder"
				/>
				<SettingTextField
					context={context}
					field="codebaseIndexBedrockProfile"
					labelKey="settings:codeIndex.bedrockProfileLabel"
					placeholderKey="settings:codeIndex.bedrockProfilePlaceholder"
					optional
					descriptionKey="settings:codeIndex.bedrockProfileDescription"
				/>
				<ModelDropdownField context={context} />
			</>
		),
	},
	openrouter: {
		labelKey: "settings:codeIndex.openRouterProvider",
		secret: { field: "codebaseIndexOpenRouterApiKey", statusFlag: "hasOpenRouterApiKey" },
		schema: (t) => ({
			codebaseIndexOpenRouterApiKey: z
				.string()
				.min(1, t("settings:codeIndex.validation.openRouterApiKeyRequired")),
			codebaseIndexEmbedderModelId: modelSelectionRequired(t),
		}),
		render: (context) => (
			<>
				<ApiKeyAndModelFields
					context={context}
					apiKeyField="codebaseIndexOpenRouterApiKey"
					apiKeyLabelKey="settings:codeIndex.openRouterApiKeyLabel"
					apiKeyPlaceholderKey="settings:codeIndex.openRouterApiKeyPlaceholder"
				/>
				<OpenRouterProviderRouting context={context} />
			</>
		),
	},
} as const satisfies Record<EmbedderProvider, EmbedderFormDefinition>

/** Providers in dropdown order. */
export const EMBEDDER_PROVIDERS = Object.keys(EMBEDDER_FORMS) as EmbedderProvider[]

/** Looks up a provider's form; `undefined` for a provider name this webview does not know (stale config). */
export const getEmbedderForm = (provider: EmbedderProvider): EmbedderFormDefinition | undefined =>
	(EMBEDDER_FORMS as Record<string, EmbedderFormDefinition>)[provider]

/** The API key settings of all providers with their `codeIndexSecretStatus` flags. */
export const EMBEDDER_SECRETS: ReadonlyArray<{ field: CodeIndexSettingKey; statusFlag: string }> =
	EMBEDDER_PROVIDERS.flatMap((provider) => {
		const secret = getEmbedderForm(provider)?.secret
		return secret ? [secret] : []
	})

/** Validation schema for the shared Qdrant fields plus the selected provider's fields. */
export const createValidationSchema = (provider: EmbedderProvider, t: CodeIndexTranslate) => {
	const baseSchema = z.object({
		codebaseIndexEnabled: z.boolean(),
		codebaseIndexQdrantUrl: z
			.string()
			.min(1, t("settings:codeIndex.validation.qdrantUrlRequired"))
			.url(t("settings:codeIndex.validation.invalidQdrantUrl")),
		codeIndexQdrantApiKey: z.string().optional(),
	})
	const form = getEmbedderForm(provider)
	return form ? baseSchema.extend(form.schema(t)) : baseSchema
}
