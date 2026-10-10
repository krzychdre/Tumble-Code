import { render, screen, fireEvent } from "@testing-library/react"

import { CompactProfileControl } from "../CompactProfileControl"

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"settings:advanced.compactProfile.label": "Compact mode for small models",
				"settings:advanced.compactProfile.description":
					"For local models with a 32k to 40k context window. Leave it off for large models.",
			}
			return translations[key] || key
		},
	}),
}))

describe("CompactProfileControl", () => {
	it("is off by default and shows its label and description", () => {
		render(<CompactProfileControl onChange={vi.fn()} />)

		expect(screen.getByRole("checkbox")).not.toBeChecked()
		expect(screen.getByText("Compact mode for small models")).toBeInTheDocument()
		expect(screen.getByText(/Leave it off for large models/)).toBeInTheDocument()
	})

	it("turns the compact profile on", () => {
		const onChange = vi.fn()
		render(<CompactProfileControl onChange={onChange} />)

		fireEvent.click(screen.getByRole("checkbox"))

		expect(onChange).toHaveBeenCalledWith("compactProfile", true)
	})

	it("shows a saved true as checked and writes an explicit false when unchecked", () => {
		const onChange = vi.fn()
		render(<CompactProfileControl compactProfile={true} onChange={onChange} />)

		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).toBeChecked()

		fireEvent.click(checkbox)
		expect(onChange).toHaveBeenCalledWith("compactProfile", false)
	})

	it("shows an explicit false as unchecked", () => {
		render(<CompactProfileControl compactProfile={false} onChange={vi.fn()} />)

		expect(screen.getByRole("checkbox")).not.toBeChecked()
	})
})
