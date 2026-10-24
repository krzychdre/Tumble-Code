// In-place editing of a user message: images the user picks arrive from the
// host as a "selectedImages" message with context "edit" and the row's ts, and
// only the row being edited takes them; the edit box follows the model's image
// support that ChatView passes in.

import React from "react"
import { act, fireEvent, render, screen } from "@/utils/test-utils"
import type { ClineMessage } from "@tumble-code/types"

import { ChatRowContent } from "../ChatRow"
import { ReadOnlyRowsContext } from "../rows/ReadOnlyRowsContext"

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
// profile would ask the host for the list (`requestProviderModels`). The row
// must not do that: ChatView already knows whether the model takes images.
const state = {
	mcpServers: [],
	alwaysAllowMcp: false,
	currentCheckpoint: null,
	mode: "code",
	apiConfiguration: { apiProvider: "openrouter", openRouterModelId: "some/model" },
	currentTaskItem: undefined,
}

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => state,
	useExtensionSelector: (selector: (s: never) => unknown) => selector(state as never),
}))

// The real text area is heavy; the mock exposes what the row hands it.
vi.mock("../ChatTextArea", () => ({
	ChatTextArea: ({
		inputValue,
		setInputValue,
		selectedImages,
		shouldDisableImages,
		onSend,
		onSelectImages,
		onCancel,
	}: {
		inputValue: string
		setInputValue: (value: string) => void
		selectedImages: string[]
		shouldDisableImages: boolean
		onSend: () => void
		onSelectImages: () => void
		onCancel: () => void
	}) => (
		<div
			data-testid="edit-text-area"
			data-images={selectedImages.join(",")}
			data-disable-images={String(shouldDisableImages)}>
			<input aria-label="edit" value={inputValue} onChange={(e) => setInputValue(e.target.value)} />
			<button onClick={onSend}>send</button>
			<button onClick={onSelectImages}>pick images</button>
			<button onClick={onCancel}>cancel</button>
		</div>
	),
}))

const TS = 10
const feedback: ClineMessage = { type: "say", say: "user_feedback", ts: TS, text: "please fix it", images: ["a.png"] }

const renderRow = ({ supportsImages = true, isStreaming = false, message = feedback } = {}) =>
	render(
		<ChatRowContent
			message={message}
			isExpanded={false}
			isLast={false}
			isStreaming={isStreaming}
			supportsImages={supportsImages}
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

describe("ChatRow in-place edit: save, cancel and delete", () => {
	beforeEach(() => mockPostMessage.mockClear())

	it("sends the edited text and images for the message's ts", () => {
		renderRow()
		fireEvent.click(screen.getByLabelText("common:confirmation.editMessage"))
		fireEvent.change(screen.getByLabelText("edit"), { target: { value: "fixed text" } })
		postFromHost({ type: "selectedImages", context: "edit", messageTs: TS, images: ["b.png"] })

		fireEvent.click(screen.getByText("send"))

		expect(mockPostMessage).toHaveBeenCalledWith({
			type: "submitEditedMessage",
			value: TS,
			editedMessageContent: "fixed text",
			images: ["a.png", "b.png"],
		})
		expect(screen.queryByTestId("edit-text-area")).not.toBeInTheDocument()
	})

	it("asks the host to pick images for this message", () => {
		renderRow()
		fireEvent.click(screen.getByText("please fix it"))

		fireEvent.click(screen.getByText("pick images"))

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "selectImages", context: "edit", messageTs: TS })
	})

	it("drops the edit on cancel, so the next edit starts from the stored message", () => {
		renderRow()
		fireEvent.click(screen.getByText("please fix it"))
		postFromHost({ type: "selectedImages", context: "edit", messageTs: TS, images: ["b.png"] })

		fireEvent.click(screen.getByText("cancel"))
		fireEvent.click(screen.getByText("please fix it"))

		expect(editImages()).toBe("a.png")
		expect(mockPostMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: "submitEditedMessage" }))
	})

	it("deletes the message by its ts", () => {
		renderRow()

		fireEvent.click(screen.getByLabelText("common:confirmation.deleteMessage"))

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "deleteMessage", value: TS })
	})

	it("does not start editing while the model streams", () => {
		renderRow({ isStreaming: true })

		fireEvent.click(screen.getByText("please fix it"))

		expect(screen.queryByTestId("edit-text-area")).not.toBeInTheDocument()
	})
})

describe("ChatRow in-place edit: image support", () => {
	beforeEach(() => mockPostMessage.mockClear())

	it.each([
		[true, "false"],
		[false, "true"],
	])("with supportsImages=%s the edit box has images disabled=%s", (supportsImages, disabled) => {
		renderRow({ supportsImages, message: { ...feedback, images: undefined } })

		fireEvent.click(screen.getByText("please fix it"))

		expect(screen.getByTestId("edit-text-area")).toHaveAttribute("data-disable-images", disabled)
		expect(mockPostMessage.mock.calls.filter(([msg]) => msg.type === "requestProviderModels")).toEqual([])
	})
})

// A subagent's transcript is shown outside its task: editing or deleting a
// message there would act on the open task instead.
describe("ChatRow user message in a read-only transcript", () => {
	beforeEach(() => mockPostMessage.mockClear())

	it("offers no edit or delete, and a click does not start editing", () => {
		render(
			<ReadOnlyRowsContext.Provider value={true}>
				<ChatRowContent
					message={feedback}
					isExpanded={false}
					isLast={false}
					isStreaming={false}
					onToggleExpand={() => {}}
				/>
			</ReadOnlyRowsContext.Provider>,
		)

		fireEvent.click(screen.getByText("please fix it"))

		expect(screen.queryByTestId("edit-text-area")).not.toBeInTheDocument()
		expect(screen.getByLabelText("common:confirmation.deleteMessage").closest("div")).toHaveClass("hidden")
	})
})
