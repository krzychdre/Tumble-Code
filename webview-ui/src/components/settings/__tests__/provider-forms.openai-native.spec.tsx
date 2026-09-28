// Characterization of the OpenAI (native) settings form (S4 slice 3).
//
// The form has a "use custom base URL" checkbox that sits directly in the form (no wrapper
// `<div>`, unlike Gemini's and Anthropic's), the API key trio under it without its own group,
// and a service-tier dropdown whose options come from the selected model's `tiers`. The DOM
// snapshots were taken from the hand-written `OpenAI` component before it was replaced by
// `ProviderDescriptorForm`; the interaction cases pin what each control writes. Everything goes
// through `renderProviderForm`, the entry point `ApiOptions` uses, with the real checkbox and
// the real dropdown, so their class names and test ids are part of the snapshots.

import type { ModelInfo, ProviderSettings } from "@roo-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"

import { renderProviderForm, type ProviderFormRenderContext } from "../provider-ui-registry"

// Keys render as themselves, except the service tier's, which render in English from the real
// locale file: the tier field showed hard-coded English text before it was translated, so the
// snapshots below prove the English DOM did not change (S4 service tier i18n).
vi.mock("@src/i18n/TranslationContext", async () => {
	const { default: enSettings } = await import("@src/i18n/locales/en/settings.json")
	const serviceTier: Record<string, unknown> = enSettings.serviceTier
	return {
		useAppTranslation: () => ({
			t: (key: string) => {
				const name = key.startsWith("settings:serviceTier.") ? key.slice("settings:serviceTier.".length) : ""
				return typeof serviceTier[name] === "string" ? serviceTier[name] : key
			},
		}),
	}
})

vi.mock("@src/components/common/VSCodeButtonLink", () => ({
	VSCodeButtonLink: ({ children, href, appearance }: any) => (
		<a data-testid="get-key-link" href={href} data-appearance={appearance}>
			{children}
		</a>
	),
}))

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

// The dropdown's popup (Radix) scrolls to the selected item and captures the pointer; jsdom has neither.
beforeAll(() => {
	Element.prototype.scrollIntoView ??= vi.fn()
	Element.prototype.hasPointerCapture ??= vi.fn(() => false)
	Element.prototype.releasePointerCapture ??= vi.fn()
})

const modelInfo = (tiers?: ModelInfo["tiers"]): ModelInfo => ({
	contextWindow: 400_000,
	supportsPromptCache: true,
	tiers,
})

const flexAndPriority = modelInfo([
	{ name: "flex", contextWindow: 400_000, inputPrice: 1 },
	{ name: "priority", contextWindow: 400_000, inputPrice: 2 },
])

const renderForm = (apiConfiguration: ProviderSettings = {}, selectedModelInfo?: ModelInfo) => {
	const setApiConfigurationField = vi.fn()
	const context: ProviderFormRenderContext = {
		apiConfiguration: { apiProvider: "openai-native", ...apiConfiguration },
		setApiConfigurationField,
		uriScheme: "vscode",
		simplifySettings: false,
		routerModels: undefined,
		refetchRouterModels: vi.fn(),
		organizationAllowList: { allowAll: true, providers: {} },
		modelValidationError: undefined,
		selectedModelId: "test-model",
		selectedModelInfo,
		openAiCodexIsAuthenticated: false,
	}
	const utils = render(<>{renderProviderForm("openai-native", context)}</>)
	return { ...utils, setApiConfigurationField }
}

// React's useId values depend on how many hooks ran before; they are not part of the contract.
const normalizedHtml = (container: HTMLElement) =>
	container.innerHTML.replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, "«id»")

const baseUrlCheckbox = () =>
	screen.getByText("settings:providers.useCustomBaseUrl").closest("label")!.querySelector("input")!

const openTierDropdown = () => {
	fireEvent.keyDown(screen.getByTestId("openai-service-tier").querySelector('[role="combobox"]')!, { key: "Enter" })
	return screen.getAllByRole("option").map((option) => option.textContent)
}

const snapshotCases: [string, ProviderSettings, ModelInfo | undefined][] = [
	["empty, no model info", {}, undefined],
	["key set", { openAiNativeApiKey: "sk-o" }, undefined],
	["custom base url stored", { openAiNativeBaseUrl: "https://proxy.example/v1" }, undefined],
	["model with flex and priority, tier unset", {}, flexAndPriority],
	["model with flex and priority, priority chosen", { openAiNativeServiceTier: "priority" }, flexAndPriority],
	[
		"model with flex only, flex chosen",
		{ openAiNativeServiceTier: "flex" },
		modelInfo([{ name: "flex", contextWindow: 1, inputPrice: 1 }]),
	],
	[
		"model with priority only",
		{ openAiNativeApiKey: "sk-o" },
		modelInfo([{ name: "priority", contextWindow: 1, inputPrice: 1 }]),
	],
	["model without tiers", {}, modelInfo()],
	[
		"model whose tiers are unnamed or default",
		{},
		modelInfo([
			{ contextWindow: 1, inputPrice: 1 },
			{ name: "default", contextWindow: 1, inputPrice: 1 },
		]),
	],
]

