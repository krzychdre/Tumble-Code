// Characterization of the LM Studio and Ollama settings forms (S4 clean-up, fetched model lists).
//
// Both forms fetch the provider's model list from the local server and pick the model from it
// inside the form, flag a configured model the server does not list, and show fields that depend
// on another setting (LM Studio's draft model under the speculative decoding checkbox, Ollama's
// API key once a base URL is set). The DOM snapshots were taken from the hand-written components
// before they were replaced by `ProviderDescriptorForm`; the interaction cases pin what each
// control writes and what the model list request is asked for. Everything goes through
// `renderProviderForm`, the entry point `ApiOptions` uses, with the real checkbox.
//
// The model picker is replaced by a stub that prints its (non-function) props, so the snapshots
// pin exactly what the form hands to it; `Trans` prints its key and renders each component it
// is given, so the link targets and the warning element are pinned too.

import { cloneElement, Fragment, isValidElement, type ReactElement } from "react"

import type { ModelRecord, ProviderName, ProviderSettings } from "@roo-code/types"

import { fireEvent, render, screen } from "@/utils/test-utils"

import { renderProviderForm, type ProviderFormRenderContext } from "../provider-ui-registry"

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
	}),
}))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, components }: { i18nKey: string; components?: Record<string, ReactElement> }) => (
		<>
			{i18nKey}
			{Object.entries(components ?? {}).map(([name, element]) => (
				<Fragment key={name}>
					{`<${name}>`}
					{isValidElement(element) ? cloneElement(element) : null}
				</Fragment>
			))}
		</>
	),
}))

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

const providerModels = vi.hoisted(() => ({
	current: {} as ModelRecord | undefined,
	calls: [] as unknown[][],
}))

vi.mock("@src/components/ui/hooks/useProviderModels", () => ({
	useProviderModels: (...args: unknown[]) => {
		providerModels.calls.push(args)
		return { models: providerModels.current, modelIds: [], isLoading: false, refresh: () => {} }
	},
}))

vi.mock("../ModelPicker", () => ({
	ModelPicker: (props: Record<string, unknown>) => {
		const printable = Object.fromEntries(
			Object.entries(props)
				.filter(([name, value]) => typeof value !== "function" && name !== "apiConfiguration")
				.sort(([a], [b]) => a.localeCompare(b)),
		)
		return <div data-testid="model-picker" data-props={JSON.stringify(printable)} />
	},
}))

const model = { contextWindow: 8192, supportsPromptCache: false }
const listed: ModelRecord = { "qwen3:8b": model, "llama3:8b": model }

