import {
	getDescriptorFormProviderIds,
	providerValidationRegistry,
	type CustomFormProviderId,
	type DescriptorFormProviderId,
	type NoFormProviderId,
	type ModelInfo,
	type OrganizationAllowList,
	type ProviderName,
	type ProviderSettings,
	type ProviderValidationStrategy,
	type RouterModels,
} from "@roo-code/types"

import {
	Anthropic,
	Bedrock,
	LMStudio,
	LiteLLM,
	Mistral,
	Ollama,
	OpenAI,
	OpenAICompatible,
	OpenAICodex,
	OpenRouter,
	QwenCode,
	Vertex,
	VSCodeLM,
} from "./providers"
import { ProviderDescriptorForm } from "./providers/ProviderDescriptorForm"
import type { SetApiConfigurationField } from "./providers/shared"

export type ProviderFormRenderContext = {
	apiConfiguration: ProviderSettings
	setApiConfigurationField: SetApiConfigurationField
	uriScheme: string | undefined
	simplifySettings: boolean | undefined
	routerModels: RouterModels | undefined
	refetchRouterModels: () => void
	organizationAllowList: OrganizationAllowList
	modelValidationError: string | undefined
	selectedModelId: string
	selectedModelInfo: ModelInfo | undefined
	openAiCodexIsAuthenticated: boolean | undefined
}

/** The component a form definition renders: a hand-written one, or the descriptor form (named after its provider). */
export type ProviderFormId =
	| "anthropic"
	| "bedrock"
	| "lmstudio"
	| "litellm"
	| "mistral"
	| "ollama"
	| "openai-codex"
	| "openai-compatible"
	| "openai-native"
	| "openrouter"
	| "qwen-code"
	| "vertex"
	| "vscode-lm"
	| DescriptorFormProviderId

export type ProviderFormDefinition = {
	readonly status: "form"
	readonly formId: ProviderFormId
	readonly validation: ProviderValidationStrategy
	readonly render: (context: ProviderFormRenderContext) => React.ReactNode
}

type ProviderFormException = {
	readonly status: "no-form"
	readonly reason: "hidden-test-provider" | "headless-provider"
	readonly validation: ProviderValidationStrategy
}

export type ProviderUiDefinition = ProviderFormDefinition | ProviderFormException

type ProviderUiRegistry = {
	[provider in ProviderName]: ProviderUiDefinition
}

/**
 * Hand-written forms, one per provider whose `PROVIDER_DESCRIPTORS` row says `form: custom`.
 * The key set is checked against the descriptor table in both directions: a custom provider
 * without a row, or a row for a provider the descriptor form renders, does not compile.
 */
type CustomProviderForms = { [provider in CustomFormProviderId]: ProviderFormDefinition }

/** Providers without a settings form (`form: none` in `PROVIDER_DESCRIPTORS`) and why. */
type NoProviderForms = { [provider in NoFormProviderId]: ProviderFormException }

const withValidation = <TDefinition extends Omit<ProviderUiDefinition, "validation">>(
	provider: ProviderName,
	definition: TDefinition,
): TDefinition & { readonly validation: ProviderValidationStrategy } => ({
	...definition,
	validation: providerValidationRegistry[provider],
})

const simpleForm = (
	provider: ProviderName,
	formId: ProviderFormId,
	render: ProviderFormDefinition["render"],
): ProviderFormDefinition => withValidation(provider, { status: "form", formId, render })

const descriptorForm = (provider: DescriptorFormProviderId): ProviderFormDefinition =>
	simpleForm(provider, provider, (context) => (
		<ProviderDescriptorForm
			provider={provider}
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
		/>
	))

/** Every provider the descriptor form renders gets its definition from its descriptor row. */
const descriptorForms = Object.fromEntries(
	getDescriptorFormProviderIds().map((provider) => [provider, descriptorForm(provider)]),
) as { [provider in DescriptorFormProviderId]: ProviderFormDefinition }

const customForms = {
	openrouter: simpleForm("openrouter", "openrouter", (context) => (
		<OpenRouter
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			routerModels={context.routerModels}
			selectedModelId={context.selectedModelId}
			uriScheme={context.uriScheme}
			simplifySettings={context.simplifySettings}
			organizationAllowList={context.organizationAllowList}
			modelValidationError={context.modelValidationError}
		/>
	)),
	litellm: simpleForm("litellm", "litellm", (context) => (
		<LiteLLM
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			organizationAllowList={context.organizationAllowList}
			modelValidationError={context.modelValidationError}
			simplifySettings={context.simplifySettings}
		/>
	)),
	ollama: simpleForm("ollama", "ollama", (context) => (
		<Ollama
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
		/>
	)),
	lmstudio: simpleForm("lmstudio", "lmstudio", (context) => (
		<LMStudio
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
		/>
	)),
	"vscode-lm": simpleForm("vscode-lm", "vscode-lm", (context) => (
		<VSCodeLM
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
		/>
	)),
	openai: simpleForm("openai", "openai-compatible", (context) => (
		<OpenAICompatible
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			organizationAllowList={context.organizationAllowList}
			modelValidationError={context.modelValidationError}
			simplifySettings={context.simplifySettings}
		/>
	)),
	anthropic: simpleForm("anthropic", "anthropic", (context) => (
		<Anthropic
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			simplifySettings={context.simplifySettings}
		/>
	)),
	bedrock: simpleForm("bedrock", "bedrock", (context) => (
		<Bedrock
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			selectedModelInfo={context.selectedModelInfo}
			simplifySettings={context.simplifySettings}
		/>
	)),
	mistral: simpleForm("mistral", "mistral", (context) => (
		<Mistral
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			simplifySettings={context.simplifySettings}
		/>
	)),
	"openai-codex": simpleForm("openai-codex", "openai-codex", (context) => (
		<OpenAICodex
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			simplifySettings={context.simplifySettings}
			openAiCodexIsAuthenticated={context.openAiCodexIsAuthenticated}
		/>
	)),
	"openai-native": simpleForm("openai-native", "openai-native", (context) => (
		<OpenAI
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			selectedModelInfo={context.selectedModelInfo}
			simplifySettings={context.simplifySettings}
		/>
	)),
	"qwen-code": simpleForm("qwen-code", "qwen-code", (context) => (
		<QwenCode
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			simplifySettings={context.simplifySettings}
		/>
	)),
	vertex: simpleForm("vertex", "vertex", (context) => (
		<Vertex
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
		/>
	)),
} satisfies CustomProviderForms

const noForms = {
	"fake-ai": withValidation("fake-ai", { status: "no-form", reason: "hidden-test-provider" }),
	"gemini-cli": withValidation("gemini-cli", { status: "no-form", reason: "headless-provider" }),
} satisfies NoProviderForms

export const providerUiRegistry = { ...descriptorForms, ...customForms, ...noForms } satisfies ProviderUiRegistry

export const getProviderUiDefinition = (provider: ProviderName): ProviderUiDefinition => providerUiRegistry[provider]

export const renderProviderForm = (provider: ProviderName, context: ProviderFormRenderContext): React.ReactNode => {
	const definition = getProviderUiDefinition(provider)
	return definition.status === "form" ? definition.render(context) : null
}
