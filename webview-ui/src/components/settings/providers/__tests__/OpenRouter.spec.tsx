import { fireEvent, render, screen } from "@/utils/test-utils"
import type { ProviderSettings, RouterModels } from "@tumble-code/types"

import { OpenRouter } from "../OpenRouter"

const { providersQuery } = vi.hoisted(() => ({ providersQuery: vi.fn() }))

vi.mock("@src/hooks/models/useOpenRouterModelProviders", () => ({
	useOpenRouterModelProviders: providersQuery,
	OPENROUTER_DEFAULT_PROVIDER_NAME: "[default]",
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("../../ModelPicker", () => ({ ModelPicker: () => null }))

// A native select stands in for the Radix one, so a choice is one change event.
vi.mock("@src/components/ui", () => ({
	Input: (props: any) => <input {...props} />,
	Select: ({ children, value, onValueChange }: any) => (
		<select data-testid="routing" value={value} onChange={(e) => onValueChange(e.target.value)}>
			{children}
		</select>
	),
	SelectContent: ({ children }: any) => <>{children}</>,
	SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
	SelectTrigger: () => null,
	SelectValue: () => null,
}))

const model = { maxTokens: 1, contextWindow: 1, supportsPromptCache: false }

const renderForm = ({
	routerModels = { openrouter: { "a/one": model, "b/two": model } } as unknown as RouterModels,
	simplifySettings = false,
}: { routerModels?: RouterModels; simplifySettings?: boolean } = {}) => {
	const setApiConfigurationField = vi.fn()
	const apiConfiguration: ProviderSettings = { openRouterApiKey: "k", openRouterModelId: "a/one" }
	render(
		<OpenRouter
			apiConfiguration={apiConfiguration}
			setApiConfigurationField={setApiConfigurationField}
			routerModels={routerModels}
			selectedModelId="a/one"
			uriScheme="vscode"
			simplifySettings={simplifySettings}
			organizationAllowList={{ allowAll: true, providers: {} }}
		/>,
	)
	return setApiConfigurationField
}

describe("OpenRouter provider routing", () => {
	beforeEach(() => {
		providersQuery.mockReset()
		providersQuery.mockReturnValue({ data: { groq: { label: "Groq" }, together: { label: "Together" } } })
	})

	it("lists the model's providers after the default and stores the chosen one", () => {
		const setField = renderForm()

		const select = screen.getByTestId("routing") as HTMLSelectElement
		expect(Array.from(select.options).map((option) => option.text)).toEqual(["[default]", "Groq", "Together"])
		expect(select.value).toBe("[default]")

		fireEvent.change(select, { target: { value: "groq" } })
		expect(setField).toHaveBeenCalledWith("openRouterSpecificProvider", "groq")
	})

	it("is hidden in the simplified (welcome) form and when the model has no providers", () => {
		renderForm({ simplifySettings: true })
		expect(screen.queryByTestId("routing")).toBeNull()

		providersQuery.mockReturnValue({ data: {} })
		renderForm()
		expect(screen.queryByTestId("routing")).toBeNull()
	})

	it("asks for the providers only when the model is one of several listed models", () => {
		renderForm()
		expect(providersQuery).toHaveBeenLastCalledWith("a/one", undefined, { enabled: true })

		renderForm({ routerModels: { openrouter: { "a/one": model } } as unknown as RouterModels })
		expect(providersQuery).toHaveBeenLastCalledWith("a/one", undefined, { enabled: false })

		renderForm({ routerModels: { openrouter: { "c/x": model, "d/y": model } } as unknown as RouterModels })
		expect(providersQuery).toHaveBeenLastCalledWith("a/one", undefined, { enabled: false })
	})
})