const renderForm = (provider: ProviderName, apiConfiguration: ProviderSettings = {}, models?: ModelRecord) => {
	providerModels.current = models
	providerModels.calls = []
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

const pickerProps = () =>
	screen.queryAllByTestId("model-picker").map((picker) => JSON.parse(picker.getAttribute("data-props")!))

const textFieldLabelled = (label: string) => screen.getByText(label).closest(".ui-text-field")!.querySelector("input")!

const snapshotCases: [ProviderName, string, ProviderSettings, ModelRecord | undefined][] = [
	["lmstudio", "empty, nothing fetched", {}, undefined],
	["lmstudio", "base url set, empty list", { lmStudioBaseUrl: "http://localhost:1234" }, {}],
	["lmstudio", "listed model", { lmStudioModelId: "qwen3:8b" }, listed],
	["lmstudio", "unlisted model", { lmStudioModelId: "gone:1b" }, listed],
	["lmstudio", "model set, nothing fetched", { lmStudioModelId: "gone:1b" }, undefined],
	["lmstudio", "speculative decoding on, no draft", { lmStudioSpeculativeDecodingEnabled: true }, listed],
	[
		"lmstudio",
		"speculative decoding on, listed draft",
		{ lmStudioSpeculativeDecodingEnabled: true, lmStudioModelId: "qwen3:8b", lmStudioDraftModelId: "llama3:8b" },
		listed,
	],
	[
		"lmstudio",
		"speculative decoding on, unlisted draft",
		{ lmStudioSpeculativeDecodingEnabled: true, lmStudioDraftModelId: "gone:1b" },
		listed,
	],
	[
		"lmstudio",
		"speculative decoding off keeps the draft hidden",
		{ lmStudioSpeculativeDecodingEnabled: false, lmStudioDraftModelId: "gone:1b" },
		listed,
	],
	["ollama", "empty, nothing fetched", {}, undefined],
	["ollama", "base url set reveals the api key", { ollamaBaseUrl: "http://localhost:11434" }, {}],
	[
		"ollama",
		"api key set",
		{ ollamaBaseUrl: "http://localhost:11434", ollamaApiKey: "ok-1", ollamaModelId: "qwen3:8b" },
		listed,
	],
	["ollama", "unlisted model", { ollamaModelId: "gone:1b" }, listed],
	["ollama", "context window set", { ollamaNumCtx: 4096 }, undefined],
]

describe("LM Studio and Ollama forms (characterization)", () => {
	it.each(snapshotCases)("%s (%s) renders the same DOM", (provider, _name, config, models) => {
		const { container } = renderForm(provider, config, models)
		expect(normalizedHtml(container)).toMatchSnapshot()
	})

	describe("model list request", () => {
		it("asks for the LM Studio list at the configured base url", () => {
			renderForm("lmstudio", { lmStudioBaseUrl: "http://gpu:1234", ollamaBaseUrl: "http://other" })
			expect(providerModels.calls.length).toBeGreaterThan(0)
			for (const args of providerModels.calls) {
				expect(args).toEqual(["lmstudio", { baseUrl: "http://gpu:1234" }])
				expect(JSON.stringify(args[1])).toBe('{"baseUrl":"http://gpu:1234"}')
			}
		})

		it("asks for the LM Studio list without a base url when none is set", () => {
			renderForm("lmstudio")
			for (const args of providerModels.calls) {
				expect(args[0]).toBe("lmstudio")
				expect(JSON.stringify(args[1])).toBe("{}")
			}
		})

		it("asks for the Ollama list with the base url and api key", () => {
			renderForm("ollama", { ollamaBaseUrl: "http://gpu:11434", ollamaApiKey: "k" })
			expect(providerModels.calls.length).toBeGreaterThan(0)
			for (const args of providerModels.calls) {
				expect(args[0]).toBe("ollama")
				expect(JSON.stringify(args[1])).toBe('{"baseUrl":"http://gpu:11434","apiKey":"k"}')
			}
		})
	})

	describe("model availability", () => {
		it.each([
			["lmstudio", { lmStudioModelId: "gone:1b" }, "settings:validation.modelAvailability"],
			["ollama", { ollamaModelId: "gone:1b" }, "settings:validation.modelAvailability"],
		] as const)("%s flags a model the server does not list", (provider, config, message) => {
			renderForm(provider, config, listed)
			expect(pickerProps()[0].errorMessage).toBe(`${message} {"modelId":"gone:1b"}`)
		})

		it.each([
			["lmstudio", { lmStudioModelId: "gone:1b" }, undefined],
			["lmstudio", { lmStudioModelId: "gone:1b" }, {}],
			["lmstudio", { lmStudioModelId: "qwen3:8b" }, listed],
			["lmstudio", {}, listed],
			// `in` also finds Object.prototype members; the forms used it, so this pins it.
			["lmstudio", { lmStudioModelId: "toString" }, listed],
			["ollama", { ollamaModelId: "gone:1b" }, undefined],
			["ollama", { ollamaModelId: "qwen3:8b" }, listed],
			["ollama", { ollamaModelId: "toString" }, listed],
		] as const)("%s shows no error for %j with list %j", (provider, config, models) => {
			renderForm(provider, config, models)
			expect(pickerProps()[0].errorMessage).toBeUndefined()
		})
	})

	describe("LM Studio controls", () => {
		it("typing the base url writes lmStudioBaseUrl", () => {
			const { container, setApiConfigurationField } = renderForm("lmstudio")
			fireEvent.input(container.querySelector('input[type="url"]')!, { target: { value: "http://x:1" } })
			expect(setApiConfigurationField.mock.calls).toEqual([["lmStudioBaseUrl", "http://x:1"]])
		})

		it.each([
			[{}, true],
			[{ lmStudioSpeculativeDecodingEnabled: true }, false],
		] as const)("clicking speculative decoding from %j writes %s", (config, expected) => {
			const { setApiConfigurationField } = renderForm("lmstudio", config)
			fireEvent.click(
				screen
					.getByText("settings:providers.lmStudio.speculativeDecoding")
					.closest("label")!
					.querySelector("input")!,
			)
			expect(setApiConfigurationField.mock.calls).toEqual([["lmStudioSpeculativeDecodingEnabled", expected]])
		})

		it("gives the draft picker its own label and model key", () => {
			renderForm("lmstudio", { lmStudioSpeculativeDecodingEnabled: true }, listed)
			expect(pickerProps().map(({ modelIdKey, label }) => [modelIdKey, label])).toEqual([
				["lmStudioModelId", undefined],
				["lmStudioDraftModelId", "settings:providers.lmStudio.draftModelId"],
			])
		})
	})

	describe("Ollama controls", () => {
		it("typing the base url writes ollamaBaseUrl", () => {
			const { container, setApiConfigurationField } = renderForm("ollama")
			fireEvent.input(container.querySelector('input[type="url"]')!, { target: { value: "http://x:2" } })
			expect(setApiConfigurationField.mock.calls).toEqual([["ollamaBaseUrl", "http://x:2"]])
		})

		it("typing the api key writes ollamaApiKey", () => {
			const { container, setApiConfigurationField } = renderForm("ollama", { ollamaBaseUrl: "http://x:2" })
			fireEvent.input(container.querySelector('input[type="password"]')!, { target: { value: "key" } })
			expect(setApiConfigurationField.mock.calls).toEqual([["ollamaApiKey", "key"]])
		})

		it.each([
			["", [["ollamaNumCtx", undefined]]],
			["4096", [["ollamaNumCtx", 4096]]],
			["128", [["ollamaNumCtx", 128]]],
			["127", []],
			["abc", []],
			// parseInt reads the leading digits; the form wrote them.
			["8192tokens", [["ollamaNumCtx", 8192]]],
		] as const)("typing %j in the context window writes %j", (value, expected) => {
			const { setApiConfigurationField } = renderForm("ollama")
			fireEvent.input(textFieldLabelled("settings:providers.ollama.numCtx"), { target: { value } })
			expect(setApiConfigurationField.mock.calls).toEqual(expected)
		})
	})
})
