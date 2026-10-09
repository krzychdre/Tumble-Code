import { useState, type ChangeEvent } from "react"

import { fireEvent, render, screen } from "@/utils/test-utils"

import { Input } from "../input"
import { Textarea } from "../textarea"
import { useTextDraft } from "../hooks/useTextDraft"

describe("Input", () => {
	it("puts className, data-testid and the other props on the <input> and reports every keystroke", () => {
		const onChange = vi.fn((event: ChangeEvent<HTMLInputElement>) => event.target.value)
		render(<Input data-testid="name" className="grow" placeholder="Name" value="" onChange={onChange} />)

		const input = screen.getByTestId("name")
		expect(input.tagName).toBe("INPUT")
		expect(input).toHaveClass("ui-input", "grow", "h-[26px]", "border-input-frame")
		expect(input).toHaveAttribute("placeholder", "Name")

		fireEvent.change(input, { target: { value: "a" } })
		expect(onChange).toHaveBeenCalledTimes(1)
		expect(onChange.mock.results[0].value).toBe("a")
	})

	it("with start/end: the border and className move to a wrapper, the props stay on the <input>", () => {
		render(
			<Input
				data-testid="search"
				className="w-full"
				start={<span data-testid="icon" />}
				end={<button aria-label="clear" />}
			/>,
		)

		const input = screen.getByTestId("search")
		const wrapper = input.parentElement!
		expect(wrapper).toHaveClass("w-full", "border-input-frame", "focus-within:border-vscode-focusBorder")
		expect(input).not.toHaveClass("w-full")
		expect(input).toHaveClass("ui-input", "border-0", "bg-transparent")
		expect(wrapper.firstElementChild).toContainElement(screen.getByTestId("icon"))
		expect(wrapper.lastElementChild).toContainElement(screen.getByRole("button", { name: "clear" }))
	})

	it("an end slot that appears while typing keeps the same <input> (and its focus)", () => {
		const Search = () => {
			const [value, setValue] = useState("")
			return (
				<Input
					data-testid="search"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					end={value ? <button aria-label="clear" onClick={() => setValue("")} /> : null}
				/>
			)
		}
		render(<Search />)

		const input = screen.getByTestId("search")
		input.focus()
		fireEvent.change(input, { target: { value: "x" } })

		expect(screen.getByTestId("search")).toBe(input)
		expect(document.activeElement).toBe(input)
		expect(screen.getByRole("button", { name: "clear" })).toBeInTheDocument()
	})
})

describe("Textarea", () => {
	it("has the field look, no resize handle by default, and takes rows and className", () => {
		render(<Textarea data-testid="notes" rows={4} className="resize-y" />)

		const textarea = screen.getByTestId("notes")
		expect(textarea).toHaveClass("ui-textarea", "p-[9px]", "border-input-frame", "resize-y")
		expect(textarea).not.toHaveClass("resize-none")
		expect(textarea).toHaveAttribute("rows", "4")
	})
})

describe("useTextDraft", () => {
	const Field = ({ value, onCommit }: { value: string; onCommit?: (text: string) => void }) => {
		const draft = useTextDraft(value, onCommit)
		return <Input data-testid="field" {...draft} />
	}

	it("shows the typed text, commits it on blur only when it changed, and follows a new value", () => {
		const onCommit = vi.fn()
		const { rerender } = render(<Field value="old" onCommit={onCommit} />)
		const input = screen.getByTestId("field") as HTMLInputElement

		fireEvent.blur(input)
		expect(onCommit).not.toHaveBeenCalled()

		fireEvent.change(input, { target: { value: "typed" } })
		expect(input.value).toBe("typed")
		expect(onCommit).not.toHaveBeenCalled()

		// A re-render with the same value keeps the typed text.
		rerender(<Field value="old" onCommit={onCommit} />)
		expect(input.value).toBe("typed")

		fireEvent.blur(input)
		expect(onCommit).toHaveBeenCalledWith("typed")

		rerender(<Field value="new" onCommit={onCommit} />)
		expect(input.value).toBe("new")
	})

	it("Enter in a single-line field commits once, like the native change event", () => {
		const onCommit = vi.fn()
		render(<Field value="old" onCommit={onCommit} />)
		const input = screen.getByTestId("field") as HTMLInputElement

		fireEvent.change(input, { target: { value: "typed" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(onCommit).toHaveBeenCalledWith("typed")

		// Leaving after Enter does not commit the same edit again.
		fireEvent.blur(input)
		expect(onCommit).toHaveBeenCalledTimes(1)

		// A new edit commits again.
		fireEvent.change(input, { target: { value: "typed again" } })
		fireEvent.blur(input)
		expect(onCommit).toHaveBeenLastCalledWith("typed again")
		expect(onCommit).toHaveBeenCalledTimes(2)
	})
})
