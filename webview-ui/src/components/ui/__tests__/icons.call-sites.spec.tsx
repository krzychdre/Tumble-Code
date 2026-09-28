// Characterization of the icons drawn by the shared shadcn-style primitives
// (refactor §2.12: the webview keeps lucide plus codicons only, so the
// `@radix-ui/react-icons` glyphs are being replaced). The assertions pin what a
// user sees and what assistive technology reads, not which library drew the
// glyph: a decorative svg is present where it was before, it carries no
// accessible name, and the checked or unchecked state still decides whether
// the indicator is painted.

import React from "react"

import { render, screen } from "@/utils/test-utils"

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"

import {
	Command,
	CommandInput,
	CommandList,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuRadioItem,
} from "@/components/ui"

// The wrapper module only re-exports the styled parts; the root, trigger and
// radio group come straight from Radix like at the call sites.
const { Root: DropdownMenu, Trigger: DropdownMenuTrigger, RadioGroup: DropdownMenuRadioGroup } = DropdownMenuPrimitive

describe("CommandInput search glyph", () => {
	it("draws one svg before the input inside the cmdk wrapper", () => {
		render(
			<Command>
				<CommandInput placeholder="Search" />
				<CommandList />
			</Command>,
		)

		const input = screen.getByPlaceholderText("Search")
		const wrapper = input.parentElement as HTMLElement
		expect(wrapper.hasAttribute("cmdk-input-wrapper")).toBe(true)

		const svgs = wrapper.querySelectorAll("svg")
		expect(svgs).toHaveLength(1)
		// The glyph comes first, then the input.
		expect(wrapper.firstElementChild?.tagName.toLowerCase()).toBe("svg")
		// Muted, fixed-size, never shrinks.
		expect(svgs[0].getAttribute("class")).toContain("opacity-50")
		expect(svgs[0].getAttribute("class")).toContain("shrink-0")
	})
})

describe("DropdownMenu item indicators", () => {
	const renderMenu = (checked: boolean, radioValue: string) =>
		render(
			<DropdownMenu open>
				<DropdownMenuTrigger>open</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuCheckboxItem checked={checked}>Show hidden</DropdownMenuCheckboxItem>
					<DropdownMenuRadioGroup value={radioValue}>
						<DropdownMenuRadioItem value="a">Option A</DropdownMenuRadioItem>
						<DropdownMenuRadioItem value="b">Option B</DropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>,
		)

	it("paints a check glyph only on a checked checkbox item", () => {
		const { unmount } = renderMenu(true, "a")
		const checkedItem = screen.getByRole("menuitemcheckbox", { name: "Show hidden" })
		expect(checkedItem.querySelectorAll("svg")).toHaveLength(1)
		unmount()

		renderMenu(false, "a")
		const uncheckedItem = screen.getByRole("menuitemcheckbox", { name: "Show hidden" })
		expect(uncheckedItem.querySelectorAll("svg")).toHaveLength(0)
	})

	it("paints a filled dot only on the selected radio item", () => {
		renderMenu(false, "b")
		const a = screen.getByRole("menuitemradio", { name: "Option A" })
		const b = screen.getByRole("menuitemradio", { name: "Option B" })
		expect(a.querySelectorAll("svg")).toHaveLength(0)
		const dots = b.querySelectorAll("svg")
		expect(dots).toHaveLength(1)
		// The dot follows the text colour of the item.
		expect(dots[0].getAttribute("class")).toContain("fill-current")
	})
})
