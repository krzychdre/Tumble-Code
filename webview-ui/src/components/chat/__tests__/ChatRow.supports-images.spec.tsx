import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ClineMessage } from "@roo-code/types"

import { ChatRowContent } from "../ChatRow"

const mockPostMessage = vi.fn()
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (msg: unknown) => mockPostMessage(msg),
	},
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { exists: () => true },
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// OpenRouter lists its models at runtime, so selecting the model of this
// profile asks the host for the list (`requestProviderModels`). The row must
// not do that: ChatView already knows whether the model takes images.
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		alwaysAllowMcp: false,
		currentCheckpoint: null,
		mode: "code",
		apiConfiguration: { apiProvider: "openrouter", openRouterModelId: "some/model" },
		clineMessages: [],
		currentTaskItem: undefined,
	}),
}))

// The real text area is heavy; the mock shows the one prop under test.
vi.mock("../ChatTextArea", () => ({
	ChatTextArea: ({ shouldDisableImages }: { shouldDisableImages: boolean }) => (
		<div data-testid="edit-text-area" data-disable-images={String(shouldDisableImages)} />
	),
}))

const feedback: ClineMessage = { type: "say", say: "user_feedback", ts: 10, text: "please fix it" }

const renderRow = (supportsImages: boolean) =>
	render(
		<QueryClientProvider client={new QueryClient()}>
			<ChatRowContent
				message={feedback}
				isExpanded={false}
				isLast={false}
				isStreaming={false}
				supportsImages={supportsImages}
				onToggleExpand={() => {}}
			/>
		</QueryClientProvider>,
	)

const requestProviderModelsPosts = () =>
	mockPostMessage.mock.calls.filter(([msg]) => (msg as { type?: string })?.type === "requestProviderModels")

describe("ChatRow image support", () => {
	beforeEach(() => mockPostMessage.mockClear())

	it("does not ask the host for the provider's model list", () => {
		renderRow(true)

		expect(requestProviderModelsPosts()).toHaveLength(0)
	})

	it.each([
		[true, "false"],
		[false, "true"],
	])("with supportsImages=%s the edit box has images disabled=%s", (supportsImages, disabled) => {
		renderRow(supportsImages)

		fireEvent.click(screen.getByText("please fix it"))

		expect(screen.getByTestId("edit-text-area")).toHaveAttribute("data-disable-images", disabled)
	})
})
