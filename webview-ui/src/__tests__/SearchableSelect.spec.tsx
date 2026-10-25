import React from "react"
import { render, screen, cleanup, waitFor, within, fireEvent } from "@/utils/test-utils"
import { SearchableSelect, SearchableSelectOption } from "@/components/ui/searchable-select"
import userEvent from "@testing-library/user-event"

describe("SearchableSelect", () => {
	const mockOptions: SearchableSelectOption[] = [
		{ value: "option1", label: "Option 1" },
		{ value: "option2", label: "Option 2" },
		{ value: "option3", label: "Option 3", disabled: true },
	]

	const defaultProps = {
		options: mockOptions,
		placeholder: "Select an option",
		searchPlaceholder: "Search options...",
		emptyMessage: "No options found",
		onValueChange: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		cleanup()
		vi.useRealTimers()
	})

	it("renders with placeholder when no value is selected", () => {
		render(<SearchableSelect {...defaultProps} />)
		expect(screen.getByText("Select an option")).toBeInTheDocument()
	})

	it("renders with selected option label when value is provided", () => {
		render(<SearchableSelect {...defaultProps} value="option1" />)
		expect(screen.getByText("Option 1")).toBeInTheDocument()
	})

	it("filters options based on search input", async () => {
		const user = userEvent.setup()
		render(<SearchableSelect {...defaultProps} />)

		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		// Verify all options are initially visible
		await waitFor(() => {
			expect(screen.getByText("Option 1")).toBeInTheDocument()
			expect(screen.getByText("Option 2")).toBeInTheDocument()
			expect(screen.getByText("Option 3")).toBeInTheDocument()
		})

		const searchInput = screen.getByPlaceholderText("Search options...")

		// Use fireEvent for cmdk input
		fireEvent.change(searchInput, { target: { value: "1" } })

		// Wait for the filtering to take effect
		await waitFor(() => {
			expect(screen.getByText("Option 1")).toBeInTheDocument()
			expect(screen.queryByText("Option 2")).not.toBeInTheDocument()
			expect(screen.queryByText("Option 3")).not.toBeInTheDocument()
		})
	})

	it("filters options by value when the label does not contain the provider ID", async () => {
		const user = userEvent.setup()
		const options = [
			{ value: "openai-native", label: "OpenAI" },
			{ value: "anthropic", label: "Anthropic" },
		]
		render(<SearchableSelect {...defaultProps} options={options} />)

		await user.click(screen.getByRole("combobox"))
		fireEvent.change(screen.getByPlaceholderText("Search options..."), {
			target: { value: "native" },
		})

		await waitFor(() => expect(screen.queryByText("Anthropic")).not.toBeInTheDocument())
		expect(screen.getByText("OpenAI")).toBeInTheDocument()
	})

	it("calls onValueChange when an option is selected", async () => {
		const user = userEvent.setup()
		render(<SearchableSelect {...defaultProps} />)

		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		const option = screen.getByText("Option 2")
		await user.click(option)

		expect(defaultProps.onValueChange).toHaveBeenCalledWith("option2")
	})

	it("does not call onValueChange when a disabled option is clicked", async () => {
		const user = userEvent.setup()
		render(<SearchableSelect {...defaultProps} />)

		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		const disabledOption = screen.getByText("Option 3")
		await user.click(disabledOption)

		expect(defaultProps.onValueChange).not.toHaveBeenCalled()
	})

	it("clears search value when dropdown is closed", async () => {
		const user = userEvent.setup()
		render(<SearchableSelect {...defaultProps} />)

		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		const searchInput = screen.getByPlaceholderText("Search options...")

		// Use fireEvent for cmdk input
		fireEvent.change(searchInput, { target: { value: "test" } })

		// Verify the search filters the options
		await waitFor(() => {
			expect(screen.queryByText("Option 1")).not.toBeInTheDocument()
			expect(screen.queryByText("Option 2")).not.toBeInTheDocument()
		})

		// Close the dropdown by clicking outside
		await user.click(document.body)

		// Wait for dropdown to close
		await waitFor(() => {
			expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
		})

		// Wait a bit for the timeout to clear search
		await new Promise((resolve) => setTimeout(resolve, 200))

		// Open again to check if search was cleared
		await user.click(trigger)

		// All options should be visible again
		await waitFor(() => {
			expect(screen.getByText("Option 1")).toBeInTheDocument()
			expect(screen.getByText("Option 2")).toBeInTheDocument()
			expect(screen.getByText("Option 3")).toBeInTheDocument()
		})
	})

	it("resets search value when value prop changes", async () => {
		const user = userEvent.setup()
		const { rerender } = render(<SearchableSelect {...defaultProps} value="option1" />)

		// Open dropdown and type something
		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		const searchInput = screen.getByPlaceholderText("Search options...")
		fireEvent.change(searchInput, { target: { value: "2" } })

		// Verify search is working - use within to scope to dropdown
		const dropdown = screen.getByRole("dialog")
		await waitFor(() => {
			expect(within(dropdown).queryByText("Option 1")).not.toBeInTheDocument()
			expect(within(dropdown).getByText("Option 2")).toBeInTheDocument()
		})

		// Close dropdown
		await user.click(document.body)

		// Change the value prop
		rerender(<SearchableSelect {...defaultProps} value="option2" />)

		// Wait for the component to update
		await waitFor(() => {
			expect(screen.getByRole("combobox")).toHaveTextContent("Option 2")
		})

		// Wait for the effect to run (100ms timeout in component)
		await new Promise((resolve) => setTimeout(resolve, 150))

		// Open dropdown again
		await user.click(trigger)

		// All options should be visible (search cleared) - use within to scope
		const newDropdown = screen.getByRole("dialog")
		await waitFor(() => {
			expect(within(newDropdown).getByText("Option 1")).toBeInTheDocument()
			expect(within(newDropdown).getByText("Option 2")).toBeInTheDocument()
			expect(within(newDropdown).getByText("Option 3")).toBeInTheDocument()
		})
	})

	it("closes the dropdown when ESC key is pressed", async () => {
		const user = userEvent.setup()
		render(<SearchableSelect {...defaultProps} />)

		// Open the dropdown
		const trigger = screen.getByRole("combobox")
		await user.click(trigger)

		// Verify dropdown is open
		expect(trigger).toHaveAttribute("aria-expanded", "true")
		expect(screen.getByRole("listbox")).toBeInTheDocument()

		// Press ESC key
		fireEvent.keyDown(window, { key: "Escape" })

		// Verify dropdown is closed
		await waitFor(() => {
			expect(trigger).toHaveAttribute("aria-expanded", "false")
			expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
		})
	})

	// Only maxDisplayItems options render; a selected option cut off by the limit is kept in front.
	it.each([
		{ value: undefined, shown: ["Item 0", "Item 1", "Item 2"] },
		{ value: "item-7", shown: ["Item 7", "Item 0", "Item 1"] },
		{ value: "item-1", shown: ["Item 0", "Item 1", "Item 2"] },
	])("limits the list to maxDisplayItems, selected $value", async ({ value, shown }) => {
		const options = Array.from({ length: 10 }, (_, i) => ({ value: `item-${i}`, label: `Item ${i}` }))
		render(<SearchableSelect {...defaultProps} options={options} value={value} maxDisplayItems={3} />)

		await userEvent.setup().click(screen.getByRole("combobox"))

		expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(shown)
	})
})
