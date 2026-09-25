// Characterization table over every provider form in the UI registry.
// It pins the contract the shared provider-form helpers must keep:
// typing into a form's credential field writes the right ProviderSettings key,
// and the "API key field + storage notice + get-key link" trio keeps its DOM.

import type { ProviderName, ProviderSettings } from "@roo-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"

import { providerUiRegistry, type ProviderFormRenderContext } from "../provider-ui-registry"

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: { i18nKey?: string; children?: React.ReactNode }) => <>{i18nKey ?? children}</>,
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({ children, value, onInput, onBlur, placeholder, type, className }: any) => (
		<div data-testid="vscode-text-field" data-type={type} data-class={className}>
			{children}
			<input
				type={type}
				value={value}
				placeholder={placeholder}
				onChange={(e) => onInput?.(e)}
				onBlur={(e) => onBlur?.(e)}
			/>
		</div>
	),
	VSCodeDropdown: ({ children, value, onChange }: any) => (
		<select value={value} onChange={(e) => onChange?.(e)}>
			{children}
		</select>
	),
	VSCodeOption: ({ children, value }: any) => <option value={value}>{children}</option>,
	VSCodeLink: ({ children, href }: any) => <a href={href}>{children}</a>,
	VSCodeCheckbox: ({ children, checked, onChange }: any) => (
		<label>
			<input type="checkbox" checked={checked} onChange={(e) => onChange?.(e)} />
			{children}
		</label>
	),
	VSCodeButton: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}))

vi.mock("vscrui", () => ({
	Checkbox: ({ children, checked, onChange }: any) => (
		<label>
			<input type="checkbox" checked={checked} onChange={(e) => onChange?.(e.target.checked)} />
			{children}
		</label>
	),
}))

vi.mock("@src/components/common/VSCodeButtonLink", () => ({
	VSCodeButtonLink: ({ children, href, appearance }: any) => (
		<a data-testid="get-key-link" href={href} data-appearance={appearance}>
			{children}
		</a>
	),
}))

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("@src/components/ui/hooks/useProviderModels", () => ({
	useProviderModels: () => ({ models: {}, modelIds: [], isLoading: false, refresh: vi.fn() }),
}))

vi.mock("@src/components/ui/hooks/useSelectedModel", () => ({
	useSelectedModel: () => ({ id: "test-model", info: undefined }),
}))

vi.mock("@/components/ui/hooks/useOpenRouterKeyInfo", () => ({
	useOpenRouterKeyInfo: () => ({ data: undefined }),
}))

vi.mock("../ModelPicker", () => ({ ModelPicker: () => null }))
vi.mock("../ThinkingBudget", () => ({ ThinkingBudget: () => null }))
vi.mock("../R1FormatSetting", () => ({ R1FormatSetting: () => null }))
vi.mock("../providers/OpenAICodexRateLimitDashboard", () => ({ OpenAICodexRateLimitDashboard: () => null }))

type FormProvider = {
	[P in keyof typeof providerUiRegistry]: (typeof providerUiRegistry)[P] extends { status: "form" } ? P : never
}[keyof typeof providerUiRegistry]

type CredentialCase = {
	// The i18n key (or literal text) rendered as the field's label.
	label: string
	// The ProviderSettings key the field writes.
	field: keyof ProviderSettings
	// Settings needed for the field to be rendered at all.
	config?: ProviderSettings
}

// `null` means the form has no typed credential (OAuth or a model list only).
const credentialFields: Record<FormProvider, CredentialCase | null> = {
	anthropic: { label: "settings:providers.anthropicApiKey", field: "apiKey" },
	bedrock: { label: "settings:providers.awsAccessKey", field: "awsAccessKey" },
	deepseek: { label: "settings:providers.deepSeekApiKey", field: "deepSeekApiKey" },
	gemini: { label: "settings:providers.geminiApiKey", field: "geminiApiKey" },
	litellm: { label: "settings:providers.litellmApiKey", field: "litellmApiKey" },
	lmstudio: { label: "settings:providers.lmStudio.baseUrl", field: "lmStudioBaseUrl" },
	minimax: { label: "settings:providers.minimaxApiKey", field: "minimaxApiKey" },
	mistral: { label: "settings:providers.mistralApiKey", field: "mistralApiKey" },
	moonshot: { label: "settings:providers.moonshotApiKey", field: "moonshotApiKey" },
	ollama: {
		label: "settings:providers.ollama.apiKey",
		field: "ollamaApiKey",
		config: { ollamaBaseUrl: "http://localhost:11434" },
	},
	openai: { label: "settings:providers.apiKey", field: "openAiApiKey" },
	"openai-codex": null,
	"openai-native": { label: "settings:providers.openAiApiKey", field: "openAiNativeApiKey" },
	openrouter: { label: "settings:providers.openRouterApiKey", field: "openRouterApiKey" },
	"qwen-code": { label: "OAuth Credentials Path", field: "qwenCodeOauthPath" },
	vertex: { label: "settings:providers.googleCloudKeyFile", field: "vertexKeyFile" },
	"vscode-lm": null,
	xai: { label: "settings:providers.xaiApiKey", field: "xaiApiKey" },
	zai: { label: "settings:providers.zaiApiKey", field: "zaiApiKey" },
}

