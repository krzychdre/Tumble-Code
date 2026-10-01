// The webview's one loading indicator. With a label it is a polite live status
// that screen readers announce; without one (next to visible text) it is
// hidden from them. ProgressIndicator (chat rows) and CodeAccordion are the
// call sites pinned here.

import { render, screen } from "@/utils/test-utils"

import { ProgressIndicator } from "@src/components/chat/ProgressIndicator"
import CodeAccordion from "@src/components/common/CodeAccordion"

import { Spinner } from "../spinner"

describe("Spinner", () => {
	it("with a label: a status named by it, with the call site's classes", () => {
		const { container } = render(<Spinner label="Loading tools" className="size-3 mr-2" />)

		const spinner = screen.getByRole("status", { name: "Loading tools" })
		expect(spinner).toHaveClass("ui-progress-ring", "size-3", "mr-2")
		expect(spinner).not.toHaveAttribute("aria-hidden")
		expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
		expect(container.querySelector(".ui-progress-ring-indicator")).not.toBeNull()
	})

	it("without a label: decorative", () => {
		const { container } = render(<Spinner />)

		expect(screen.queryByRole("status")).toBeNull()
		expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true")
	})
})

describe("Spinner call sites", () => {
	it("ProgressIndicator: a 16px decorative spinner (the row title says what runs)", () => {
		const { container } = render(<ProgressIndicator />)

		expect(container.firstElementChild).toHaveClass("ui-progress-ring", "size-4")
		expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true")
	})

	it("CodeAccordion: a small labelled spinner while loading, none otherwise", () => {
		const props = { path: "src/a.ts", code: "x", language: "ts", header: "src/a.ts", onToggleExpand: () => {} }
		const { rerender } = render(<CodeAccordion {...props} isLoading isExpanded={false} />)
		expect(screen.getByRole("status")).toHaveClass("size-3", "mr-2")

		rerender(<CodeAccordion {...props} isExpanded={false} />)
		expect(screen.queryByRole("status")).toBeNull()
	})
})
