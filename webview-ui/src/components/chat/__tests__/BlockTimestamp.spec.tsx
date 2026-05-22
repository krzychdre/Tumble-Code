import { render, screen } from "@/utils/test-utils"

import { BlockTimestamp } from "../BlockTimestamp"

// Deterministic, locale-independent formatting for assertions.
vi.mock("@src/utils/format", () => ({
	formatTimestamp: (ts: number) => `T(${ts})`,
	formatDuration: (ms: number) => `D(${ms})`,
}))

describe("BlockTimestamp", () => {
	it("renders the start timestamp when only startTs is given", () => {
		render(<BlockTimestamp startTs={1000} />)

		expect(screen.getByText("T(1000)")).toBeInTheDocument()
		expect(screen.queryByText(/^D\(/)).not.toBeInTheDocument()
	})

	it("renders both start time and duration when endTs is given", () => {
		render(<BlockTimestamp startTs={1000} endTs={4500} />)

		expect(screen.getByText("T(1000)")).toBeInTheDocument()
		// Duration is endTs - startTs = 3500
		expect(screen.getByText("D(3500)")).toBeInTheDocument()
	})

	it("does not render a duration when endTs is not after startTs", () => {
		render(<BlockTimestamp startTs={4000} endTs={4000} />)

		expect(screen.getByText("T(4000)")).toBeInTheDocument()
		expect(screen.queryByText(/^D\(/)).not.toBeInTheDocument()
	})

	it("uses the muted description-foreground token for non-intrusive styling", () => {
		render(<BlockTimestamp startTs={1000} />)

		expect(screen.getByText("T(1000)").closest("span")).toHaveClass("text-vscode-descriptionForeground")
	})
})
