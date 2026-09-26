import React from "react"

import { fireEvent, render, screen } from "@/utils/test-utils"

import { ThemedDropdown, ThemedOption, type ThemedDropdownChangeEvent } from "../themed-dropdown"

type Props = {
	value?: string
	onChange?: (e: ThemedDropdownChangeEvent) => void
	disabled?: boolean
	options?: Array<[string, string, boolean?]>
	className?: string
}

const DEFAULT_OPTIONS: Array<[string, string, boolean?]> = [
	["a", "Alpha"],
	["b", "Beta"],
	["c", "Gamma"],
]

const Dropdown = ({ value, onChange, disabled, options = DEFAULT_OPTIONS, className }: Props) => (
	<ThemedDropdown value={value} onChange={onChange} disabled={disabled} className={className} data-testid="dd">
		{options.map(([v, label, optionDisabled]) => (
			<ThemedOption key={v} value={v} className="p-2" disabled={optionDisabled}>
				{label}
			</ThemedOption>
		))}
	</ThemedDropdown>
)

const combobox = () => screen.getByRole("combobox")
const shown = () => document.querySelector(".ui-dropdown-selected-value")?.textContent
const option = (name: string) => screen.getByRole("option", { name, hidden: true })
const values = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.map(([e]) => e.target.value)

