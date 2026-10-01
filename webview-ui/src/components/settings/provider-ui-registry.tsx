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

import { Bedrock, LiteLLM, OpenAICompatible, OpenAICodex, OpenRouter, QwenCode, Vertex, VSCodeLM } from "./providers"
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

/** Hand-written forms whose id differs from their provider id. */
const customFormIdAliases = { openai: "openai-compatible" } as const satisfies Partial<
	Record<CustomFormProviderId, string>
>

type FormIdOf<P extends CustomFormProviderId | DescriptorFormProviderId> = P extends keyof typeof customFormIdAliases
	? (typeof customFormIdAliases)[P]
	: P

/**
 * The component a form definition renders: a hand-written one (named after its provider unless
 * `customFormIdAliases` renames it), or the descriptor form (named after its provider). Derived
 * from `PROVIDER_DESCRIPTORS`, so migrating a provider to the descriptor form keeps its id.
 */
export type ProviderFormId = FormIdOf<CustomFormProviderId | DescriptorFormProviderId>

export type ProviderFormDefinition = {
	readonly status: "form"
	readonly formId: ProviderFormId
	readonly validation: ProviderValidationStrategy
	readonly render: (context: ProviderFormRenderContext) => React.ReactNode
}

type ProviderFormException = {
	readonly status: "no-form"
	readonly reason: "hidden-test-provider"
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

/** A hand-written form; its id is the provider id or its alias in `customFormIdAliases`. */
const customForm = <P extends CustomFormProviderId>(
	provider: P,
	render: ProviderFormDefinition["render"],
): ProviderFormDefinition =>
	simpleForm(
		provider,
		(Object.hasOwn(customFormIdAliases, provider)
			? customFormIdAliases[provider as keyof typeof customFormIdAliases]
			: provider) as FormIdOf<P>,
		render,
	)

const descriptorForm = (provider: DescriptorFormProviderId): ProviderFormDefinition =>
	simpleForm(provider, provider, (context) => (
		<ProviderDescriptorForm
			provider={provider}
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			selectedModelInfo={context.selectedModelInfo}
		/>
	))

/** Every provider the descriptor form renders gets its definition from its descriptor row. */
const descriptorForms = Object.fromEntries(
	getDescriptorFormProviderIds().map((provider) => [provider, descriptorForm(provider)]),
) as { [provider in DescriptorFormProviderId]: ProviderFormDefinition }

const customForms = {
	openrouter: customForm("openrouter", (context) => (
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
	litellm: customForm("litellm", (context) => (
		<LiteLLM
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			organizationAllowList={context.organizationAllowList}
			modelValidationError={context.modelValidationError}
			simplifySettings={context.simplifySettings}
		/>
	)),
	"vscode-lm": customForm("vscode-lm", (context) => (
		<VSCodeLM
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
		/>
	)),
	openai: customForm("openai", (context) => (
		<OpenAICompatible
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			organizationAllowList={context.organizationAllowList}
			modelValidationError={context.modelValidationError}
			simplifySettings={context.simplifySettings}
		/>
	)),
	bedrock: customForm("bedrock", (context) => (
		<Bedrock
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			selectedModelInfo={context.selectedModelInfo}
			simplifySettings={context.simplifySettings}
		/>
	)),
	"openai-codex": customForm("openai-codex", (context) => (
		<OpenAICodex
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			simplifySettings={context.simplifySettings}
			openAiCodexIsAuthenticated={context.openAiCodexIsAuthenticated}
		/>
	)),
	"qwen-code": customForm("qwen-code", (context) => (
		<QwenCode
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
			simplifySettings={context.simplifySettings}
		/>
	)),
	vertex: customForm("vertex", (context) => (
		<Vertex
			apiConfiguration={context.apiConfiguration}
			setApiConfigurationField={context.setApiConfigurationField}
		/>
	)),
} satisfies CustomProviderForms

const noForms = {
	"fake-ai": withValidation("fake-ai", { status: "no-form", reason: "hidden-test-provider" }),
} satisfies NoProviderForms

export const providerUiRegistry = { ...descriptorForms, ...customForms, ...noForms } satisfies ProviderUiRegistry

export const getProviderUiDefinition = (provider: ProviderName): ProviderUiDefinition => providerUiRegistry[provider]

export const renderProviderForm = (provider: ProviderName, context: ProviderFormRenderContext): React.ReactNode => {
	const definition = getProviderUiDefinition(provider)
	return definition.status === "form" ? definition.render(context) : null
}
