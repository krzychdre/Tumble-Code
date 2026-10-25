import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { StandardTooltip } from "../standard-tooltip"
import { TooltipProvider } from "../tooltip"

const hoverTooltip = async (content: React.ReactNode, maxWidth?: number | string) => {
	render(
		<TooltipProvider delayDuration={0}>
			<StandardTooltip content={content} maxWidth={maxWidth} delay={0}>
				<button>Hover me</button>
			</StandardTooltip>
		</TooltipProvider>,
	)
	await userEvent.setup().hover(screen.getByText("Hover me"))
}

describe("StandardTooltip", () => {
	it.each([
		{ maxWidth: undefined, style: "" },
		{ maxWidth: 200, style: "200px" },
		{ maxWidth: "15rem", style: "15rem" },
	])("shows the content on hover with maxWidth $maxWidth as an inline style", async ({ maxWidth, style }) => {
		await hoverTooltip("Tooltip text", maxWidth)

		const tooltip = await screen.findByRole("tooltip")
		expect(tooltip).toHaveTextContent("Tooltip text")
		expect(tooltip.style.maxWidth).toBe(style)
	})

	it.each([
		["empty", ""],
		["whitespace", "   "],
		["missing", null],
	])("renders only the trigger for %s content", async (_, content) => {
		await hoverTooltip(content)

		expect(screen.getByText("Hover me")).toBeInTheDocument()
		await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument())
	})
})