describe("OpenAI native form (characterization)", () => {
	it.each(snapshotCases)("%s renders the same DOM", (_name, config, info) => {
		const { container } = renderForm(config, info)
		expect(normalizedHtml(container)).toMatchSnapshot()
	})

	describe("custom base url", () => {
		it("is hidden until ticked; ticking writes nothing and reveals the url field", () => {
			const { container, setApiConfigurationField } = renderForm()
			expect(container.querySelector('input[type="url"]')).toBeNull()

			fireEvent.click(baseUrlCheckbox())

			expect(setApiConfigurationField).not.toHaveBeenCalled()
			const url = container.querySelector('input[type="url"]')!
			expect(url).toHaveAttribute("placeholder", "https://api.openai.com/v1")

			fireEvent.input(url, { target: { value: "https://proxy.example/v1" } })
			expect(setApiConfigurationField.mock.calls).toEqual([["openAiNativeBaseUrl", "https://proxy.example/v1"]])
		})

		it("unticking clears the url only and hides the field", () => {
			const { container, setApiConfigurationField } = renderForm({
				openAiNativeBaseUrl: "https://proxy.example/v1",
			})
			expect(container.querySelector('input[type="url"]')).toHaveValue("https://proxy.example/v1")

			fireEvent.click(baseUrlCheckbox())

			expect(setApiConfigurationField.mock.calls).toEqual([["openAiNativeBaseUrl", ""]])
			expect(container.querySelector('input[type="url"]')).toBeNull()
		})
	})

	it("typing the API key writes openAiNativeApiKey only", () => {
		const { container, setApiConfigurationField } = renderForm()
		fireEvent.input(container.querySelector('input[type="password"]')!, { target: { value: "typed" } })
		expect(setApiConfigurationField.mock.calls).toEqual([["openAiNativeApiKey", "typed"]])
	})

	describe("service tier", () => {
		it.each([
			["no model info", undefined],
			["a model without tiers", modelInfo()],
			["a model with an empty tier list", modelInfo([])],
			["a model with only unnamed tiers", modelInfo([{ contextWindow: 1, inputPrice: 1 }])],
		] as const)("is hidden for %s", (_name, info) => {
			renderForm({}, info)
			expect(screen.queryByTestId("openai-service-tier")).toBeNull()
		})

		it.each([
			["flex and priority", flexAndPriority, ["Standard", "Flex", "Priority"]],
			[
				"priority listed before flex",
				modelInfo([
					{ name: "priority", contextWindow: 1, inputPrice: 1 },
					{ name: "flex", contextWindow: 1, inputPrice: 1 },
				]),
				["Standard", "Flex", "Priority"],
			],
			["flex only", modelInfo([{ name: "flex", contextWindow: 1, inputPrice: 1 }]), ["Standard", "Flex"]],
			[
				"priority only",
				modelInfo([{ name: "priority", contextWindow: 1, inputPrice: 1 }]),
				["Standard", "Priority"],
			],
		] as const)("offers Standard plus the model's tiers (%s)", (_name, info, expected) => {
			renderForm({}, info)
			expect(openTierDropdown()).toEqual(expected)
		})

		it("shows Standard while the tier is unset", () => {
			renderForm({}, flexAndPriority)
			expect(screen.getByTestId("openai-service-tier")).toHaveTextContent("Standard")
		})

		it.each([
			["Flex", "flex"],
			["Priority", "priority"],
		] as const)("picking %s writes openAiNativeServiceTier %s", (label, value) => {
			const { setApiConfigurationField } = renderForm({}, flexAndPriority)
			openTierDropdown()
			fireEvent.click(screen.getByRole("option", { name: label }))
			expect(setApiConfigurationField.mock.calls).toEqual([["openAiNativeServiceTier", value]])
		})

		it("picking Standard writes the literal default tier", () => {
			const { setApiConfigurationField } = renderForm({ openAiNativeServiceTier: "flex" }, flexAndPriority)
			openTierDropdown()
			fireEvent.click(screen.getByRole("option", { name: "Standard" }))
			expect(setApiConfigurationField.mock.calls).toEqual([["openAiNativeServiceTier", "default"]])
		})
	})
})
