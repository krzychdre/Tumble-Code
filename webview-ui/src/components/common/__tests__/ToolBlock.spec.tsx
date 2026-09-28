import { render, screen } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"

import { ToolBlock } from "../ToolBlock"

describe("ToolBlock (§2.2 primitive)", () => {
	it("renders the header as a button with aria-expanded and aria-controls when collapsible", () => {
		render(
			<ToolBlock isExpanded={false} onToggleExpand={() => {}} toolName="read_file">
				<body />
			</ToolBlock>,
		)

		const header = screen.getByRole("button")
		expect(header).toHaveAttribute("aria-expanded", "false")
		expect(header).toHaveAttribute("aria-controls")
	})

	it("toggles expansion through the header button", async () => {
		const user = userEvent.setup()
		const onToggleExpand = vi.fn()
		const { rerender } = render(
			<ToolBlock isExpanded={false} onToggleExpand={onToggleExpand} toolName="read_file">
				<div>body content</div>
			</ToolBlock>,
		)

		expect(screen.getByText("body content")).not.toBeVisible()

		await user.click(screen.getByRole("button"))
		expect(onToggleExpand).toHaveBeenCalledTimes(1)

		// The owner re-renders expanded: the body becomes visible.
		rerender(
			<ToolBlock isExpanded={true} onToggleExpand={onToggleExpand} toolName="read_file">
				<div>body content</div>
			</ToolBlock>,
		)
		expect(screen.getByText("body content")).toBeVisible()
	})

	it("renders a non-interactive header when there is no body or no handler", () => {
		const { container: noBody } = render(<ToolBlock toolName="read_file" />)
		const header = noBody.querySelector("button")
		expect(header).not.toBeNull()
		expect(header).toBeDisabled()
		// Nothing to fold away: no expand semantics on the header.
		expect(header).not.toHaveAttribute("aria-expanded")
		expect(header).not.toHaveAttribute("aria-controls")

		const { container: noHandler } = render(
			<ToolBlock toolName="read_file">
				<div>body content</div>
			</ToolBlock>,
		)
		expect(noHandler.querySelector("button")).toBeDisabled()
	})

	it("shows the chevron at 60% opacity by default, never fully hidden", () => {
		render(
			<ToolBlock isExpanded={false} onToggleExpand={() => {}} toolName="read_file">
				<div>body</div>
			</ToolBlock>,
		)

		const chevron = screen.getByRole("button").querySelector("svg")
		expect(chevron).not.toBeNull()
		expect(chevron).toHaveClass("opacity-60")
		expect(chevron).not.toHaveClass("opacity-0")
	})

	it("carries a --border-status left border in the status color", () => {
		render(
			<ToolBlock status="failed" onToggleExpand={() => {}} toolName="bash">
				<div>body</div>
			</ToolBlock>,
		)

		// jsdom does not resolve custom properties through toHaveStyle, so the
		// raw inline style string is asserted directly.
		const block = screen.getByRole("button").parentElement
		expect(block?.getAttribute("style")).toBe(
			"border-left: var(--border-status) solid var(--status-failed);",
		)
	})

	it("pairs the failed status color with a textual failed label (§1.3)", () => {
		render(
			<ToolBlock status="failed" onToggleExpand={() => {}} toolName="bash">
				<div>body</div>
			</ToolBlock>,
		)

		expect(screen.getByText("failed")).toBeVisible()
	})

	it("renders without a status border when no status is given", () => {
		render(
			<ToolBlock onToggleExpand={() => {}} toolName="read_file">
				<div>body</div>
			</ToolBlock>,
		)

		const block = screen.getByRole("button").parentElement
		expect(block?.getAttribute("style")).toBeNull()
	})
})
