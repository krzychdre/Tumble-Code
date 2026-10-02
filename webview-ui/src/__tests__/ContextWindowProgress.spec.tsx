// npm run test ContextWindowProgress.spec.tsx

import { render, screen, fireEvent } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import TaskHeader from "@src/components/chat/TaskHeader"

// Mock formatLargeNumber function
vi.mock("@/utils/format", () => ({
	formatLargeNumber: vi.fn((num) => num.toString()),
}))

// Mock ExtensionStateContext since we use useExtensionState
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(() => ({
		apiConfiguration: { apiProvider: "openai" },
		currentTaskItem: { id: "test-id", number: 1, size: 1024 },
	})),
	useExtensionSelector: (selector: (s: never) => unknown) =>
		selector({
			apiConfiguration: { apiProvider: "openai" },
			currentTaskItem: { id: "test-id", number: 1, size: 1024 },
		} as never),
}))

// Mock highlighting function to avoid JSX parsing issues in tests
vi.mock("@src/components/chat/TaskHeader", async () => {
	const originalModule = await vi.importActual("@src/components/chat/TaskHeader")

	return {
		...originalModule,
		highlightMentions: vi.fn((text) => text),
	}
})

// Mock useSelectedModel hook
vi.mock("@src/hooks/models/useSelectedModel", () => ({
	useSelectedModel: vi.fn(() => ({
		id: "test",
		info: { contextWindow: 4000 },
	})),
}))

// Mock getModelMaxOutputTokens so the reserved-for-output slice is a known
// 1000 tokens against the mocked 4000-token window (the real fallback of 8192
// is larger than the window and zeroes the available input space).
vi.mock("@tumble-code/core/browser", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tumble-code/core/browser")>()),
	getModelMaxOutputTokens: () => 1000,
}))

