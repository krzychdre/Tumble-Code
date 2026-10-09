// npx vitest run src/components/chat/checkpoints/__tests__/CheckpointSaved.spec.tsx

// Capture onOpenChange from Popover to control open/close in tests
let lastOnOpenChange: ((open: boolean) => void) | undefined

vi.mock("@/components/ui", () => {
	// Minimal UI primitives to ensure deterministic behavior in tests
	return {
		Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
		StandardTooltip: ({ children }: any) => <>{children}</>,
		Popover: (props: any) => {
			const { children, onOpenChange, open, ...rest } = props
			if (rest["data-testid"] === "restore-popover") {
				lastOnOpenChange = onOpenChange
			}
			return (
				<div data-testid={rest["data-testid"]} data-open={open}>
					{children}
				</div>
			)
		},
		PopoverTrigger: ({ children }: any) => <div data-testid="popover-trigger">{children}</div>,
		PopoverContent: ({ children, className, ...rest }: any) => (
			<div data-testid="popover-content" className={className} {...rest}>
				{children}
			</div>
		),
	}
})

import { render, waitFor, screen, fireEvent } from "@/utils/test-utils"
import React from "react"
import userEvent from "@testing-library/user-event"
import { CheckpointSaved } from "../CheckpointSaved"

const waitForOpenHandler = async () => {
	await waitFor(() => {
		// ensure Popover mock captured the onOpenChange handler before using it
		expect(lastOnOpenChange).toBeTruthy()
	})
}

