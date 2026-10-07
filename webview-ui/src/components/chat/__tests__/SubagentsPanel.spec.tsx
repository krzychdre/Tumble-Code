// pnpm --filter @tumble-code/vscode-webview test src/components/chat/__tests__/SubagentsPanel.spec.tsx

import { act, fireEvent, render, screen } from "@/utils/test-utils"

import type { SubagentSummary } from "@tumble-code/types"

import { TooltipProvider } from "@/components/ui/tooltip"

import { vscode } from "@src/utils/vscode"

import SubagentsPanel from "../SubagentsPanel"

vi.mock("../../common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
	}),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

const summary = (overrides: Partial<SubagentSummary>): SubagentSummary => ({
	taskId: "child-1",
	parentTaskId: "parent",
	index: 0,
	mode: "code",
	description: "first subtask",
	status: "completed",
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	startedAt: 1,
	lastActivityAt: 1,
	...overrides,
})

const renderPanel = (subagents: SubagentSummary[], taskId: string | undefined) =>
	render(
		<TooltipProvider>
			<SubagentsPanel subagents={subagents} taskId={taskId} />
		</TooltipProvider>,
	)

const expandPanel = () => fireEvent.click(screen.getByText(/chat:subagents.header/))

describe("SubagentsPanel task scope", () => {
	it("lists the fan-out of the open task", () => {
		renderPanel([summary({})], "parent")
		expandPanel()

		expect(screen.getByText("first subtask")).toBeInTheDocument()
	})

	it("starts collapsed so a wide fan-out does not cover the chat", () => {
		renderPanel([summary({})], "parent")

		expect(screen.getByText(/chat:subagents.headerDone/)).toBeInTheDocument()
		expect(screen.queryByText("first subtask")).not.toBeInTheDocument()
	})

	// Regression: overflow-hidden rows in the height-capped flex column were
	// squashed into slivers (20 parallel subagents) instead of the list scrolling.
	it("scrolls the list instead of squashing the rows", () => {
		renderPanel(
			Array.from({ length: 20 }, (_, index) =>
				summary({ taskId: `child-${index}`, index, description: `subtask ${index}`, status: "running" }),
			),
			"parent",
		)
		expandPanel()

		const list = screen.getByTestId("subagents-list")
		expect(list).toHaveClass("max-h-[50vh]", "overflow-y-auto")
		expect(list.children).toHaveLength(20)
		for (const row of Array.from(list.children)) {
			expect(row).toHaveClass("shrink-0")
		}
	})

	// Regression: a parent that delegated to a new_task subtask keeps its rows in
	// the host registry, and the subtask's state push carries them. The subtask's
	// chat must not show them.
	it("renders nothing in a task that did not fan out", () => {
		const { container } = renderPanel([summary({})], "subtask-of-parent")

		expect(container).toBeEmptyDOMElement()
	})

	it("keeps only the open task's rows when the registry holds several parents", () => {
		renderPanel(
			[
				summary({}),
				summary({ taskId: "other-child", parentTaskId: "other-parent", description: "foreign subtask" }),
			],
			"parent",
		)
		expandPanel()

		expect(screen.getByText("first subtask")).toBeInTheDocument()
		expect(screen.queryByText("foreign subtask")).not.toBeInTheDocument()
		expect(screen.getByText(/chat:subagents.headerDone/)).toHaveTextContent('{"total":1}')
	})

	it("renders nothing without an open task", () => {
		const { container } = renderPanel([summary({})], undefined)

		expect(container).toBeEmptyDOMElement()
	})
})

describe("SubagentsPanel tail of a finished subagent", () => {
	const expandRow = () => {
		expandPanel()
		fireEvent.click(screen.getByRole("button", { expanded: false, name: /first subtask/ }))
	}

	// Regression: the final-message fallback rendered outside any height cap, so
	// a long result ran past the panel with no scrollbar.
	it("shows the final message inside the capped scrolling box", () => {
		renderPanel([summary({ finalMessage: "R3-4a completed and merged." })], "parent")
		expandRow()

		const tail = screen.getByTestId("subagent-tail")
		expect(tail).toHaveClass("max-h-64", "overflow-y-auto")
		expect(tail).toHaveTextContent("R3-4a completed and merged.")
	})

	it("asks for the transcript and shows it instead of the final message", () => {
		renderPanel([summary({ finalMessage: "summary only" })], "parent")
		expandRow()

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "subscribeSubagentMessages", taskId: "child-1" })
		act(() => {
			window.dispatchEvent(
				new MessageEvent("message", {
					data: {
						type: "subagentMessages",
						sourceTaskId: "child-1",
						subagentMessages: [{ ts: 1, type: "say", say: "text", text: "read the backoff module" }],
					},
				}),
			)
		})

		const tail = screen.getByTestId("subagent-tail")
		expect(tail).toHaveTextContent("read the backoff module")
		expect(tail).not.toHaveTextContent("summary only")
	})
})