describe("ContextWindowProgress", () => {
	const queryClient = new QueryClient()

	// Helper function to render just the ContextWindowProgress part through TaskHeader
	const renderComponent = (props: Record<string, any>) => {
		// Create a simple mock of the task that avoids importing the actual types
		const defaultProps = {
			task: { ts: Date.now(), type: "say" as const, say: "text" as const, text: "Test task" },
			tokensIn: 100,
			tokensOut: 50,
			totalCost: 0.001,
			contextTokens: 1000,
			onClose: vi.fn(),
			buttonsDisabled: false,
			handleCondenseContext: vi.fn((_taskId: string) => {}),
		}

		return render(
			<QueryClientProvider client={queryClient}>
				<TaskHeader {...defaultProps} {...props} />
			</QueryClientProvider>,
		)
	}

	beforeEach(() => vi.clearAllMocks())

	it("renders correctly with valid inputs", () => {
		renderComponent({ contextTokens: 1000, contextWindow: 4000 })

		// First expand the TaskHeader to access ContextWindowProgress
		const taskHeader = screen.getByText("Test task")
		fireEvent.click(taskHeader)

		// Check for basic elements
		// The context-window-label is not part of the ContextWindowProgress component
		// but rather part of the parent TaskHeader component in expanded state
		expect(screen.getByTestId("context-tokens-count")).toBeInTheDocument()
		expect(screen.getByTestId("context-tokens-count")).toHaveTextContent("1000") // contextTokens
		// The actual context window might be different than what we pass in
		// due to the mock returning a default value from the API config
		expect(screen.getByTestId("context-window-size")).toHaveTextContent(/(4000|128000)/) // contextWindow
	})

	it("handles zero context window gracefully", () => {
		renderComponent({ contextTokens: 0, contextWindow: 0 })

		// First expand the TaskHeader to access ContextWindowProgress
		const taskHeader = screen.getByText("Test task")
		fireEvent.click(taskHeader)

		// In the current implementation, the component is still displayed with zero values
		// rather than being hidden completely
		// The context-window-label is not part of the ContextWindowProgress component
		expect(screen.getByTestId("context-tokens-count")).toBeInTheDocument()
		expect(screen.getByTestId("context-tokens-count")).toHaveTextContent("0")
	})

	it("handles edge cases with negative values", () => {
		renderComponent({ contextTokens: -100, contextWindow: 4000 })

		// First expand the TaskHeader to access ContextWindowProgress
		const taskHeader = screen.getByText("Test task")
		fireEvent.click(taskHeader)

		// Should show 0 instead of -100
		expect(screen.getByTestId("context-tokens-count")).toHaveTextContent("0")
		// The actual context window might be different than what we pass in
		expect(screen.getByTestId("context-window-size")).toHaveTextContent(/(4000|128000)/)
	})

	it("calculates percentages correctly", () => {
		renderComponent({ contextTokens: 1000, contextWindow: 4000 })

		// First expand the TaskHeader to access ContextWindowProgress
		const taskHeader = screen.getByText("Test task")
		fireEvent.click(taskHeader)

		// Verify that the token count and window size are displayed correctly
		const tokenCount = screen.getByTestId("context-tokens-count")
		const windowSize = screen.getByTestId("context-window-size")

		expect(tokenCount).toBeInTheDocument()
		expect(tokenCount).toHaveTextContent("1000")

		expect(windowSize).toBeInTheDocument()
		expect(windowSize).toHaveTextContent("4000")

		// The progress bar is now wrapped in tooltips, but we can verify the structure exists
		// by checking for the progress bar container
		const progressBarContainer = screen.getByTestId("context-tokens-count").parentElement
		expect(progressBarContainer).toBeInTheDocument()

		// Verify the flex container has the expected structure
		expect(progressBarContainer?.querySelector(".flex-1.relative")).toBeInTheDocument()
	})

	describe("§2.4 context bar", () => {
		it("renders as a 3px progressbar with square ends and aria attributes", () => {
			renderComponent({ contextTokens: 1000, contextWindow: 4000 })
			fireEvent.click(screen.getByText("Test task"))

			const bar = screen.getByTestId("context-progressbar")
			expect(bar).toHaveAttribute("role", "progressbar")
			expect(bar).toHaveAttribute("aria-label", "Context used")
			expect(bar).toHaveAttribute("aria-valuemin", "0")
			expect(bar).toHaveAttribute("aria-valuemax", "100")
			expect(Number(bar.getAttribute("aria-valuenow"))).toBeGreaterThan(0)

			// 3px tall, square ends (no rounded class).
			const track = bar.firstElementChild
			expect(track?.className).toContain("h-[3px]")
			expect(track?.className).not.toContain("rounded")
		})

		it("shows the percentage as text next to the bar", () => {
			renderComponent({ contextTokens: 1000, contextWindow: 4000 })
			fireEvent.click(screen.getByText("Test task"))

			const percent = screen.getByTestId("context-used-percent")
			expect(percent).toHaveTextContent(/%$/)

			const bar = screen.getByTestId("context-progressbar")
			expect(percent).toHaveTextContent(`${bar.getAttribute("aria-valuenow")}%`)
		})

		it("turns the used part --status-waiting above 75% and --status-failed above 90%", () => {
			// The mocked context window is 4000 with 1000 reserved for output,
			// so drive the percentage through the token count.
			const getUsedColor = (contextTokens: number) => {
				const { unmount } = renderComponent({ contextTokens, contextWindow: 4000 })
				// Collapse state: click the header toggle (the first "Test task"
				// match; the expanded body would add a second one).
				fireEvent.click(screen.getAllByText("Test task")[0])
				const used = screen.getByTestId("context-tokens-used").firstElementChild
				const style = used?.getAttribute("style")
				unmount()
				return style
			}

			// Low usage: the normal foreground colour.
			expect(getUsedColor(1000)).toContain("var(--vscode-foreground)")

			// Above 90% of the 3000 available (window 4000 - 1000 reserved): --status-failed.
			expect(getUsedColor(2800)).toContain("var(--status-failed)")

			// Above 75% but not above 90%: --status-waiting.
			expect(getUsedColor(2400)).toContain("var(--status-waiting)")
		})
	})
})