describe("ThemedDropdown / ThemedOption", () => {
	it("is a combobox that shows the option whose value is `value` and marks it selected", () => {
		render(<Dropdown value="b" className="w-full" />)

		expect(combobox()).toHaveAttribute("aria-haspopup", "listbox")
		expect(combobox()).toHaveAttribute("aria-expanded", "false")
		expect(combobox()).toHaveAttribute("tabindex", "0")
		expect(combobox()).toHaveClass("ui-dropdown", "w-full")
		expect(combobox()).toHaveAttribute("data-testid", "dd")
		expect(shown()).toBe("Beta")
		expect(option("Beta")).toHaveAttribute("aria-selected", "true")
		expect(option("Alpha")).toHaveAttribute("aria-selected", "false")
		expect(option("Beta")).toHaveClass("ui-dropdown-option", "p-2")
		expect(combobox()).toHaveAttribute("aria-activedescendant", option("Beta").id)
		expect(screen.getByRole("listbox", { hidden: true })).not.toBeVisible()
	})

	it("shows the first option when no option has the value", () => {
		render(<Dropdown value="zzz" />)
		expect(shown()).toBe("Alpha")

		render(
			<Dropdown
				value={undefined}
				options={[
					["", "Select a model"],
					["m", "Model"],
				]}
			/>,
		)
		expect(document.querySelectorAll(".ui-dropdown-selected-value")[1].textContent).toBe("Select a model")
	})

	it("opens on click and reports the clicked option once, closing the list", () => {
		const onChange = vi.fn()
		render(<Dropdown value="a" onChange={onChange} />)

		fireEvent.click(combobox())
		expect(combobox()).toHaveAttribute("aria-expanded", "true")
		expect(combobox()).toHaveAttribute("aria-controls", screen.getByRole("listbox").id)
		expect(screen.getByRole("listbox")).toBeVisible()

		fireEvent.click(option("Gamma"))

		expect(values(onChange)).toEqual(["c"])
		expect(combobox()).toHaveAttribute("aria-expanded", "false")
	})

	it("reports nothing when the list closes on the option it opened on or on a disabled option", () => {
		const onChange = vi.fn()
		render(
			<Dropdown
				value="a"
				onChange={onChange}
				options={[
					["a", "Alpha"],
					["b", "Beta", true],
				]}
			/>,
		)

		fireEvent.click(combobox())
		fireEvent.click(option("Beta"))
		expect(combobox()).toHaveAttribute("aria-expanded", "true")

		fireEvent.click(option("Alpha"))
		fireEvent.click(combobox())
		fireEvent.click(combobox())

		expect(onChange).not.toHaveBeenCalled()
	})

	it("does not call onChange when only the value prop changes", () => {
		const onChange = vi.fn()
		const { rerender } = render(<Dropdown value="a" onChange={onChange} />)

		rerender(<Dropdown value="c" onChange={onChange} />)

		expect(onChange).not.toHaveBeenCalled()
		expect(shown()).toBe("Gamma")
	})

	it("keeps showing the value prop when the call site ignores a choice", () => {
		render(<Dropdown value="a" onChange={() => {}} />)

		fireEvent.click(combobox())
		fireEvent.click(option("Gamma"))

		expect(shown()).toBe("Alpha")
	})

	it("keeps showing the option with the value when the option list changes", () => {
		const { rerender } = render(<Dropdown value="b" />)

		rerender(
			<Dropdown
				value="b"
				options={[
					["", "(none)"],
					["c", "Gamma"],
					["b", "Beta"],
				]}
			/>,
		)

		expect(shown()).toBe("Beta")
	})

	it("on the closed dropdown, arrows, Home, End and typing report the new option at once", () => {
		const onChange = vi.fn()
		const { rerender } = render(<Dropdown value="b" onChange={onChange} />)

		fireEvent.keyDown(combobox(), { key: "ArrowDown" })
		fireEvent.keyDown(combobox(), { key: "ArrowUp" })
		fireEvent.keyDown(combobox(), { key: "End" })
		fireEvent.keyDown(combobox(), { key: "Home" })
		fireEvent.keyDown(combobox(), { key: "g" })
		expect(values(onChange)).toEqual(["c", "a", "c", "a", "c"])
		expect(combobox()).toHaveAttribute("aria-expanded", "false")

		onChange.mockClear()
		rerender(<Dropdown value="c" onChange={onChange} />)
		fireEvent.keyDown(combobox(), { key: "ArrowDown" })
		expect(onChange).not.toHaveBeenCalled()
	})

	it("in the open list, arrows only preview and Enter reports the previewed option once", () => {
		const onChange = vi.fn()
		render(<Dropdown value="a" onChange={onChange} />)

		fireEvent.keyDown(combobox(), { key: "Enter" })
		expect(combobox()).toHaveAttribute("aria-expanded", "true")
		fireEvent.keyDown(combobox(), { key: "ArrowDown" })
		fireEvent.keyDown(combobox(), { key: "ArrowDown" })
		expect(onChange).not.toHaveBeenCalled()
		expect(shown()).toBe("Gamma")
		expect(combobox()).toHaveAttribute("aria-activedescendant", option("Gamma").id)

		fireEvent.keyDown(combobox(), { key: "Enter" })

		expect(values(onChange)).toEqual(["c"])
		expect(combobox()).toHaveAttribute("aria-expanded", "false")
	})

	it("Space opens and closes the list; Escape and Tab close it and report the preview like the toolkit", () => {
		const onChange = vi.fn()
		render(<Dropdown value="a" onChange={onChange} />)

		fireEvent.keyDown(combobox(), { key: " " })
		expect(combobox()).toHaveAttribute("aria-expanded", "true")
		fireEvent.keyDown(combobox(), { key: " " })
		expect(combobox()).toHaveAttribute("aria-expanded", "false")

		fireEvent.keyDown(combobox(), { key: " " })
		fireEvent.keyDown(combobox(), { key: "ArrowDown" })
		fireEvent.keyDown(combobox(), { key: "Escape" })
		expect(values(onChange)).toEqual(["b"])

		fireEvent.keyDown(combobox(), { key: "Enter" })
		fireEvent.keyDown(combobox(), { key: "End" })
		const tab = fireEvent.keyDown(combobox(), { key: "Tab" })
		expect(tab).toBe(false) // default prevented: Tab only closes the open list
		expect(values(onChange)).toEqual(["b", "c"])
		expect(combobox()).toHaveAttribute("aria-expanded", "false")

		expect(fireEvent.keyDown(combobox(), { key: "Tab" })).toBe(true)
	})

	it("arrows skip disabled options", () => {
		const onChange = vi.fn()
		render(
			<Dropdown
				value="a"
				onChange={onChange}
				options={[
					["a", "Alpha"],
					["b", "Beta", true],
					["c", "Gamma"],
				]}
			/>,
		)

		fireEvent.keyDown(combobox(), { key: "ArrowDown" })

		expect(values(onChange)).toEqual(["c"])
	})

	it("closes and reports the preview when the focus leaves", () => {
		const onChange = vi.fn()
		render(
			<>
				<Dropdown value="a" onChange={onChange} />
				<button>outside</button>
			</>,
		)

		fireEvent.keyDown(combobox(), { key: "Enter" })
		fireEvent.keyDown(combobox(), { key: "ArrowDown" })
		fireEvent.blur(combobox(), { relatedTarget: screen.getByText("outside") })

		expect(combobox()).toHaveAttribute("aria-expanded", "false")
		expect(values(onChange)).toEqual(["b"])
	})

	it("opens below, or above when there is more room above", () => {
		render(<Dropdown value="a" />)
		const rect = (top: number) => ({
			top,
			bottom: top + 26,
			left: 0,
			right: 100,
			width: 100,
			height: 26,
			x: 0,
			y: top,
		})
		const spy = vi.spyOn(combobox(), "getBoundingClientRect")

		spy.mockReturnValue(rect(10) as DOMRect)
		fireEvent.click(combobox())
		expect(combobox()).toHaveAttribute("data-position", "below")
		fireEvent.click(combobox())

		spy.mockReturnValue(rect(window.innerHeight - 30) as DOMRect)
		fireEvent.click(combobox())
		expect(combobox()).toHaveAttribute("data-position", "above")
	})

	it("a disabled dropdown is not focusable and ignores clicks and keys", () => {
		const onChange = vi.fn()
		render(<Dropdown value="a" onChange={onChange} disabled />)

		expect(combobox()).not.toHaveAttribute("tabindex")
		expect(combobox()).toHaveAttribute("aria-disabled", "true")
		fireEvent.click(combobox())
		fireEvent.keyDown(combobox(), { key: "ArrowDown" })

		expect(combobox()).toHaveAttribute("aria-expanded", "false")
		expect(onChange).not.toHaveBeenCalled()
	})

	it("forwards the ref to the combobox", () => {
		const ref = React.createRef<HTMLDivElement>()
		render(
			<ThemedDropdown ref={ref} value="x">
				<ThemedOption value="x">X</ThemedOption>
			</ThemedDropdown>,
		)
		expect(ref.current).toBe(combobox())
	})
})
