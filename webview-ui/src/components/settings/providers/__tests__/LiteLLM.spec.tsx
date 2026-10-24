import { act, fireEvent, render, screen } from "@/utils/test-utils"

import { LiteLLM } from "../LiteLLM"

const { postMessage } = vi.hoisted(() => ({ postMessage: vi.fn() }))

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage } }))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("../../ModelPicker", () => ({ ModelPicker: () => null }))

const LOADING = "settings:providers.refreshModels.loading"

/** Answers the last model request (the refresh) like the host does. */
const answerRefresh = (result: { models?: Record<string, unknown>; error?: string }) => {
	const request = postMessage.mock.calls.at(-1)![0].modelSourceRequest
	expect(request.refresh).toBe(true)
	act(() => {
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "providerModels",
					modelSourceResult: { requestId: request.requestId, sourceId: "litellm", ...result },
				},
			}),
		)
	})
}

const renderForm = () => {
	render(
		<LiteLLM
			apiConfiguration={{ litellmApiKey: "key", litellmBaseUrl: "http://localhost:4000" }}
			setApiConfigurationField={vi.fn()}
			organizationAllowList={{ allowAll: true, providers: {} }}
		/>,
	)
	fireEvent.click(screen.getByRole("button", { name: /settings:providers.refreshModels.label/ }))
	expect(screen.getByText(LOADING)).toBeInTheDocument()
}

describe("LiteLLM model refresh", () => {
	beforeEach(() => postMessage.mockClear())

	it("ends in success when the refreshed models arrive", async () => {
		renderForm()

		answerRefresh({ models: { "gpt-x": { contextWindow: 1, supportsPromptCache: false } } })

		expect(await screen.findByText("settings:providers.refreshModels.success")).toBeInTheDocument()
		expect(screen.queryByText(LOADING)).not.toBeInTheDocument()
	})

	it("ends in the host's error when the refresh fails", async () => {
		renderForm()

		answerRefresh({ error: "401 from LiteLLM" })

		expect(await screen.findByText("401 from LiteLLM")).toBeInTheDocument()
		expect(screen.queryByText(LOADING)).not.toBeInTheDocument()
	})
})
