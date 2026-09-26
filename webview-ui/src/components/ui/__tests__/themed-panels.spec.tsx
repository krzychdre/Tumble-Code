import { fireEvent, render, screen } from "@/utils/test-utils"

import { ThemedPanels, ThemedPanelTab, ThemedPanelView } from "../themed-panels"

const Panels = ({ withExtra = false }: { withExtra?: boolean }) => (
	<ThemedPanels style={{ marginBottom: "10px" }}>
		<ThemedPanelTab id="one">One</ThemedPanelTab>
		<ThemedPanelTab id="two">Two</ThemedPanelTab>
		{withExtra && <ThemedPanelTab id="extra">Extra</ThemedPanelTab>}
		<ThemedPanelView id="one-view">first</ThemedPanelView>
		<ThemedPanelView id="two-view">second</ThemedPanelView>
		{withExtra && <ThemedPanelView id="extra-view">third</ThemedPanelView>}
	</ThemedPanels>
)

const selected = () => screen.getAllByRole("tab").map((tab) => tab.getAttribute("aria-selected"))
const visible = () =>
	screen
		.getAllByRole("tabpanel", { hidden: true })
		.filter((panel) => !panel.hasAttribute("hidden"))
		.map((panel) => panel.textContent)

describe("ThemedPanels", () => {
	it("pairs the n-th tab with the n-th view, keeps the call site's ids and selects the first tab", () => {
		render(<Panels />)

		expect(screen.getByRole("tablist")).toBeInTheDocument()
		expect(screen.getByLabelText("Panels")).toHaveStyle({ marginBottom: "10px" })
		const [one, two] = screen.getAllByRole("tab")
		expect(one).toHaveAttribute("id", "one")
		expect(one).toHaveAttribute("aria-controls", "one-view")
		expect(two).toHaveAttribute("aria-controls", "two-view")
		expect(screen.getByText("second")).toHaveAttribute("aria-labelledby", "two")
		expect(selected()).toEqual(["true", "false"])
		expect(visible()).toEqual(["first"])
	})

	it("selects a tab on click and shows only its view", () => {
		render(<Panels />)

		fireEvent.click(screen.getByRole("tab", { name: "Two" }))

		expect(selected()).toEqual(["false", "true"])
		expect(visible()).toEqual(["second"])
	})

	it("moves with arrow keys (wrapping), Home and End; only the selected tab is tabbable", () => {
		render(<Panels withExtra />)
		const tab = (name: string) => screen.getByRole("tab", { name })

		fireEvent.keyDown(tab("One"), { key: "ArrowLeft" })
		expect(selected()).toEqual(["false", "false", "true"])
		fireEvent.keyDown(tab("Extra"), { key: "ArrowRight" })
		expect(selected()).toEqual(["true", "false", "false"])
		fireEvent.keyDown(tab("One"), { key: "End" })
		expect(selected()).toEqual(["false", "false", "true"])
		fireEvent.keyDown(tab("Extra"), { key: "Home" })
		expect(selected()).toEqual(["true", "false", "false"])
		expect(screen.getAllByRole("tab").map((t) => t.tabIndex)).toEqual([0, -1, -1])
	})

	it("keeps a valid selection when the selected tab goes away", () => {
		const { rerender } = render(<Panels withExtra />)
		fireEvent.click(screen.getByRole("tab", { name: "Extra" }))

		rerender(<Panels />)

		expect(selected()).toEqual(["false", "true"])
		expect(visible()).toEqual(["second"])
	})
})
