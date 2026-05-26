// npx vitest src/components/welcome/__tests__/WelcomeViewProvider.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"

import * as ExtensionStateContext from "@src/context/ExtensionStateContext"
const { ExtensionStateContextProvider } = ExtensionStateContext

import WelcomeViewProvider from "../WelcomeViewProvider"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/components/ui", () => ({
	Button: ({ children, onClick, variant }: any) => (
		<button onClick={onClick} data-testid={`button-${variant}`}>
			{children}
		</button>
	),
}))

vi.mock("../../settings/ApiOptions", () => ({
	default: () => <div data-testid="api-options">API Options Component</div>,
}))

vi.mock("../../common/Tab", () => ({
	Tab: ({ children }: any) => <div data-testid="tab">{children}</div>,
	TabContent: ({ children }: any) => <div data-testid="tab-content">{children}</div>,
}))

vi.mock("../RooHero", () => ({
	default: () => <div data-testid="roo-hero">Roo Hero</div>,
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, children }: any) => <span data-testid={`trans-${i18nKey}`}>{children || i18nKey}</span>,
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@src/utils/validate", () => ({
	validateApiConfiguration: (config: any) =>
		config && Object.keys(config).length > 0 ? undefined : "validation:errors.required",
}))

const renderWelcomeViewProvider = (extensionState: Record<string, unknown> = {}) => {
	const useExtensionStateMock = vi.spyOn(ExtensionStateContext, "useExtensionState")
	useExtensionStateMock.mockReturnValue({
		apiConfiguration: { apiProvider: "anthropic", apiKey: "fake" },
		currentApiConfigName: "default",
		setApiConfiguration: vi.fn(),
		uriScheme: "vscode",
		...extensionState,
	} as any)

	render(
		<ExtensionStateContextProvider>
			<WelcomeViewProvider />
		</ExtensionStateContextProvider>,
	)

	return useExtensionStateMock
}

describe("WelcomeViewProvider", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders greeting, intro, ApiOptions, and Finish button", () => {
		renderWelcomeViewProvider()

		expect(screen.getByText(/welcome:landing.greeting/)).toBeInTheDocument()
		expect(screen.getByTestId("trans-welcome:landing.introduction")).toBeInTheDocument()
		expect(screen.getByTestId("api-options")).toBeInTheDocument()
		expect(screen.getByTestId("button-primary")).toBeInTheDocument()
	})

	it("posts upsertApiConfiguration when Finish is clicked with valid config", () => {
		renderWelcomeViewProvider()

		fireEvent.click(screen.getByTestId("button-primary"))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "upsertApiConfiguration",
			text: "default",
			apiConfiguration: { apiProvider: "anthropic", apiKey: "fake" },
		})
	})

	it("does not post upsertApiConfiguration when validation fails", () => {
		renderWelcomeViewProvider({ apiConfiguration: {} })

		fireEvent.click(screen.getByTestId("button-primary"))

		expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "upsertApiConfiguration" }))
	})

	it("posts importSettings when the Import Settings link is clicked", () => {
		renderWelcomeViewProvider()

		const importButton = screen.getByText(/welcome:importSettings/)
		fireEvent.click(importButton)

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "importSettings" })
	})
})