// Forms that render the "API key field + storage notice + get-key link" trio.
type KeyTrioCase = {
	field: keyof ProviderSettings
	labelKey: string
	getKeyLabelKey: string
	getKeyUrl: string
	config?: ProviderSettings
	// The trio sits in its own <div> (no negative top margin on the notice).
	grouped?: boolean
	// The label element when it differs from the common <label className="block font-medium mb-1">.
	label?: { tag: string; className: string }
}

const keyTrios: Partial<Record<FormProvider, KeyTrioCase[]>> = {
	anthropic: [
		{
			field: "apiKey",
			labelKey: "settings:providers.anthropicApiKey",
			getKeyLabelKey: "settings:providers.getAnthropicApiKey",
			getKeyUrl: "https://console.anthropic.com/settings/keys",
		},
	],
	deepseek: [
		{
			field: "deepSeekApiKey",
			labelKey: "settings:providers.deepSeekApiKey",
			getKeyLabelKey: "settings:providers.getDeepSeekApiKey",
			getKeyUrl: "https://platform.deepseek.com/",
		},
	],
	gemini: [
		{
			field: "geminiApiKey",
			labelKey: "settings:providers.geminiApiKey",
			getKeyLabelKey: "settings:providers.getGeminiApiKey",
			getKeyUrl: "https://ai.google.dev/",
		},
	],
	"openai-native": [
		{
			field: "openAiNativeApiKey",
			labelKey: "settings:providers.openAiApiKey",
			getKeyLabelKey: "settings:providers.getOpenAiApiKey",
			getKeyUrl: "https://platform.openai.com/api-keys",
		},
	],
	xai: [
		{
			field: "xaiApiKey",
			labelKey: "settings:providers.xaiApiKey",
			getKeyLabelKey: "settings:providers.getXaiApiKey",
			getKeyUrl: "https://api.x.ai/docs",
		},
	],
	mistral: [
		{
			field: "mistralApiKey",
			labelKey: "settings:providers.mistralApiKey",
			getKeyLabelKey: "settings:providers.getMistralApiKey",
			getKeyUrl: "https://console.mistral.ai/",
			label: { tag: "SPAN", className: "font-medium" },
		},
	],
	minimax: [
		{
			field: "minimaxApiKey",
			labelKey: "settings:providers.minimaxApiKey",
			getKeyLabelKey: "settings:providers.getMiniMaxApiKey",
			getKeyUrl: "https://www.minimax.io/platform/user-center/basic-information/interface-key",
			grouped: true,
		},
		{
			field: "minimaxApiKey",
			labelKey: "settings:providers.minimaxApiKey",
			getKeyLabelKey: "settings:providers.getMiniMaxApiKey",
			getKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
			config: { minimaxBaseUrl: "https://api.minimaxi.com/v1" },
			grouped: true,
		},
	],
	moonshot: [
		{
			field: "moonshotApiKey",
			labelKey: "settings:providers.moonshotApiKey",
			getKeyLabelKey: "settings:providers.getMoonshotApiKey",
			getKeyUrl: "https://platform.moonshot.ai/console/api-keys",
			grouped: true,
		},
		{
			field: "moonshotApiKey",
			labelKey: "settings:providers.moonshotApiKey",
			getKeyLabelKey: "settings:providers.getMoonshotApiKey",
			getKeyUrl: "https://platform.moonshot.cn/console/api-keys",
			config: { moonshotBaseUrl: "https://api.moonshot.cn/v1" },
			grouped: true,
		},
	],
	zai: [
		{
			field: "zaiApiKey",
			labelKey: "settings:providers.zaiApiKey",
			getKeyLabelKey: "settings:providers.getZaiApiKey",
			getKeyUrl: "https://z.ai/manage-apikey/apikey-list",
			grouped: true,
		},
		{
			field: "zaiApiKey",
			labelKey: "settings:providers.zaiApiKey",
			getKeyLabelKey: "settings:providers.getZaiApiKey",
			getKeyUrl: "https://open.bigmodel.cn/console/overview",
			config: { zaiApiLine: "china_coding" },
			grouped: true,
		},
	],
}

const formProviders = (Object.keys(providerUiRegistry) as ProviderName[]).filter(
	(provider): provider is FormProvider => providerUiRegistry[provider].status === "form",
)

