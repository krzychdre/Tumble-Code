// Characterization of the Anthropic and Mistral settings forms (S4 slice 2).
//
// Both forms show controls that depend on the selected model (Mistral's Codestral URL,
// Anthropic's 1M context checkbox) and Anthropic's custom base URL checkbox clears more than
// one setting when unticked. The DOM snapshots were taken from the hand-written components
// before they were replaced by `ProviderDescriptorForm`; the interaction cases pin what each
// control writes. Everything goes through `renderProviderForm`, the entry point `ApiOptions`
// uses, and the checkbox is the real one (not mocked), so its class names and test ids are
// part of the snapshots.

import type { ProviderName, ProviderSettings } from "@roo-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"

import { renderProviderForm, type ProviderFormRenderContext } from "../provider-ui-registry"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@src/components/common/VSCodeButtonLink", () => ({
	VSCodeButtonLink: ({ children, href, appearance }: any) => (
		<a data-testid="get-key-link" href={href} data-appearance={appearance}>
			{children}
		</a>
	),
}))

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

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

const checkboxLabelled = (label: string) => screen.getByText(label).closest("label")!.querySelector("input")!

const snapshotCases: [ProviderName, string, ProviderSettings][] = [
	["mistral", "empty (default model is Codestral)", {}],
	["mistral", "key set, codestral model", { mistralApiKey: "k", apiModelId: "codestral-latest" }],
	["mistral", "codestral url stored", { apiModelId: "codestral-latest", mistralCodestralUrl: "https://c.example" }],
	[
		"mistral",
		"non-codestral model",
		{ apiModelId: "mistral-large-latest", mistralCodestralUrl: "https://c.example" },
	],
	["anthropic", "empty", {}],
	["anthropic", "key set", { apiKey: "sk-a" }],
	["anthropic", "custom base url stored", { anthropicBaseUrl: "https://proxy.example" }],
	[
		"anthropic",
		"custom base url with auth token",
		{ anthropicBaseUrl: "https://proxy.example", anthropicUseAuthToken: true },
	],
	["anthropic", "1M model, beta off", { apiModelId: "claude-sonnet-4-5" }],
	["anthropic", "1M model, beta on", { apiModelId: "claude-opus-4-6", anthropicBeta1MContext: true }],
	["anthropic", "model without 1M beta", { apiModelId: "claude-opus-4-7", anthropicBeta1MContext: true }],
]

