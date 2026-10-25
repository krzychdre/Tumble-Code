import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@/utils/vscode"

import { DeleteTaskDialog } from "../DeleteTaskDialog"

vi.mock("@/utils/vscode")

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) =>
			options?.count !== undefined ? `${key}:${options.count}` : key,
	}),
}))

// The keyboard boundary: what react-use reports for the Enter key.
vi.mock("react-use", () => ({ useKeyPress: vi.fn() }))

import { useKeyPress } from "react-use"

const enterPressed = (pressed: boolean) => vi.mocked(useKeyPress).mockReturnValue([pressed, null] as never)

const DELETE = { type: "deleteTaskWithId", text: "task-1" }

describe("DeleteTaskDialog", () => {
	const onOpenChange = vi.fn()

	beforeEach(() => {
		vi.clearAllMocks()
		enterPressed(false)
	})

	it("Delete posts the deletion and closes", () => {
		render(<DeleteTaskDialog taskId="task-1" open onOpenChange={onOpenChange} />)

		fireEvent.click(screen.getByText("history:delete"))

		expect(vscode.postMessage).toHaveBeenCalledWith(DELETE)
		expect(onOpenChange).toHaveBeenCalledWith(false)
	})

	it.each([
		{ name: "Cancel", close: () => fireEvent.click(screen.getByText("history:cancel")) },
		{ name: "Escape", close: () => fireEvent.keyDown(document.activeElement!, { key: "Escape" }) },
	])("$name closes without deleting", ({ close }) => {
		render(<DeleteTaskDialog taskId="task-1" open onOpenChange={onOpenChange} />)

		close()

		expect(onOpenChange).toHaveBeenCalledWith(false)
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it.each([
		{ name: "Enter deletes the task", taskId: "task-1", pressed: true, posts: [[DELETE]] },
		{ name: "Enter without a task deletes nothing", taskId: "", pressed: true, posts: [] },
		{ name: "no key, no deletion", taskId: "task-1", pressed: false, posts: [] },
	])("$name", ({ taskId, pressed, posts }) => {
		enterPressed(pressed)

		render(<DeleteTaskDialog taskId={taskId} open onOpenChange={onOpenChange} />)

		expect(vi.mocked(vscode.postMessage).mock.calls).toEqual(posts)
		// A deletion by Enter closes the dialog itself (no Radix button is involved).
		expect(onOpenChange.mock.calls).toEqual(posts.length ? [[false]] : [])
	})

	it("a click on Delete without a task deletes nothing and keeps the dialog", () => {
		render(<DeleteTaskDialog taskId="" open onOpenChange={onOpenChange} />)

		fireEvent.click(screen.getByText("history:delete"))

		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it.each([
		{ subtaskCount: undefined, message: "history:deleteTaskMessage" },
		{ subtaskCount: 0, message: "history:deleteTaskMessage" },
		{ subtaskCount: 3, message: "history:deleteWithSubtasks:3" },
	])("warns about the subtasks deleted with it: $subtaskCount", ({ subtaskCount, message }) => {
		render(<DeleteTaskDialog taskId="task-1" subtaskCount={subtaskCount} open onOpenChange={onOpenChange} />)

		expect(screen.getByText(message)).toBeInTheDocument()
	})
})
