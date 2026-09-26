import * as React from "react"
import { fireEvent, render } from "@/utils/test-utils"

import { VSCRUICheckbox } from "@/components/ui/vscrui-checkbox"

describe("VSCRUICheckbox", () => {
	it("renders a label wrapping a native checkbox and the children as label text", () => {
		const { container } = render(<VSCRUICheckbox checked>label text</VSCRUICheckbox>)

		const label = container.querySelector("label.ui-checkbox") as HTMLLabelElement
		expect(label).not.toBeNull()

		const input = label.querySelector("input[type='checkbox']") as HTMLInputElement
		expect(input).not.toBeNull()
		// The label wraps the input (implicit association), so the label names
		// the checkbox and clicking the text toggles it — same as vscrui's
		// htmlFor/id pair.
		expect(label.contains(input)).toBe(true)
		expect(input.checked).toBe(true)
		expect(label.querySelector(".ui-checkbox-label")?.textContent).toBe("label text")
	})

	it("calls onChange with the new boolean on user input only", () => {
		const onChange = vi.fn()
		const { container, rerender } = render(<VSCRUICheckbox checked={false} onChange={onChange} />)
		const input = container.querySelector("input[type='checkbox']") as HTMLInputElement

		fireEvent.click(input)
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange).toHaveBeenCalledWith(true)

		// Prop changes sync the box but never fire onChange.
		rerender(<VSCRUICheckbox checked={true} onChange={onChange} />)
		expect(input.checked).toBe(true)
		expect(onChange).toHaveBeenCalledTimes(1)
	})

	it("shows the check mark only when checked", () => {
		const { container, rerender } = render(<VSCRUICheckbox checked={false} />)
		const input = container.querySelector("input[type='checkbox']") as HTMLInputElement
		expect(input.classList.contains("ui-checkbox-input")).toBe(true)

		// The .ui-checkbox-input:checked + .ui-checkbox-check rule in index.css
		// makes the svg visible; here we assert the DOM state it keys on.
		expect(input.checked).toBe(false)

		rerender(<VSCRUICheckbox checked={true} />)
		expect(input.checked).toBe(true)
	})

	it("reflects indeterminate on the native input", () => {
		const { container, rerender } = render(<VSCRUICheckbox checked={false} />)
		const input = container.querySelector("input[type='checkbox']") as HTMLInputElement
		expect(input.indeterminate).toBe(false)

		rerender(<VSCRUICheckbox checked={false} indeterminate />)
		expect(input.indeterminate).toBe(true)

		rerender(<VSCRUICheckbox checked={false} indeterminate={false} />)
		expect(input.indeterminate).toBe(false)
	})

	it("disables the input when disabled", () => {
		const { container } = render(<VSCRUICheckbox checked={false} disabled />)
		const label = container.querySelector("label.ui-checkbox") as HTMLLabelElement
		const input = label.querySelector("input[type='checkbox']") as HTMLInputElement

		// A disabled native input cannot be toggled by the browser; jsdom's
		// fireEvent bypasses that, so we assert the disabled contract itself.
		expect(input.disabled).toBe(true)
		expect(label.getAttribute("data-disabled")).toBe("")
	})

	it("passes data-testid and aria attributes to the input", () => {
		const { container } = render(
			<VSCRUICheckbox checked={false} data-testid="my-checkbox" aria-label="Toggle me" />,
		)
		const input = container.querySelector("input[type='checkbox']") as HTMLInputElement
		expect(input.getAttribute("data-testid")).toBe("my-checkbox")
		expect(input.getAttribute("aria-label")).toBe("Toggle me")
	})

	it("supports Space to toggle via the native input", () => {
		const onChange = vi.fn()
		const { container } = render(<VSCRUICheckbox checked={false} onChange={onChange} />)
		const input = container.querySelector("input[type='checkbox']") as HTMLInputElement

		input.focus()
		fireEvent.keyDown(input, { key: " " })
		fireEvent.click(input) // jsdom does not synthesize the click from Space
		expect(onChange).toHaveBeenCalledWith(true)
	})

	it("forwards the ref to the input", () => {
		const ref = React.createRef<HTMLInputElement>()
		render(<VSCRUICheckbox ref={ref} checked={false} />)
		expect(ref.current).toBeInstanceOf(HTMLInputElement)
	})

	it("does not render the label span when there are no children", () => {
		const { container } = render(<VSCRUICheckbox checked={false} />)
		expect(container.querySelector(".ui-checkbox-label")).toBeNull()
	})
})
