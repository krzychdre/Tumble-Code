import React from "react"
import { fireEvent, render, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ClineMessage } from "@tumble-code/types"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { ChatRowContent } from "../ChatRow"

const mockPostMessage = vi.fn()

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (...args: unknown[]) => mockPostMessage(...args),
	},
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:fileOperations.wantsToEdit": "Roo wants to edit this file",
				"chat:fileOperations.wantsToEditProtected": "Roo wants to edit a protected file",
				"chat:fileOperations.wantsToEditOutsideWorkspace": "Roo wants to edit outside workspace",
				"chat:fileOperations.wantsToApplyBatchChanges": "Roo wants to apply batch changes",
			}
			return map[key] || key
		},
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// Mock CodeBlock (avoid ESM/highlighter costs)
vi.mock("@src/components/common/CodeBlock", () => ({
	default: () => null,
}))

const queryClient = new QueryClient()

function createToolAskMessage(toolPayload: Record<string, unknown>): ClineMessage {
	return {
		type: "ask",
		ask: "tool",
		ts: Date.now(),
		partial: false,
		text: JSON.stringify(toolPayload),
	}
}

function renderChatRow(message: ClineMessage, isExpanded = false) {
	return render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatRowContent
					message={message}
					isExpanded={isExpanded}
					isLast={false}
					isStreaming={false}
					onToggleExpand={() => {}}
					onSuggestionClick={() => {}}
					onBatchFileResponse={() => {}}
					onFollowUpUnmount={() => {}}
					isFollowUpAnswered={false}
				/>
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)
}

// The golden renders pin the headers and diff stats of every edit tool; these
// cases cover what a snapshot cannot: the header choice by payload flag, and
// the message a click on the created file's link posts.
describe("ChatRow - edit tool rows", () => {
	beforeEach(() => {
		mockPostMessage.mockClear()
	})

	it.each([
		["a plain edit", {}, "Roo wants to edit this file"],
		["an edit outside the workspace", { isOutsideWorkspace: true }, "Roo wants to edit outside workspace"],
		["a protected edit", { isProtected: true, isOutsideWorkspace: true }, "Roo wants to edit a protected file"],
	])("titles %s", (_name, flags, title) => {
		renderChatRow(
			createToolAskMessage({ tool: "searchAndReplace", path: "src/file.ts", diff: "-a\n+b\n", ...flags }),
		)

		expect(screen.getByText(title)).toBeInTheDocument()
	})

	// No "./" prefix for an absolute Windows path: the extension must see it as is.
	it.each([
		["src/new-file.ts", "./src/new-file.ts"],
		["C:\\project\\src\\new-file.ts", "C:\\project\\src\\new-file.ts"],
	])("opens the created file %s", (path, text) => {
		const { container } = renderChatRow(
			createToolAskMessage({
				tool: "newFileCreated",
				path,
				content: "+new file",
				diffStats: { added: 1, removed: 0 },
			}),
		)

		fireEvent.click(container.querySelector(".codicon-link-external")!)

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "openFile", text })
	})

	it("offers no file link for an edit of an existing file", () => {
		const { container } = renderChatRow(
			createToolAskMessage({
				tool: "appliedDiff",
				path: "src/a.ts",
				diff: "-a\n+b\n",
				diffStats: { added: 1, removed: 1 },
			}),
		)

		expect(container.querySelector(".codicon-link-external")).toBeNull()
	})

	it("opens a markdown file in plan review", () => {
		renderChatRow(createToolAskMessage({ tool: "newFileCreated", path: "plans/p.md", content: "# Plan" }))

		fireEvent.click(screen.getByText("chat:planReview.reviewFile"))

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "openPlanReview", text: "plans/p.md" })
	})
})
