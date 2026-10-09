// Characterization of the icons drawn by the shared shadcn-style primitives
// (refactor §2.12: the webview keeps lucide plus codicons only, so the
// `@radix-ui/react-icons` glyphs are being replaced). The assertions pin what a
// user sees and what assistive technology reads, not which library drew the
// glyph: a decorative svg is present where it was before and it carries no
// accessible name.

import React from "react"

import { render, screen } from "@/utils/test-utils"

import { Command, CommandInput, CommandList } from "@/components/ui"

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
		// Muted (description colour), fixed-size, never shrinks.
		expect(svgs[0].getAttribute("class")).toContain("text-vscode-descriptionForeground")
		expect(svgs[0].getAttribute("class")).toContain("shrink-0")
	})
})