describe("CheckpointSaved popover visibility", () => {
	// Timers are controlled per-test to avoid interfering with i18n init
	const baseProps = {
		ts: 123,
		commitHash: "abc123",
		currentHash: "zzz999",
		checkpoint: { from: "prev123", to: "abc123" } as Record<string, unknown>,
	}

	it("shows menu while popover is open and hides when closed", async () => {
		const { getByTestId } = render(<CheckpointSaved {...baseProps} />)

		const getMenu = () => getByTestId("checkpoint-menu-container") as HTMLElement

		// Initially hidden (not hovering)
		expect(getMenu()).toBeTruthy()
		expect(getMenu().className).toContain("sr-only")

		// Open via captured handler
		await waitForOpenHandler()
		lastOnOpenChange?.(true)

		await waitFor(() => {
			expect(getMenu().className).toContain("block")
			expect(getMenu().className).not.toContain("sr-only")
		})

		// Close via captured handler: menu remains visible briefly, then hides
		lastOnOpenChange?.(false)

		await waitFor(() => {
			expect(getMenu().className).toContain("block")
		})

		await waitFor(() => {
			expect(getMenu().className).toContain("sr-only")
		})
	})

	it("resets confirm state when popover closes", async () => {
		const { getByTestId, container } = render(<CheckpointSaved {...baseProps} />)
		const getParentDiv = () =>
			container.querySelector("[class*='flex items-center justify-between']") as HTMLElement

		// Hover to make menu visible
		fireEvent.mouseEnter(getParentDiv())

		// Open the popover
		await waitForOpenHandler()
		lastOnOpenChange?.(true)

		// Enter confirm state
		const restoreFilesAndTaskBtn = await waitFor(() => getByTestId("restore-files-and-task-btn"))
		await userEvent.click(restoreFilesAndTaskBtn)

		// Confirm warning should be visible
		expect(getByTestId("checkpoint-confirm-warning")).toBeTruthy()

		// Close popover -> confirm state should reset
		lastOnOpenChange?.(false)

		// Reopen
		lastOnOpenChange?.(true)

		// Confirm warning should be gone after reopening
		await waitFor(() => {
			expect(screen.queryByTestId("checkpoint-confirm-warning")).toBeNull()
		})
	})

	it("shows a check glyph on confirm and a cross glyph on cancel in the confirm state", async () => {
		const { getByTestId, container } = render(<CheckpointSaved {...baseProps} />)
		const getParentDiv = () =>
			container.querySelector("[class*='flex items-center justify-between']") as HTMLElement

		fireEvent.mouseEnter(getParentDiv())
		await waitForOpenHandler()
		lastOnOpenChange?.(true)

		await userEvent.click(await waitFor(() => getByTestId("restore-files-and-task-btn")))

		const confirm = getByTestId("confirm-restore-btn")
		expect(confirm.querySelectorAll("svg")).toHaveLength(1)
		expect(confirm.textContent).toContain("chat:checkpoint.menu.confirm")

		const cancel = screen.getByText("chat:checkpoint.menu.cancel").closest("button") as HTMLElement
		expect(cancel.querySelectorAll("svg")).toHaveLength(1)
		// Glyph first, label second.
		expect(confirm.querySelector("svg")?.nextElementSibling?.textContent).toBe("chat:checkpoint.menu.confirm")
		expect(cancel.querySelector("svg")?.nextElementSibling?.textContent).toBe("chat:checkpoint.menu.cancel")
	})

	it("closes popover after preview and after confirm restore", async () => {
		const { getByTestId, container } = render(<CheckpointSaved {...baseProps} />)

		const popoverRoot = () => getByTestId("restore-popover")
		const menuContainer = () => getByTestId("checkpoint-menu-container")
		const getParentDiv = () =>
			container.querySelector("[class*='flex items-center justify-between']") as HTMLElement

		// Open
		await waitForOpenHandler()
		lastOnOpenChange?.(true)
		await waitFor(() => {
			expect(popoverRoot().getAttribute("data-open")).toBe("true")
			expect(menuContainer().className).toContain("block")
		})

		// Click preview -> popover closes; menu remains briefly visible, then hides
		await userEvent.click(getByTestId("restore-files-btn"))
		await waitFor(() => {
			expect(popoverRoot().getAttribute("data-open")).toBe("false")
			expect(menuContainer().className).toContain("block")
		})

		// Simulate mouse leaving the component to trigger hide
		fireEvent.mouseLeave(getParentDiv())

		await waitFor(() => {
			expect(menuContainer().className).toContain("sr-only")
		})

		// Hover to make menu visible again, then reopen
		fireEvent.mouseEnter(getParentDiv())
		lastOnOpenChange?.(true)
		await waitFor(() => {
			expect(popoverRoot().getAttribute("data-open")).toBe("true")
		})

		// Enter confirm and confirm restore -> popover closes; menu then hides
		await userEvent.click(getByTestId("restore-files-and-task-btn"))
		await userEvent.click(getByTestId("confirm-restore-btn"))
		await waitFor(() => {
			expect(popoverRoot().getAttribute("data-open")).toBe("false")
		})

		// Simulate mouse leaving the component to trigger hide
		fireEvent.mouseLeave(getParentDiv())

		await waitFor(() => {
			expect(menuContainer().className).toContain("sr-only")
		})
	})

	it("shows menu on hover and hides when mouse leaves", async () => {
		const { getByTestId, container } = render(<CheckpointSaved {...baseProps} />)

		const getMenu = () => getByTestId("checkpoint-menu-container") as HTMLElement
		const getParentDiv = () =>
			container.querySelector("[class*='flex items-center justify-between']") as HTMLElement

		// Initially hidden (not hovering)
		expect(getMenu().className).toContain("sr-only")

		// Hover over the component
		fireEvent.mouseEnter(getParentDiv())
		await waitFor(() => {
			expect(getMenu().className).toContain("block")
			expect(getMenu().className).not.toContain("sr-only")
		})

		// Mouse leaves the component
		fireEvent.mouseLeave(getParentDiv())
		await waitFor(() => {
			expect(getMenu().className).toContain("sr-only")
		})
	})

	it("renders jump-to-previous-checkpoint control and triggers callback", async () => {
		const onJumpToPreviousCheckpoint = vi.fn()
		const { getByTestId, container } = render(
			<CheckpointSaved {...baseProps} onJumpToPreviousCheckpoint={onJumpToPreviousCheckpoint} />,
		)

		const getParentDiv = () =>
			container.querySelector("[class*='flex items-center justify-between']") as HTMLElement

		fireEvent.mouseEnter(getParentDiv())

		const jumpButton = await waitFor(() => getByTestId("jump-previous-checkpoint-btn"))
		await userEvent.click(jumpButton)

		expect(onJumpToPreviousCheckpoint).toHaveBeenCalledTimes(1)
	})

	it("keeps the menu buttons in the Tab order and shows the menu while focus is inside the row", async () => {
		const user = userEvent.setup()
		render(
			<>
				<CheckpointSaved {...baseProps} onJumpToPreviousCheckpoint={() => {}} />
				<button type="button">after</button>
			</>,
		)

		const getMenu = () => screen.getByTestId("checkpoint-menu-container") as HTMLElement
		expect(getMenu().className).not.toContain("block")

		// Tab reaches the first menu button even though the mouse never hovered the row.
		await user.tab()
		expect(screen.getByRole("button", { name: "chat:checkpoint.menu.viewDiff" })).toHaveFocus()
		expect(getMenu().className).toContain("block")

		// Moving focus between the menu's own buttons keeps the menu open. (The Popover mock renders the
		// popover content inline, so its buttons sit in the Tab order here too; walk until the row ends.)
		const after = screen.getByRole("button", { name: "after" })
		const visited: Array<string | null> = []
		for (let i = 0; i < 20; i++) {
			await user.tab()
			if (document.activeElement === after) {
				break
			}
			visited.push(
				document.activeElement?.getAttribute("aria-label") ??
					document.activeElement?.getAttribute("data-testid") ??
					null,
			)
			expect(getMenu().className).toContain("block")
		}
		expect(visited).toEqual(
			expect.arrayContaining([
				"chat:checkpoint.menu.restore",
				"chat:scrollToLatestCheckpoint",
				"chat:checkpoint.menu.more",
			]),
		)

		// Leaving the row hides the menu again.
		expect(after).toHaveFocus()
		expect(getMenu().className).not.toContain("block")
	})
})
