// While a user message is being edited in place, images the user picks arrive
// from the host as a "selectedImages" message with context "edit" and the
// row's ts. Only the row being edited takes them.

import React from "react"
import { act, fireEvent, render, screen } from "@/utils/test-utils"
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

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		alwaysAllowMcp: false,
		currentCheckpoint: null,
		mode: "code",
		currentTaskItem: undefined,
	}),
}))

// The real text area is heavy; the mock shows the images it is given.
vi.mock("../ChatTextArea", () => ({
	ChatTextArea: ({ selectedImages, onCancel }: { selectedImages: string[]; onCancel: () => void }) => (
		<div data-testid="edit-text-area" data-images={selectedImages.join(",")}>
			<button onClick={onCancel}>cancel</button>
		</div>
	),
}))

const TS = 10
const feedback: ClineMessage = { type: "say", say: "user_feedback", ts: TS, text: "please fix it", images: ["a.png"] }

const renderRow = () =>
	render(
		<ChatRowContent
			message={feedback}
			isExpanded={false}
			isLast={false}
			isStreaming={false}
			supportsImages={true}
			onToggleExpand={() => {}}
		/>,
	)

const postFromHost = (data: Record<string, unknown>) =>
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data }))
	})

const editImages = () => screen.getByTestId("edit-text-area").getAttribute("data-images")

describe("ChatRow in-place edit: images from the host", () => {
	beforeEach(() => mockPostMessage.mockClear())

	it("appends picked images to the message being edited", () => {
		renderRow()
		fireEvent.click(screen.getByText("please fix it"))
		expect(editImages()).toBe("a.png")

		postFromHost({ type: "selectedImages", context: "edit", messageTs: TS, images: ["b.png", "c.png"] })

		expect(editImages()).toBe("a.png,b.png,c.png")
	})

	it("ignores images for another message, another context or another message type", () => {
		renderRow()
		fireEvent.click(screen.getByText("please fix it"))

		postFromHost({ type: "selectedImages", context: "edit", messageTs: TS + 1, images: ["x.png"] })
		postFromHost({ type: "selectedImages", context: "chat", messageTs: TS, images: ["y.png"] })
		postFromHost({ type: "state", context: "edit", messageTs: TS, images: ["z.png"] })

		expect(editImages()).toBe("a.png")
	})
})
