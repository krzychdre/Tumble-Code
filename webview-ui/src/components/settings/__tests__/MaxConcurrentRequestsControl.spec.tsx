import { render, screen, fireEvent } from "@testing-library/react"

import { MaxConcurrentRequestsControl } from "../MaxConcurrentRequestsControl"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => {
			const translations: Record<string, string> = {
				"settings:providers.maxConcurrentRequests.label": "Max concurrent requests",
				"settings:providers.maxConcurrentRequests.description":
					"Each subagent on this profile takes one; the main task takes one on the same profile.",
				"settings:providers.maxConcurrentRequests.unlimited": "No limit",
				"settings:providers.maxConcurrentRequests.slotsWithMainTask": `Slots left for subagents: ${options?.slots}`,
			}
			return translations[key] || key
		},
	}),
}))

const input = () => screen.getByLabelText("Max concurrent requests")

describe("MaxConcurrentRequestsControl", () => {
	it("shows an empty field with the no-limit placeholder when the profile sets no limit", () => {
		render(<MaxConcurrentRequestsControl value={undefined} onChange={vi.fn()} />)

		expect(input()).toHaveValue("")
		expect(input()).toHaveAttribute("placeholder", "No limit")
		expect(screen.getByText(/main task takes one/)).toBeInTheDocument()
		expect(screen.queryByTestId("max-concurrent-requests-slots")).not.toBeInTheDocument()
	})

	it("shows the stored limit and the slots left beside a main task on the profile", () => {
		render(<MaxConcurrentRequestsControl value={4} onChange={vi.fn()} />)

		expect(input()).toHaveValue("4")
		expect(screen.getByTestId("max-concurrent-requests-slots")).toHaveTextContent("Slots left for subagents: 3")
	})

	it("says no slot is left when the main task alone fills the limit", () => {
		render(<MaxConcurrentRequestsControl value={1} onChange={vi.fn()} />)

		expect(screen.getByTestId("max-concurrent-requests-slots")).toHaveTextContent("Slots left for subagents: 0")
	})

	it("reports a typed whole number", () => {
		const onChange = vi.fn()
		render(<MaxConcurrentRequestsControl value={undefined} onChange={onChange} />)

		fireEvent.change(input(), { target: { value: "8" } })

		expect(onChange).toHaveBeenCalledWith(8)
	})

	it("reports no limit when the field is cleared or set to 0", () => {
		const onChange = vi.fn()
		render(<MaxConcurrentRequestsControl value={4} onChange={onChange} />)

		fireEvent.change(input(), { target: { value: "" } })
		expect(onChange).toHaveBeenLastCalledWith(undefined)

		fireEvent.change(input(), { target: { value: "0" } })
		expect(onChange).toHaveBeenLastCalledWith(undefined)
	})
})
