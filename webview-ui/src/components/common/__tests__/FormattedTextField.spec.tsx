import { render, screen, fireEvent } from "@testing-library/react"

import {
	FormattedTextField,
	type InputFormatter,
	unlimitedIntegerFormatter,
	unlimitedDecimalFormatter,
} from "../FormattedTextField"

describe("unlimitedIntegerFormatter", () => {
	it.each([
		["123", 123],
		["", undefined],
		["   ", undefined],
		["0", undefined],
		["-5", undefined],
		["abc", undefined],
	])("parses %j as %s", (input, parsed) => {
		expect(unlimitedIntegerFormatter.parse(input)).toBe(parsed)
	})

	it("formats undefined and Infinity as empty, and keeps only digits while typing", () => {
		expect([123, undefined, Infinity].map((v) => unlimitedIntegerFormatter.format(v))).toEqual(["123", "", ""])
		expect(unlimitedIntegerFormatter.filter?.("a1b2c3")).toBe("123")
	})
})

describe("unlimitedDecimalFormatter", () => {
	it.each([
		["123.45", 123.45],
		["0", 0],
		["", undefined],
		["   ", undefined],
		["-5", undefined],
		["abc", undefined],
	])("parses %j as %s", (input, parsed) => {
		expect(unlimitedDecimalFormatter.parse(input)).toBe(parsed)
	})

	it("formats undefined and Infinity as empty", () => {
		expect([123.45, 0, undefined, Infinity].map((v) => unlimitedDecimalFormatter.format(v))).toEqual([
			"123.45",
			"0",
			"",
			"",
		])
	})

	it.each([
		["a1b2.c3", "12.3"],
		["1.2.3.4", "1.234"],
		["..123", ".123"],
		["1..2", "1.2"],
	])("filters %j to %j: digits and the first dot", (input, filtered) => {
		expect(unlimitedDecimalFormatter.filter?.(input)).toBe(filtered)
	})
})

describe("FormattedTextField", () => {
	const field = <T,>(value: T | undefined, formatter: InputFormatter<T>, onValueChange = vi.fn()) => (
		<FormattedTextField value={value} onValueChange={onValueChange} formatter={formatter} data-testid="input" />
	)
	const input = () => screen.getByTestId("input") as HTMLInputElement

	it("reports the parsed value of the filtered text and shows the raw text while typing", () => {
		const onValueChange = vi.fn()
		render(field(undefined, unlimitedDecimalFormatter, onValueChange))

		fireEvent.input(input(), { target: { value: "1.x" } })

		expect(onValueChange).toHaveBeenLastCalledWith(1)
		expect(input().value).toBe("1.")
	})

	it("shows a new value from the parent unless the user is typing, and formats it on blur", () => {
		const { rerender } = render(field(1, unlimitedIntegerFormatter))

		rerender(field(2, unlimitedIntegerFormatter))
		expect(input().value).toBe("2")

		fireEvent.input(input(), { target: { value: "3" } })
		rerender(field(4, unlimitedIntegerFormatter))
		expect(input().value).toBe("3")

		fireEvent.blur(input())
		expect(input().value).toBe("4")
		rerender(field(5, unlimitedIntegerFormatter))
		expect(input().value).toBe("5")
	})

	it("passes the text through when the formatter has no filter", () => {
		const onValueChange = vi.fn()
		const plain: InputFormatter<string> = { parse: (s) => s.toUpperCase(), format: (v) => v ?? "" }
		render(field("a", plain, onValueChange))

		fireEvent.input(input(), { target: { value: "b!" } })

		expect(onValueChange).toHaveBeenLastCalledWith("B!")
	})
})
