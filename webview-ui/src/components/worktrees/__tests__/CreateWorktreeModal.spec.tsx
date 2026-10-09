import { render, screen } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"

import { CreateWorktreeModal } from "../CreateWorktreeModal"

const mockPostMessage = vi.fn()

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: (...args: unknown[]) => mockPostMessage(...args),
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("CreateWorktreeModal browse button", () => {
	beforeEach(() => {
		mockPostMessage.mockClear()
	})

	const browseCalls = () =>
		mockPostMessage.mock.calls.filter(([message]) => message?.type === "browseForWorktreePath").length

	it("is a labelled button", () => {
		render(<CreateWorktreeModal open={true} onClose={vi.fn()} />)

		const button = screen.getByRole("button", { name: "worktrees:browseFolder" })
		expect(button).toHaveAttribute("type", "button")
	})

	it("is reached with Tab from the path input and opens the folder picker with Enter and Space", async () => {
		const user = userEvent.setup()
		render(<CreateWorktreeModal open={true} onClose={vi.fn()} />)

		const pathInput = screen.getByPlaceholderText("/path/to/worktree")
		pathInput.focus()
		await user.tab()

		const button = screen.getByRole("button", { name: "worktrees:browseFolder" })
		expect(button).toHaveFocus()

		await user.keyboard("{Enter}")
		expect(browseCalls()).toBe(1)

		await user.keyboard(" ")
		expect(browseCalls()).toBe(2)
	})

	it("still opens the folder picker on a mouse click", async () => {
		const user = userEvent.setup()
		render(<CreateWorktreeModal open={true} onClose={vi.fn()} />)

		await user.click(screen.getByRole("button", { name: "worktrees:browseFolder" }))
		expect(browseCalls()).toBe(1)
	})
})
