/**
 * "Clear Index Data" asks the host to delete the index. The host answers with
 * an `indexCleared` message that carries `success` and, on failure, `error`
 * (for example "no workspace folder open", or "CodeIndexManager not
 * initialized" when the index is in the Error state). Nothing in the webview
 * listened for that message, so a failed clear was silent: the user clicked,
 * confirmed, and saw no change and no reason.
 */

import React from "react"

import { render, screen, fireEvent, act } from "@/utils/test-utils"
import { PopoverTrigger } from "@/components/ui"

import { CodeIndexPopover } from "../CodeIndexPopover"

vi.mock("react-i18next", () => ({
	Trans: ({ children }: any) => <>{children}</>,
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("@/components/ui/hooks/useOpenRouterModelProviders", () => ({
	useOpenRouterModelProviders: () => ({ data: undefined, isLoading: false }),
	OPENROUTER_DEFAULT_PROVIDER_NAME: "[default]",
}))

const mockExtensionState = {
	codebaseIndexConfig: {
		codebaseIndexEnabled: true,
		codebaseIndexQdrantUrl: "http://localhost:6333",
		codebaseIndexEmbedderProvider: "openai",
		codebaseIndexEmbedderModelId: "text-embedding-3-small",
	},
	codebaseIndexModels: {},
	cwd: "/workspace",
	apiConfiguration: {},
}

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionSelector: (selector: (s: never) => unknown) => selector(mockExtensionState as never),

	useExtensionState: () => mockExtensionState,
}))

const indexingStatus = {
	systemStatus: "Error",
	message: "",
	processedItems: 0,
	totalItems: 0,
	currentItemUnit: "items",
}

function postFromHost(data: unknown) {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data }))
	})
}

function renderOpenPopover() {
	render(
		<CodeIndexPopover indexingStatus={indexingStatus}>
			<PopoverTrigger asChild>
				<button>open-popover</button>
			</PopoverTrigger>
		</CodeIndexPopover>,
	)
	fireEvent.click(screen.getByText("open-popover"))
	// The clear button is rendered, so the popover shows the clear action.
	expect(screen.getByText("settings:codeIndex.clearIndexDataButton")).toBeInTheDocument()
}

describe("CodeIndexPopover indexCleared response", () => {
	it("shows the error of a failed clear", () => {
		renderOpenPopover()

		postFromHost({ type: "indexCleared", values: { success: false, error: "No workspace folder open" } })

		expect(screen.getByText("No workspace folder open")).toBeInTheDocument()
	})

	it("removes the error when a later clear succeeds", () => {
		renderOpenPopover()

		postFromHost({ type: "indexCleared", values: { success: false, error: "No workspace folder open" } })
		expect(screen.getByText("No workspace folder open")).toBeInTheDocument()

		postFromHost({ type: "indexCleared", values: { success: true } })
		expect(screen.queryByText("No workspace folder open")).not.toBeInTheDocument()
	})

	it("removes the old error when the user confirms another clear", () => {
		renderOpenPopover()

		postFromHost({ type: "indexCleared", values: { success: false, error: "No workspace folder open" } })
		expect(screen.getByText("No workspace folder open")).toBeInTheDocument()

		fireEvent.click(screen.getByText("settings:codeIndex.clearIndexDataButton"))
		fireEvent.click(screen.getByText("settings:codeIndex.clearDataDialog.confirmButton"))

		expect(screen.queryByText("No workspace folder open")).not.toBeInTheDocument()
	})
})
