import React from "react"

import { act, fireEvent, render, screen } from "@/utils/test-utils"

import { ThemedTextArea } from "../themed-text-area"

const typeText = (el: HTMLTextAreaElement, text: string) =>
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, text)
		el.dispatchEvent(new Event("input", { bubbles: true }))
	})

const field = () => screen.getByRole("textbox") as HTMLTextAreaElement

describe("ThemedTextArea", () => {
	it("is a textarea with the call site's attributes; className and style go on the wrapper", () => {
		render(
			<ThemedTextArea
				value="hello"
				rows={5}
				placeholder="Type here"
				resize="vertical"
				className="w-full"
				style={{ marginTop: 3 }}
				data-testid="ta"
				aria-label="Prompt"
			/>,
		)

		expect(field()).toHaveValue("hello")
		expect(field()).toHaveAttribute("rows", "5")
		expect(field()).toHaveAttribute("placeholder", "Type here")
		expect(field()).toHaveAttribute("data-resize", "vertical")
		expect(field()).toHaveAttribute("data-testid", "ta")
		expect(field()).toHaveAccessibleName("Prompt")
		expect(field()).toHaveClass("ui-text-area-control")
		expect(field().parentElement).toHaveClass("ui-text-area", "w-full")
		expect(field().parentElement).toHaveStyle({ marginTop: "3px" })
	})

	it("onInput fires on every keystroke, onChange only when the field is left after an edit", () => {
		const onInput = vi.fn((e: React.FormEvent<HTMLTextAreaElement>) => e.currentTarget.value)
		const onChange = vi.fn((e: Event) => (e.target as HTMLTextAreaElement).value)
		render(<ThemedTextArea value="" onInput={onInput} onChange={onChange} />)

		typeText(field(), "a")
		typeText(field(), "ab")
		expect(onInput.mock.results.map((r) => r.value)).toEqual(["a", "ab"])
		expect(onChange).not.toHaveBeenCalled()

		fireEvent.change(field())
		expect(onChange.mock.results.map((r) => r.value)).toEqual(["ab"])
	})

	it("keeps the typed text across re-renders until the value prop changes", () => {
		const { rerender } = render(<ThemedTextArea value="saved" onChange={() => {}} />)

		typeText(field(), "typed")
		rerender(<ThemedTextArea value="saved" onChange={() => {}} className="other" />)
		expect(field()).toHaveValue("typed")

		rerender(<ThemedTextArea value="from the extension" onChange={() => {}} />)
		expect(field()).toHaveValue("from the extension")
	})

	it("uses the latest onChange handler", () => {
		const first = vi.fn()
		const second = vi.fn()
		const { rerender } = render(<ThemedTextArea value="" onChange={first} />)
		rerender(<ThemedTextArea value="" onChange={second} />)

		typeText(field(), "x")
		fireEvent.change(field())

		expect(first).not.toHaveBeenCalled()
		expect(second).toHaveBeenCalledTimes(1)
	})

	it("disabled and read-only are set on the textarea and marked on the wrapper", () => {
		const { rerender } = render(<ThemedTextArea value="" disabled />)
		expect(field()).toBeDisabled()
		expect(field().parentElement).toHaveAttribute("data-disabled")

		rerender(<ThemedTextArea value="" readOnly />)
		expect(field()).toHaveAttribute("readonly")
		expect(field().parentElement).toHaveAttribute("data-readonly")
	})

	it("forwards the ref to the textarea", () => {
		const ref = React.createRef<HTMLTextAreaElement>()
		render(<ThemedTextArea ref={ref} value="" />)
		expect(ref.current).toBe(field())
	})
})
