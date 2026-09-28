import React from "react"

import { fireEvent, render, screen } from "@/utils/test-utils"

import { Button } from "../button"

// Button variant="icon" took over the icon appearance of the removed
// ThemedButton (UI plan §2.12 part c); these are that component's assertions,
// kept for the variant.
describe("Button variant icon", () => {
	it("is a keyboard-focusable non-submit button with the icon look", () => {
		render(<Button variant="icon">Configure</Button>)

		const button = screen.getByRole("button", { name: "Configure" })
		expect(button.tabIndex).toBe(0)
		expect(button).toHaveClass("ui-button-icon")
		// Never submits a surrounding form by accident.
		expect(button).toHaveAttribute("type", "button")
	})

	it("keeps an explicit type", () => {
		render(
			<Button variant="icon" type="submit">
				Go
			</Button>,
		)
		expect(screen.getByRole("button", { name: "Go" })).toHaveAttribute("type", "submit")
	})

	it("takes its accessible name from title for an icon-only button", () => {
		render(
			<Button variant="icon" title="Reset to default">
				<span className="codicon codicon-discard" />
			</Button>,
		)

		expect(screen.getByRole("button", { name: "Reset to default" })).toHaveClass("ui-button-icon")
	})

	it("fires onClick, and the handler can stop the click from reaching the parent", () => {
		const parent = vi.fn()
		const onClick = vi.fn((e: React.MouseEvent) => e.stopPropagation())
		render(
			<div onClick={parent}>
				<Button variant="icon" onClick={onClick}>
					Copy
				</Button>
			</div>,
		)

		fireEvent.click(screen.getByRole("button", { name: "Copy" }))

		expect(onClick).toHaveBeenCalledTimes(1)
		expect(parent).not.toHaveBeenCalled()
	})

	it("puts className, style and data-testid on the button and wraps children in one content span", () => {
		render(
			<Button variant="icon" className="h-6" style={{ height: 24 }} data-testid="b">
				<span className="codicon codicon-copy" />
			</Button>,
		)

		const button = screen.getByTestId("b")
		expect(button.tagName).toBe("BUTTON")
		expect(button).toHaveClass("ui-button-icon", "h-6")
		expect(button.style.height).toBe("24px")
		expect(button.children).toHaveLength(1)
		expect(button.firstElementChild).toHaveClass("ui-button-icon-content")
	})

	it("forwards the ref to the button", () => {
		const ref = React.createRef<HTMLButtonElement>()
		render(
			<Button variant="icon" ref={ref}>
				X
			</Button>,
		)

		expect(ref.current).toBe(screen.getByRole("button"))
	})

	it("leaves the other variants on buttonVariants without a content wrapper", () => {
		render(<Button variant="secondary">Plain</Button>)
		const button = screen.getByRole("button", { name: "Plain" })
		expect(button).not.toHaveClass("ui-button-icon")
		expect(button.querySelector(".ui-button-icon-content")).toBeNull()
		expect(button).not.toHaveAttribute("type")
	})
})
