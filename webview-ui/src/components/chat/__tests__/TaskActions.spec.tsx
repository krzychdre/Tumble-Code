// TaskActions' own buttons: export, copy, delete and the debug files. The
// share button has its own spec (ShareButton.spec.tsx).

import type { HistoryItem } from "@tumble-code/types"

import { render, screen, fireEvent } from "@/utils/test-utils"
import { vscode } from "@/utils/vscode"
import { useCopyToClipboard } from "@/utils/clipboard"

import { TaskActions } from "../TaskActions"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

const state = vi.hoisted(() => ({ debug: false as boolean | undefined }))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => state,
	useExtensionSelector: (selector: (s: never) => unknown) => selector(state as never),
}))

vi.mock("@/utils/clipboard", () => ({
	useCopyToClipboard: vi.fn(),
}))

// What TaskActions hands the share button is all that matters here.
vi.mock("../ShareButton", () => ({
	ShareButton: ({ item, disabled }: { item?: HistoryItem; disabled: boolean }) => (
		<div data-testid="share-button" data-item={item?.id} data-disabled={String(disabled)} />
	),
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: vi.fn() },
}))

const mockPostMessage = vi.mocked(vscode.postMessage)
const copyWithFeedback = vi.fn()

const item: HistoryItem = {
	id: "test-task-id",
	number: 1,
	ts: 1,
	task: "Test task",
	tokensIn: 100,
	tokensOut: 200,
	totalCost: 0.01,
	size: 1024,
}

const button = (title: string) => screen.queryByRole("button", { name: title })

describe("TaskActions", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		state.debug = false
		vi.mocked(useCopyToClipboard).mockReturnValue({ copyWithFeedback, showCopyFeedback: false } as never)
	})

	it("exports the task and hands the item to an enabled share button", () => {
		render(<TaskActions item={item} buttonsDisabled={true} />)

		fireEvent.click(button("chat:task.export")!)

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "exportCurrentTask" })
		expect(screen.getByTestId("share-button")).toHaveAttribute("data-item", "test-task-id")
		expect(screen.getByTestId("share-button")).toHaveAttribute("data-disabled", "false")
	})

	it("copies the task prompt, and shows the check mark after copying", () => {
		const { rerender, container } = render(<TaskActions item={item} buttonsDisabled={false} />)

		fireEvent.click(button("history:copyPrompt")!)
		expect(copyWithFeedback).toHaveBeenCalledWith("Test task", expect.anything())
		expect(container.querySelector(".lucide-check")).toBeNull()

		vi.mocked(useCopyToClipboard).mockReturnValue({ copyWithFeedback, showCopyFeedback: true } as never)
		rerender(<TaskActions item={item} buttonsDisabled={false} />)
		expect(container.querySelector(".lucide-check")).not.toBeNull()
	})

	it.each([
		["no task text", { task: "" }, "history:copyPrompt"],
		["no size", { size: 0 }, "chat:task.delete"],
	])("offers no button without %s", (_name, override, title) => {
		render(<TaskActions item={{ ...item, ...override }} buttonsDisabled={false} />)

		expect(button(title)).toBeNull()
	})

	it("deletes at once on Shift+click and asks first on a plain click", () => {
		render(<TaskActions item={item} buttonsDisabled={false} />)

		fireEvent.click(button("chat:task.delete")!, { shiftKey: true })
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "deleteTaskWithId", text: "test-task-id" })
		expect(screen.queryByRole("alertdialog")).toBeNull()

		fireEvent.click(button("chat:task.delete")!)
		expect(screen.getByRole("alertdialog")).toBeInTheDocument()
	})

	it("disables only the delete button while the buttons are disabled", () => {
		render(<TaskActions item={item} buttonsDisabled={true} />)

		expect(button("chat:task.delete")).toBeDisabled()
		expect(button("chat:task.export")).toBeEnabled()
		expect(button("history:copyPrompt")).toBeEnabled()
	})

	it.each([
		["debug on", true, item, true],
		["debug off", false, item, false],
		["debug on without a task id", true, { ...item, id: "" }, false],
	])("with %s shows the debug buttons: %s", (_name, debug, taskItem, shown) => {
		state.debug = debug
		render(<TaskActions item={taskItem} buttonsDisabled={false} />)

		expect(button("chat:task.openApiHistory") !== null).toBe(shown)
		expect(button("chat:task.openUiHistory") !== null).toBe(shown)
	})

	it("the debug buttons open the API and the UI history", () => {
		state.debug = true
		render(<TaskActions item={item} buttonsDisabled={false} />)

		fireEvent.click(button("chat:task.openApiHistory")!)
		fireEvent.click(button("chat:task.openUiHistory")!)

		expect(mockPostMessage.mock.calls).toEqual([
			[{ type: "openDebugApiHistory" }],
			[{ type: "openDebugUiHistory" }],
		])
	})
})
