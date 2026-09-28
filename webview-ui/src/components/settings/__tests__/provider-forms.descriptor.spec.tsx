// Characterization of the provider forms that the generic descriptor form renders (S4).
//
// The DOM snapshots were taken from the hand-written components (XAI, DeepSeek, Gemini,
// Moonshot, MiniMax, ZAi) before they were replaced by `ProviderDescriptorForm`; the
// interaction cases pin what each control writes. Both go through `renderProviderForm`,
// the entry point `ApiOptions` uses, so they hold for either implementation.

import type { ProviderName, ProviderSettings } from "@roo-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"

import { renderProviderForm, type ProviderFormRenderContext } from "../provider-ui-registry"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/components/ui/vscrui-checkbox", () => ({
	VSCRUICheckbox: ({ children, checked, onChange, "data-testid": testId }: any) => (
		<label data-testid={testId}>
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

const renderForm = (provider: ProviderName, apiConfiguration: ProviderSettings = {}) => {
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
	const utils = render(<>{renderProviderForm(provider, context)}</>)
	return { ...utils, setApiConfigurationField }
}

// React's useId values depend on how many hooks ran before; they are not part of the contract.
const normalizedHtml = (container: HTMLElement) =>
	container.innerHTML.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, "«id»")

const snapshotCases: [ProviderName, string, ProviderSettings][] = [
	["xai", "empty", {}],
	["xai", "key set", { xaiApiKey: "sk-x" }],
	["deepseek", "empty", {}],
	["deepseek", "key set", { deepSeekApiKey: "sk-d" }],
	["gemini", "empty", {}],
	["gemini", "custom base url stored", { geminiApiKey: "k", googleGeminiBaseUrl: "https://proxy.example/v1" }],
	["moonshot", "empty", {}],
	["moonshot", "china endpoint", { moonshotBaseUrl: "https://api.moonshot.cn/v1", moonshotApiKey: "k" }],
	["moonshot", "global endpoint", { moonshotBaseUrl: "https://api.moonshot.ai/v1" }],
	["minimax", "empty", {}],
	["minimax", "china endpoint", { minimaxBaseUrl: "https://api.minimaxi.com/v1" }],
	["minimax", "global endpoint", { minimaxBaseUrl: "https://api.minimax.io/v1", minimaxApiKey: "k" }],
	["zai", "empty", {}],
	["zai", "china coding", { zaiApiLine: "china_coding" }],
	["zai", "china api", { zaiApiLine: "china_api", zaiApiKey: "k" }],
	["zai", "international api", { zaiApiLine: "international_api" }],
]

describe("descriptor-rendered provider forms (characterization)", () => {
	it.each(snapshotCases)("%s (%s) renders the same DOM", (provider, _name, config) => {
		const { container } = renderForm(provider, config)
		expect(normalizedHtml(container)).toMatchSnapshot()
	})

	it.each([
		["moonshot", "moonshotBaseUrl", "api.moonshot.cn", "https://api.moonshot.cn/v1"],
		["moonshot", "moonshotBaseUrl", "api.moonshot.ai", "https://api.moonshot.ai/v1"],
		["minimax", "minimaxBaseUrl", "api.minimaxi.com", "https://api.minimaxi.com/v1"],
		["zai", "zaiApiLine", "China API (https://open.bigmodel.cn/api/paas/v4)", "china_api"],
	] as const)("%s: picking %s option %s writes %s", (provider, field, optionText, value) => {
		const initial: ProviderSettings =
			provider === "moonshot" && value === "https://api.moonshot.ai/v1"
				? { moonshotBaseUrl: "https://api.moonshot.cn/v1" }
				: {}
		const { setApiConfigurationField } = renderForm(provider, initial)

		fireEvent.click(screen.getByRole("combobox"))
		fireEvent.click(screen.getByRole("option", { name: optionText }))

		expect(setApiConfigurationField).toHaveBeenCalledWith(field, value)
		expect(setApiConfigurationField).toHaveBeenCalledTimes(1)
	})

	it.each([
		["xai", "xaiApiKey"],
		["deepseek", "deepSeekApiKey"],
		["gemini", "geminiApiKey"],
		["moonshot", "moonshotApiKey"],
		["minimax", "minimaxApiKey"],
		["zai", "zaiApiKey"],
	] as const)("%s: typing the API key writes %s only", (provider, field) => {
		const { container, setApiConfigurationField } = renderForm(provider)

		fireEvent.input(container.querySelector('input[type="password"]')!, { target: { value: "typed" } })

		expect(setApiConfigurationField.mock.calls).toEqual([[field, "typed"]])
	})

	describe("gemini custom base url", () => {
		it("is hidden until the checkbox is ticked, then writes googleGeminiBaseUrl", () => {
			const { container, setApiConfigurationField } = renderForm("gemini")
			expect(container.querySelector('input[type="url"]')).toBeNull()

			fireEvent.click(screen.getByTestId("checkbox-custom-base-url").querySelector("input")!)
			expect(setApiConfigurationField).not.toHaveBeenCalled()

			const url = container.querySelector('input[type="url"]')!
			expect(url).toHaveAttribute("placeholder", "settings:defaults.geminiUrl")
			fireEvent.input(url, { target: { value: "https://proxy.example" } })
			expect(setApiConfigurationField.mock.calls).toEqual([["googleGeminiBaseUrl", "https://proxy.example"]])
		})

		it("clears the stored url when the checkbox is unticked", () => {
			const { container, setApiConfigurationField } = renderForm("gemini", {
				googleGeminiBaseUrl: "https://proxy.example",
			})
			expect(container.querySelector('input[type="url"]')).toHaveValue("https://proxy.example")

			fireEvent.click(screen.getByTestId("checkbox-custom-base-url").querySelector("input")!)

			expect(setApiConfigurationField.mock.calls).toEqual([["googleGeminiBaseUrl", ""]])
			expect(container.querySelector('input[type="url"]')).toBeNull()
		})
	})
})