describe("Anthropic and Mistral forms (characterization)", () => {
	it.each(snapshotCases)("%s (%s) renders the same DOM", (provider, _name, config) => {
		const { container } = renderForm(provider, config)
		expect(normalizedHtml(container)).toMatchSnapshot()
	})

	describe("mistral codestral url", () => {
		it.each([
			["no model set (default codestral-latest)", {}, true],
			["empty model id (default codestral-latest)", { apiModelId: "" }, true],
			["codestral-latest", { apiModelId: "codestral-latest" }, true],
			["an unlisted codestral- id", { apiModelId: "codestral-2601" }, true],
			["mistral-large-latest", { apiModelId: "mistral-large-latest" }, false],
			["an id containing codestral elsewhere", { apiModelId: "my-codestral-latest" }, false],
		] as const)("%s: shown = %s", (_name, config, shown) => {
			renderForm("mistral", config)
			expect(screen.queryByText("settings:providers.codestralBaseUrl") !== null).toBe(shown)
		})

		it("typing the url writes mistralCodestralUrl only", () => {
			const { container, setApiConfigurationField } = renderForm("mistral")
			const url = container.querySelector('input[type="url"]')!
			expect(url).toHaveAttribute("placeholder", "https://codestral.mistral.ai")

			fireEvent.input(url, { target: { value: "https://c.example" } })

			expect(setApiConfigurationField.mock.calls).toEqual([["mistralCodestralUrl", "https://c.example"]])
		})

		it("typing the API key writes mistralApiKey only", () => {
			const { container, setApiConfigurationField } = renderForm("mistral")
			fireEvent.input(container.querySelector('input[type="password"]')!, { target: { value: "typed" } })
			expect(setApiConfigurationField.mock.calls).toEqual([["mistralApiKey", "typed"]])
		})
	})

	describe("anthropic custom base url", () => {
		it("is hidden until ticked; ticking writes nothing and reveals the url and auth token", () => {
			const { container, setApiConfigurationField } = renderForm("anthropic")
			expect(container.querySelector('input[type="url"]')).toBeNull()
			expect(screen.queryByText("settings:providers.anthropicUseAuthToken")).toBeNull()

			fireEvent.click(checkboxLabelled("settings:providers.useCustomBaseUrl"))

			expect(setApiConfigurationField).not.toHaveBeenCalled()
			const url = container.querySelector('input[type="url"]')!
			expect(url).toHaveAttribute("placeholder", "https://api.anthropic.com")
			expect(screen.getByText("settings:providers.anthropicUseAuthToken")).toBeInTheDocument()

			fireEvent.input(url, { target: { value: "https://proxy.example" } })
			expect(setApiConfigurationField.mock.calls).toEqual([["anthropicBaseUrl", "https://proxy.example"]])
		})

		it("unticking clears the url, then the auth token flag, and hides both", () => {
			const { container, setApiConfigurationField } = renderForm("anthropic", {
				anthropicBaseUrl: "https://proxy.example",
				anthropicUseAuthToken: true,
			})
			expect(container.querySelector('input[type="url"]')).toHaveValue("https://proxy.example")

			fireEvent.click(checkboxLabelled("settings:providers.useCustomBaseUrl"))

			expect(setApiConfigurationField.mock.calls).toEqual([
				["anthropicBaseUrl", ""],
				["anthropicUseAuthToken", false],
			])
			expect(container.querySelector('input[type="url"]')).toBeNull()
			expect(screen.queryByText("settings:providers.anthropicUseAuthToken")).toBeNull()
		})

		it.each([
			[false, true],
			[true, false],
		])("the auth token checkbox (stored %s) writes %s", (stored, written) => {
			const { setApiConfigurationField } = renderForm("anthropic", {
				anthropicBaseUrl: "https://proxy.example",
				anthropicUseAuthToken: stored,
			})
			const box = checkboxLabelled("settings:providers.anthropicUseAuthToken")
			expect(box.checked).toBe(stored)

			fireEvent.click(box)

			expect(setApiConfigurationField.mock.calls).toEqual([["anthropicUseAuthToken", written]])
		})
	})

	describe("anthropic 1M context checkbox", () => {
		it.each([
			["no model set (default claude-opus-5)", {}, false],
			["empty model id", { apiModelId: "" }, false],
			["claude-sonnet-4-20250514", { apiModelId: "claude-sonnet-4-20250514" }, true],
			["claude-sonnet-4-5", { apiModelId: "claude-sonnet-4-5" }, true],
			["claude-sonnet-4-6", { apiModelId: "claude-sonnet-4-6" }, true],
			["claude-opus-4-6", { apiModelId: "claude-opus-4-6" }, true],
			["claude-opus-4-7 (listed, no 1M tier)", { apiModelId: "claude-opus-4-7" }, false],
			["an unlisted id", { apiModelId: "claude-sonnet-4-5-custom" }, false],
		] as const)("%s: shown = %s", (_name, config, shown) => {
			renderForm("anthropic", config)
			expect(screen.queryByText("settings:providers.anthropic1MContextBetaLabel") !== null).toBe(shown)
		})

		it.each([
			[undefined, true],
			[true, false],
		])("ticking (stored %s) writes anthropicBeta1MContext = %s", (stored, written) => {
			const { setApiConfigurationField } = renderForm("anthropic", {
				apiModelId: "claude-sonnet-4-6",
				anthropicBeta1MContext: stored,
			})

			fireEvent.click(checkboxLabelled("settings:providers.anthropic1MContextBetaLabel"))

			expect(setApiConfigurationField.mock.calls).toEqual([["anthropicBeta1MContext", written]])
		})

		it("typing the API key writes apiKey only", () => {
			const { container, setApiConfigurationField } = renderForm("anthropic")
			fireEvent.input(container.querySelector('input[type="password"]')!, { target: { value: "typed" } })
			expect(setApiConfigurationField.mock.calls).toEqual([["apiKey", "typed"]])
		})
	})
})
