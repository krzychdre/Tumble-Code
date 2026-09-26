import React from "react"

import { act, fireEvent, render, screen } from "@/utils/test-utils"

import { ThemedTextField } from "../themed-text-field"

const typeText = (el: HTMLInputElement, text: string) =>
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, text)
		el.dispatchEvent(new Event("input", { bubbles: true }))
	})

const input = () => document.querySelector("input.ui-text-field-control") as HTMLInputElement

describe("ThemedTextField", () => {
	it("is an input with the call site's props; className and style go on the wrapper", () => {
		render(
			<ThemedTextField
				value="hello"
				type="password"
				placeholder="Key"
				className="w-full"
				style={{ maxWidth: 200 }}
				data-testid="tf"
				aria-label="API key"
			/>,
		)

		expect(input()).toHaveValue("hello")
		expect(input()).toHaveAttribute("type", "password")
		expect(input()).toHaveAttribute("placeholder", "Key")
		expect(input()).toHaveAttribute("data-testid", "tf")
		expect(input()).toHaveAccessibleName("API key")
		expect(input().closest(".ui-text-field")).toHaveClass("w-full")
		expect(input().closest(".ui-text-field")).toHaveStyle({ maxWidth: "200px" })
	})

	it("defaults to type text and has no label without children", () => {
		render(<ThemedTextField value="" />)

		expect(input()).toHaveAttribute("type", "text")
		expect(document.querySelector("label")).toBeNull()
	})

	it("children become the label that names the input; slot children go inside the field", () => {
		render(
			<ThemedTextField value="">
				<div slot="start" data-testid="icon" />
				<label className="block font-medium mb-1">Base URL</label>
				<button slot="end">clear</button>
			</ThemedTextField>,
		)

		expect(screen.getByLabelText("Base URL")).toBe(input())
		expect(screen.getByTestId("icon").parentElement).toHaveClass("ui-text-field-start")
		expect(screen.getByText("clear").parentElement).toHaveClass("ui-text-field-end")
		expect(input().previousElementSibling).toHaveClass("ui-text-field-start")
		expect(input().nextElementSibling).toHaveClass("ui-text-field-end")
	})

	it("a plain text child is the label too", () => {
		render(<ThemedTextField value="">OAuth Credentials Path</ThemedTextField>)
		expect(screen.getByLabelText("OAuth Credentials Path")).toBe(input())
	})

	it("onInput fires on every keystroke, onChange only when the field is left after an edit", () => {
		const onInput = vi.fn((e: React.FormEvent<HTMLInputElement>) => e.currentTarget.value)
		const onChange = vi.fn((e: Event) => (e.target as HTMLInputElement).value)
		render(<ThemedTextField value="" onInput={onInput} onChange={onChange} />)

		typeText(input(), "a")
		typeText(input(), "ab")
		expect(onInput.mock.results.map((r) => r.value)).toEqual(["a", "ab"])
		expect(onChange).not.toHaveBeenCalled()

		fireEvent.change(input())
		expect(onChange.mock.results.map((r) => r.value)).toEqual(["ab"])
	})

	it("keeps the typed text across re-renders until the value prop changes", () => {
		const { rerender } = render(<ThemedTextField value="saved" onChange={() => {}} />)

		typeText(input(), "typed")
		rerender(<ThemedTextField value="saved" onChange={() => {}} className="other" />)
		expect(input()).toHaveValue("typed")

		rerender(<ThemedTextField value="from the extension" onChange={() => {}} />)
		expect(input()).toHaveValue("from the extension")
	})

	it("a call site that rewrites the typed text shows its value", () => {
		const Filtered = () => {
			const [value, setValue] = React.useState("")
			return (
				<ThemedTextField
					value={value}
					onInput={(e) => setValue((e.target as HTMLInputElement).value.replace(/[^0-9]/g, ""))}
				/>
			)
		}
		render(<Filtered />)

		typeText(input(), "1a2")

		expect(input()).toHaveValue("12")
	})

	it("forwards the ref to the input and passes key and blur handlers", () => {
		const ref = React.createRef<HTMLInputElement>()
		const onKeyDown = vi.fn()
		const onBlur = vi.fn()
		render(<ThemedTextField ref={ref} value="" onKeyDown={onKeyDown} onBlur={onBlur} />)

		expect(ref.current).toBe(input())
		fireEvent.keyDown(input(), { key: "Enter" })
		fireEvent.blur(input())
		expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: "Enter" }))
		expect(onBlur).toHaveBeenCalledTimes(1)
	})

	it("selects the whole text when focused other than by a press on it, unless selectOnFocus is off", () => {
		const { rerender } = render(<ThemedTextField value="hello" />)

		fireEvent.focus(input())
		expect([input().selectionStart, input().selectionEnd]).toEqual([0, 5])

		fireEvent.blur(input())
		input().setSelectionRange(2, 2)
		fireEvent.mouseDown(input())
		fireEvent.focus(input())
		expect([input().selectionStart, input().selectionEnd]).toEqual([2, 2])

		rerender(<ThemedTextField value="hello" selectOnFocus={false} />)
		fireEvent.mouseUp(input())
		fireEvent.blur(input())
		fireEvent.focus(input())
		expect([input().selectionStart, input().selectionEnd]).toEqual([2, 2])
	})

	it("starts with the caret after the text", () => {
		render(<ThemedTextField value="hello" />)
		expect([input().selectionStart, input().selectionEnd]).toEqual([5, 5])
	})

	it("disabled and read-only are set on the input and marked on the wrapper", () => {
		const { rerender } = render(<ThemedTextField value="" disabled />)
		expect(input()).toBeDisabled()
		expect(input().closest(".ui-text-field")).toHaveAttribute("data-disabled")

		rerender(<ThemedTextField value="" readOnly />)
		expect(input()).toHaveAttribute("readonly")
		expect(input().closest(".ui-text-field")).toHaveAttribute("data-readonly")
	})
})
