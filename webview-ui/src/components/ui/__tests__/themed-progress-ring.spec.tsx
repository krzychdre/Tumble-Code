import { render, screen } from "@/utils/test-utils"

import { ThemedProgressRing } from "../themed-progress-ring"

describe("ThemedProgressRing", () => {
	it("is a live 'Loading' alert with the call site's classes and a decorative ring", () => {
		const { container } = render(<ThemedProgressRing className="size-3 mr-2" />)

		const ring = screen.getByRole("alert", { name: "Loading" })
		expect(ring).toHaveAttribute("aria-live", "assertive")
		expect(ring).toHaveClass("ui-progress-ring", "size-3", "mr-2")
		expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
		expect(container.querySelector(".ui-progress-ring-indicator")).not.toBeNull()
	})

	it("lets a call site override the announcement", () => {
		render(<ThemedProgressRing aria-label="Signing in" />)

		expect(screen.getByRole("alert", { name: "Signing in" })).toBeInTheDocument()
	})
})
