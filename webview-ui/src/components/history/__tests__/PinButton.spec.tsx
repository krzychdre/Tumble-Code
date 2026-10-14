import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import { PinButton } from "../PinButton"

vi.mock("@src/utils/vscode")

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("PinButton", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("pins a task that is not pinned", () => {
		render(<PinButton itemId="1" pinned={false} />)

		const button = screen.getByRole("button", { name: "history:pinTask" })
		expect(button).toHaveAttribute("aria-pressed", "false")
		fireEvent.click(button)

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "setTaskPinned", text: "1", bool: true })
	})

	it("unpins a pinned task and shows the filled pin", () => {
		render(<PinButton itemId="1" pinned />)

		const button = screen.getByRole("button", { name: "history:unpinTask" })
		expect(button).toHaveAttribute("aria-pressed", "true")
		expect(button.querySelector(".codicon-pinned")).not.toBeNull()
		fireEvent.click(button)

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "setTaskPinned", text: "1", bool: false })
	})

	it("does not open the task of the row it sits in", () => {
		const openRow = vi.fn()
		render(
			<div onClick={openRow}>
				<PinButton itemId="1" pinned={false} />
			</div>,
		)

		fireEvent.click(screen.getByRole("button", { name: "history:pinTask" }))

		expect(openRow).not.toHaveBeenCalled()
	})
})
