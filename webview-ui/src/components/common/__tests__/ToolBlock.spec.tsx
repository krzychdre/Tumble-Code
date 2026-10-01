import { render, screen } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"

import { ToolBlock } from "../ToolBlock"

describe("ToolBlock (§2.2 primitive)", () => {
	it("renders the header as a button with aria-expanded and aria-controls when collapsible", () => {
		render(
			<ToolBlock isExpanded={false} onToggleExpand={() => {}} title="read_file">
				<body />
			</ToolBlock>,
		)

		const header = screen.getByRole("button")
		expect(header).toHaveAttribute("aria-expanded", "false")
		// The body is not mounted while collapsed, so there is nothing to point at yet.
		expect(header).not.toHaveAttribute("aria-controls")
	})

	it("points aria-controls at the body once expanded", () => {
		render(
			<ToolBlock isExpanded={true} onToggleExpand={() => {}} title="read_file">
				<div>body content</div>
			</ToolBlock>,
		)

		const controls = screen.getByRole("button").getAttribute("aria-controls")
		expect(document.getElementById(controls!)).toHaveTextContent("body content")
	})

	it("toggles expansion through the header button", async () => {
		const user = userEvent.setup()
		const onToggleExpand = vi.fn()
		const { rerender } = render(
			<ToolBlock isExpanded={false} onToggleExpand={onToggleExpand} title="read_file">
				<div>body content</div>
			</ToolBlock>,
		)

		expect(screen.queryByText("body content")).not.toBeInTheDocument()

		await user.click(screen.getByRole("button"))
		expect(onToggleExpand).toHaveBeenCalledTimes(1)

		// The owner re-renders expanded: the body becomes visible.
		rerender(
			<ToolBlock isExpanded={true} onToggleExpand={onToggleExpand} title="read_file">
				<div>body content</div>
			</ToolBlock>,
		)
		expect(screen.getByText("body content")).toBeVisible()
	})

	it("toggles with the keyboard", async () => {
		const user = userEvent.setup()
		const onToggleExpand = vi.fn()
		render(
			<ToolBlock isExpanded={false} onToggleExpand={onToggleExpand} title="read_file">
				<div>body</div>
			</ToolBlock>,
		)

		await user.tab()
		expect(screen.getByRole("button")).toHaveFocus()
		await user.keyboard("{Enter}")
		await user.keyboard(" ")
		expect(onToggleExpand).toHaveBeenCalledTimes(2)
	})

	it("keeps header actions outside the toggle button", async () => {
		const user = userEvent.setup()
		const onToggleExpand = vi.fn()
		const onAction = vi.fn()
		render(
			<ToolBlock
				isExpanded={false}
				onToggleExpand={onToggleExpand}
				title="read_file"
				actions={
					<button type="button" onClick={onAction}>
						open
					</button>
				}>
				<div>body</div>
			</ToolBlock>,
		)

		const action = screen.getByRole("button", { name: "open" })
		expect(screen.getByRole("button", { name: "read_file" })).not.toContainElement(action)
		await user.click(action)
		expect(onAction).toHaveBeenCalledTimes(1)
		expect(onToggleExpand).not.toHaveBeenCalled()
	})

	it("renders a non-interactive header when there is no body or no handler", () => {
		const { container: noBody } = render(<ToolBlock title="read_file" />)
		const header = noBody.querySelector("button")
		expect(header).not.toBeNull()
		expect(header).toBeDisabled()
		// Nothing to fold away: no expand semantics on the header.
		expect(header).not.toHaveAttribute("aria-expanded")
		expect(header).not.toHaveAttribute("aria-controls")

		const { container: noHandler } = render(
			<ToolBlock title="read_file">
				<div>body content</div>
			</ToolBlock>,
		)
		expect(noHandler.querySelector("button")).toBeDisabled()
	})

	it("shows the chevron at 60% opacity by default, never fully hidden", () => {
		render(
			<ToolBlock isExpanded={false} onToggleExpand={() => {}} title="read_file">
				<div>body</div>
			</ToolBlock>,
		)

		const chevron = screen.getByRole("button").parentElement!.querySelector(".codicon-chevron-down")
		expect(chevron).not.toBeNull()
		expect(chevron).toHaveClass("opacity-60")
		expect(chevron).not.toHaveClass("opacity-0")
		// Full opacity on hover and while the toggle has keyboard focus.
		expect(chevron).toHaveClass("group-hover:opacity-100")
		expect(chevron).toHaveClass("group-has-[button[aria-expanded]:focus-visible]:opacity-100")
	})

	it("carries a --border-status left border in the status color", () => {
		render(
			<ToolBlock status="failed" onToggleExpand={() => {}} title="bash">
				<div>body</div>
			</ToolBlock>,
		)

		// jsdom does not resolve custom properties through toHaveStyle, so the
		// raw inline style string is asserted directly.
		const block = screen.getByRole("button").parentElement!.parentElement
		expect(block?.getAttribute("style")).toBe("border-left: var(--border-status) solid var(--status-failed);")
	})

	it("pairs the failed status color with a textual failed label (§1.3)", () => {
		render(
			<ToolBlock status="failed" onToggleExpand={() => {}} title="bash">
				<div>body</div>
			</ToolBlock>,
		)

		expect(screen.getByText("failed")).toBeVisible()
	})

	it("renders without a status border when no status is given", () => {
		render(
			<ToolBlock onToggleExpand={() => {}} title="read_file">
				<div>body</div>
			</ToolBlock>,
		)

		const block = screen.getByRole("button").parentElement!.parentElement
		expect(block?.getAttribute("style")).toBeNull()
	})
})
