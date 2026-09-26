import { render, screen } from "@/utils/test-utils"

import { ThemedBadge } from "../themed-badge"

describe("ThemedBadge", () => {
	it("shows its content inside the pill and puts className and style on the outer element", () => {
		render(
			<ThemedBadge className="opacity-0" style={{ fontSize: "10px" }} data-testid="badge">
				$0.12
			</ThemedBadge>,
		)

		const badge = screen.getByTestId("badge")
		expect(badge).toHaveClass("ui-badge", "opacity-0")
		expect(badge.style.fontSize).toBe("10px")
		expect(screen.getByText("$0.12")).toHaveClass("ui-badge-control")
		expect(screen.getByText("$0.12").parentElement).toBe(badge)
	})
})