const renderForm = (provider: FormProvider, apiConfiguration: ProviderSettings = {}) => {
	const setApiConfigurationField = vi.fn()
	const context: ProviderFormRenderContext = {
		apiConfiguration: { apiProvider: provider, ...apiConfiguration },
		setApiConfigurationField,
		uriScheme: "vscode",
		simplifySettings: false,
		routerModels: undefined,
		refetchRouterModels: vi.fn(),
		organizationAllowList: { allowAll: true, providers: {} },
		modelValidationError: undefined,
		selectedModelId: "test-model",
		selectedModelInfo: undefined,
		openAiCodexIsAuthenticated: false,
	}
	const definition = providerUiRegistry[provider]
	if (definition.status !== "form") {
		throw new Error(`${provider} has no form`)
	}
	const utils = render(<>{definition.render(context)}</>)
	return { ...utils, setApiConfigurationField }
}

const textFieldByLabel = (label: string) => {
	const field = screen.getByText(label).closest<HTMLElement>('[data-testid="vscode-text-field"]')
	if (!field) {
		throw new Error(`no text field labelled ${label}`)
	}
	return field
}

describe("provider forms table", () => {
	it("covers every registry entry that has a form", () => {
		expect([...formProviders].sort()).toEqual(Object.keys(credentialFields).sort())
	})

	const withCredential = formProviders.filter((provider) => credentialFields[provider] !== null)
	const withoutCredential = formProviders.filter((provider) => credentialFields[provider] === null)

	it.each(withCredential)("%s: typing into the credential field writes the right settings key", (provider) => {
		const { label, field, config } = credentialFields[provider]!
		const { setApiConfigurationField } = renderForm(provider, config)

		const input = textFieldByLabel(label).querySelector("input")!
		fireEvent.change(input, { target: { value: "typed-secret" } })

		expect(setApiConfigurationField).toHaveBeenCalledWith(field, "typed-secret")
		expect(setApiConfigurationField.mock.calls.filter(([key]) => key === field)).toEqual([[field, "typed-secret"]])
	})

	it.each(withCredential)("%s: the credential field shows the stored value", (provider) => {
		const { label, field, config } = credentialFields[provider]!
		renderForm(provider, { ...config, [field]: "stored-value" })

		expect(textFieldByLabel(label).querySelector("input")!).toHaveValue("stored-value")
	})

	it.each(withoutCredential)("%s: renders without a typed credential field", (provider) => {
		const { container } = renderForm(provider)
		expect(container).not.toBeEmptyDOMElement()
		expect(container.querySelector('[data-testid="vscode-text-field"][data-type="password"]')).toBeNull()
	})

	const trioCases = Object.entries(keyTrios).flatMap(([provider, cases]) =>
		cases!.map((trio) => [provider as FormProvider, trio] as const),
	)

	it.each(trioCases)("%s: API key trio with an empty key (%#)", (provider, trio) => {
		renderForm(provider, trio.config)

		const field = textFieldByLabel(trio.labelKey)
		expect(field).toHaveAttribute("data-type", "password")
		expect(field).toHaveAttribute("data-class", "w-full")
		expect(field.querySelector("input")).toHaveAttribute("placeholder", "settings:placeholders.apiKey")
		expect(field.querySelector("input")).toHaveValue("")

		const label = screen.getByText(trio.labelKey)
		expect(label.tagName).toBe(trio.label?.tag ?? "LABEL")
		expect(label).toHaveAttribute("class", trio.label?.className ?? "block font-medium mb-1")

		const notice = field.nextElementSibling as HTMLElement
		expect(notice.tagName).toBe("DIV")
		expect(notice).toHaveTextContent("settings:providers.apiKeyStorageNotice")
		expect(notice).toHaveAttribute(
			"class",
			trio.grouped
				? "text-sm text-vscode-descriptionForeground"
				: "text-sm text-vscode-descriptionForeground -mt-2",
		)

		const link = notice.nextElementSibling as HTMLElement
		expect(link).toBe(screen.getByTestId("get-key-link"))
		expect(link).toHaveAttribute("href", trio.getKeyUrl)
		expect(link).toHaveAttribute("data-appearance", "secondary")
		expect(link).toHaveTextContent(trio.getKeyLabelKey)

		if (trio.grouped) {
			const group = field.parentElement!
			expect(group.tagName).toBe("DIV")
			expect(group.children).toHaveLength(3)
		}
	})

	it.each(trioCases)("%s: API key trio hides the get-key link once a key is set (%#)", (provider, trio) => {
		renderForm(provider, { ...trio.config, [trio.field]: "sk-set" })

		const field = textFieldByLabel(trio.labelKey)
		expect(field.querySelector("input")).toHaveValue("sk-set")
		expect(field.nextElementSibling).toHaveTextContent("settings:providers.apiKeyStorageNotice")
		expect(screen.queryByTestId("get-key-link")).toBeNull()
	})
})
