import React from "react"
import { render, screen } from "@/utils/test-utils"

import RooTips from "../RooTips"

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key, // Simple mock that returns the key
	}),
	Trans: ({
		children,
		components,
	}: {
		children?: React.ReactNode
		components?: Record<string, React.ReactElement>
	}) => {
		// Simple mock that renders children or the first component if no children
		return children || (components && Object.values(components)[0]) || null
	},
}))

describe("RooTips Component", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.runOnlyPendingTimers()
		vi.useRealTimers()
	})

	describe("when cycle is false (default)", () => {
		beforeEach(() => {
			render(<RooTips />)
		})

		test("renders the two tips as plain text, with no links", () => {
			expect(screen.getByText("rooTips.customizableModes.title")).toBeInTheDocument()
			expect(screen.getByText("rooTips.modelAgnostic.title")).toBeInTheDocument()
			expect(screen.queryAllByRole("link")).toHaveLength(0)
		})
	})
})
