import React from "react"

import { render, screen } from "@/utils/test-utils"

import { Link } from "../link"
import { Collapsible, CollapsibleTrigger } from "../collapsible"

describe("Link", () => {
	it("is a keyboard-focusable link with the given href and text", () => {
		render(
			<p>
				<Link href="https://example.com/docs">Docs</Link>
			</p>,
		)

		const link = screen.getByRole("link", { name: "Docs" })
		expect(link).toHaveAttribute("href", "https://example.com/docs")

		// In the tab order (vitest.setup.ts stubs focus() for the toolkit, so
		// tabbing cannot be asserted directly).
		expect(link.tabIndex).toBe(0)
	})

	it("takes its accessible name from aria-label", () => {
		render(<Link href="https://example.com/modes" aria-label="Learn about using modes" />)

		expect(screen.getByRole("link", { name: "Learn about using modes" })).toBeInTheDocument()
	})

	it("fires onClick, and a handler can cancel the navigation", () => {
		const onClick = vi.fn((e: React.MouseEvent) => e.preventDefault())
		render(
			<Link href="#" onClick={onClick}>
				Settings
			</Link>,
		)

		screen.getByRole("link", { name: "Settings" }).click()

		expect(onClick).toHaveBeenCalledTimes(1)
		expect(onClick.mock.calls[0][0].defaultPrevented).toBe(true)
	})

	it("keeps the VS Code link class first so call-site classes and styles apply", () => {
		render(
			<Link href="#" className="text-sm underline" style={{ display: "inline" }}>
				Styled
			</Link>,
		)

		const link = screen.getByRole("link", { name: "Styled" })
		expect(link.className).toBe("ui-link text-sm underline")
		expect(link.style.display).toBe("inline")
	})

	it("wraps the children in one content span, like the toolkit's content part", () => {
		render(
			<Link href="#">
				Text <svg data-testid="icon" />
			</Link>,
		)

		const link = screen.getByRole("link")
		expect(link.children).toHaveLength(1)
		expect(link.firstElementChild).toHaveClass("ui-link-content")
		expect(screen.getByTestId("icon").parentElement).toBe(link.firstElementChild)
	})

	it("forwards the ref, so it works as a Radix asChild trigger", () => {
		const onOpenChange = vi.fn()
		render(
			<Collapsible open={false} onOpenChange={onOpenChange}>
				<CollapsibleTrigger asChild>
					<Link>More</Link>
				</CollapsibleTrigger>
			</Collapsible>,
		)

		const trigger = screen.getByText("More").closest("a")!
		expect(trigger).toHaveAttribute("aria-expanded", "false")
		trigger.click()
		expect(onOpenChange).toHaveBeenCalledWith(true)
	})
})
