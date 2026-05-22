import { render, screen } from "@/utils/test-utils"

import { ReasoningBlock } from "../ReasoningBlock"

// Deterministic, locale-independent formatting for assertions.
vi.mock("@src/utils/format", () => ({
	formatTimestamp: (ts: number) => `T(${ts})`,
	formatDuration: (ms: number) => `D(${ms})`,
}))

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ reasoningBlockCollapsed: false }),
}))

describe("ReasoningBlock", () => {
	it("renders exactly one duration, derived from the endTs prop", () => {
		render(<ReasoningBlock content="" ts={1000} endTs={7600} />)

		// Exactly one duration is shown — the shared BlockTimestamp's. No second
		// legacy elapsed counter.
		expect(screen.getAllByText(/^D\(/)).toHaveLength(1)
		expect(screen.getByText("D(6600)")).toBeInTheDocument()
		expect(screen.getByText("T(1000)")).toBeInTheDocument()
	})

	it("shows only the start time while the duration is not yet known", () => {
		render(<ReasoningBlock content="" ts={1000} />)

		expect(screen.getByText("T(1000)")).toBeInTheDocument()
		expect(screen.queryByText(/^D\(/)).not.toBeInTheDocument()
	})

	it("renders the timestamp with the shared muted BlockTimestamp styling", () => {
		render(<ReasoningBlock content="" ts={1000} endTs={7600} />)

		expect(screen.getByText("T(1000)").closest("span")).toHaveClass(
			"text-[10px]",
			"text-vscode-descriptionForeground",
		)
	})
})
