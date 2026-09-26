import React from "react"

import userEvent from "@testing-library/user-event"

import { fireEvent, render, screen } from "@/utils/test-utils"

import { LabeledCheckbox } from "../labeled-checkbox"

describe("LabeledCheckbox", () => {
	it("is a checkbox named by its label, in the tab order", () => {
		render(
			<LabeledCheckbox checked={false} onChange={() => {}}>
				<span className="font-medium">Enable sounds</span>
			</LabeledCheckbox>,
		)

		const checkbox = screen.getByRole("checkbox", { name: "Enable sounds" }) as HTMLInputElement
		expect(checkbox.checked).toBe(false)
		expect(checkbox.tabIndex).toBe(0)
	})

	it("reports the new state through e.target.checked on click and on a label click", () => {
		const seen: boolean[] = []
		const { rerender } = render(
			<LabeledCheckbox checked={false} onChange={(e) => seen.push(e.target.checked)}>
				Label
			</LabeledCheckbox>,
		)

		fireEvent.click(screen.getByRole("checkbox"))
		rerender(
			<LabeledCheckbox checked={true} onChange={(e) => seen.push(e.target.checked)}>
				Label
			</LabeledCheckbox>,
		)
		fireEvent.click(screen.getByText("Label"))

		expect(seen).toEqual([true, false])
	})

	it("does not call onChange when only the checked prop changes", () => {
		const onChange = vi.fn()
		const { rerender } = render(<LabeledCheckbox checked={false} onChange={onChange} />)

		rerender(<LabeledCheckbox checked={true} onChange={onChange} />)

		expect(onChange).not.toHaveBeenCalled()
		expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true)
	})

	it("keeps showing the checked prop when the call site ignores a click", () => {
		render(<LabeledCheckbox checked={false} onChange={() => {}} />)

		const checkbox = screen.getByRole("checkbox") as HTMLInputElement
		fireEvent.click(checkbox)

		expect(checkbox.checked).toBe(false)
	})

	it("disabled: no onChange, marked on the wrapper for the dimmed look", async () => {
		const onChange = vi.fn()
		render(
			<LabeledCheckbox checked={false} disabled onChange={onChange}>
				Off
			</LabeledCheckbox>,
		)

		const checkbox = screen.getByRole("checkbox", { name: "Off" })
		// user-event, like a browser, does not activate a disabled control
		// (jsdom's fireEvent would toggle even a disabled native checkbox).
		await userEvent.click(checkbox)
		await userEvent.click(screen.getByText("Off"))

		expect(checkbox).toBeDisabled()
		expect(onChange).not.toHaveBeenCalled()
		expect(checkbox.closest("label")).toHaveAttribute("data-disabled")
	})

	it("puts data-testid and aria props on the input, className and style on the wrapper", () => {
		render(
			<LabeledCheckbox
				checked
				onChange={() => {}}
				data-testid="cb"
				aria-label="Explicit name"
				className="text-xs"
				style={{ marginLeft: 4 }}>
				Visible text
			</LabeledCheckbox>,
		)

		const checkbox = screen.getByTestId("cb")
		expect(checkbox.tagName).toBe("INPUT")
		expect(screen.getByRole("checkbox", { name: "Explicit name" })).toBe(checkbox)
		const wrapper = checkbox.closest("label")!
		expect(wrapper).toHaveClass("ui-checkbox", "text-xs")
		expect(wrapper.style.marginLeft).toBe("4px")
	})

	it("renders no label part without children, and forwards the ref to the input", () => {
		const ref = React.createRef<HTMLInputElement>()
		const { container } = render(<LabeledCheckbox ref={ref} checked={false} onChange={() => {}} />)

		expect(container.querySelector(".ui-checkbox-label")).toBeNull()
		expect(ref.current).toBe(screen.getByRole("checkbox"))
	})
})
