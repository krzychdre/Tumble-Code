import React from "react"

import { fireEvent, render, screen } from "@/utils/test-utils"

import { ThemedButton } from "../themed-button"

describe("ThemedButton", () => {
	it("is a keyboard-focusable button named by its text, primary by default", () => {
		render(<ThemedButton>Configure</ThemedButton>)

		const button = screen.getByRole("button", { name: "Configure" })
		expect(button.tabIndex).toBe(0)
		expect(button).toHaveAttribute("data-appearance", "primary")
		// Never submits a surrounding form by accident.
		expect(button).toHaveAttribute("type", "button")
	})

	it("takes its accessible name from title for an icon-only button", () => {
		render(
			<ThemedButton appearance="icon" title="Reset to default">
				<span className="codicon codicon-discard" />
			</ThemedButton>,
		)

		expect(screen.getByRole("button", { name: "Reset to default" })).toHaveAttribute("data-appearance", "icon")
	})

	it("fires onClick, and the handler can stop the click from reaching the parent", () => {
		const parent = vi.fn()
		const onClick = vi.fn((e: React.MouseEvent) => e.stopPropagation())
		render(
			<div onClick={parent}>
				<ThemedButton onClick={onClick}>Copy</ThemedButton>
			</div>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Copy" }))

		expect(onClick).toHaveBeenCalledTimes(1)
		expect(parent).not.toHaveBeenCalled()
	})

	it("puts className, style and data-testid on the button and wraps children in one content span", () => {
		render(
			<ThemedButton appearance="secondary" className="h-6" style={{ height: 24 }} data-testid="b">
				<span className="codicon codicon-copy" />
			</ThemedButton>,
		)

		const button = screen.getByTestId("b")
		expect(button.tagName).toBe("BUTTON")
		expect(button).toHaveClass("ui-themed-button", "h-6")
		expect(button.style.height).toBe("24px")
		expect(button.children).toHaveLength(1)
		expect(button.firstElementChild).toHaveClass("ui-themed-button-content")
	})

	it("forwards the ref to the button", () => {
		const ref = React.createRef<HTMLButtonElement>()
		render(<ThemedButton ref={ref}>X</ThemedButton>)

		expect(ref.current).toBe(screen.getByRole("button"))
	})
})
