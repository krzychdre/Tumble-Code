// pnpm --filter @tumble-code/vscode-webview test src/components/chat/__tests__/SubagentsPanel.spec.tsx

import { fireEvent, render, screen } from "@/utils/test-utils"

import type { SubagentSummary } from "@tumble-code/types"

import { TooltipProvider } from "@/components/ui/tooltip"

import SubagentsPanel from "../SubagentsPanel"
import { SubagentTranscriptContext } from "../SubagentTranscriptContext"

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

	// Regression: queued children counted as active, so 4 running + 16 queued
	// read "20/20 active".
	it("counts running, queued and awaiting-input children separately", () => {
		renderPanel(
			[
				summary({ taskId: "r", index: 0, status: "running" }),
				summary({ taskId: "q1", index: 1, status: "queued" }),
				summary({ taskId: "q2", index: 2, status: "queued" }),
				summary({ taskId: "w", index: 3, status: "awaiting_input" }),
				summary({ taskId: "c", index: 4, status: "completed" }),
			],
			"parent",
		)

		expect(screen.getByText(/chat:subagents.headerRunning/)).toHaveTextContent(
			'chat:subagents.headerRunning {"running":1,"total":5} · chat:subagents.headerQueued {"count":2} · chat:subagents.headerAwaitingInput {"count":1}',
		)
	})

	it("names only the live states that are present", () => {
		renderPanel([summary({ taskId: "r", status: "running" })], "parent")

		expect(screen.getByText(/chat:subagents.headerRunning/)).toHaveTextContent(
			'chat:subagents.headerRunning {"running":1,"total":1}',
		)
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

// Regression: every fan-out of a task replaced the panel rows of the one
// before, so a task that fanned out three times listed only the last run.
describe("SubagentsPanel with several runs", () => {
	const runs = [
		summary({ taskId: "a", runId: "r1", index: 0, description: "run one first", startedAt: 1000 }),
		summary({ taskId: "b", runId: "r1", index: 1, description: "run one second", status: "failed" }),
		summary({ taskId: "c", runId: "r2", index: 0, description: "run two first", status: "running" }),
	]

	it("lists every run under its own header; earlier finished runs start closed", () => {
		renderPanel(runs, "parent")
		expandPanel()

		expect(screen.getByText(/chat:subagents.runHeader {"number":1,.*"finished":2,"total":2}/)).toBeInTheDocument()
		expect(screen.getByText(/chat:subagents.runHeader {"number":2,.*"finished":0,"total":1}/)).toBeInTheDocument()
		expect(screen.queryByText("run one first")).not.toBeInTheDocument()
		expect(screen.getByText("run two first")).toBeInTheDocument()

		fireEvent.click(screen.getByText(/chat:subagents.runHeader {"number":1/))
		expect(screen.getByText("run one first")).toBeInTheDocument()
		expect(screen.getByText("run one second")).toBeInTheDocument()
	})

	it("puts rows of an unknown run first, under their own unnumbered header", () => {
		renderPanel([summary({ taskId: "old", description: "old one" }), ...runs], "parent")
		expandPanel()

		expect(screen.getByText(/chat:subagents.runEarlier/)).toBeInTheDocument()
		expect(screen.getByText(/chat:subagents.runHeader {"number":1,/)).toBeInTheDocument()
		expect(screen.getByText(/chat:subagents.runHeader {"number":2,/)).toBeInTheDocument()
	})

	it("a single run has no run header", () => {
		renderPanel([runs[0], runs[1]], "parent")
		expandPanel()

		expect(screen.queryByText(/chat:subagents.runHeader/)).not.toBeInTheDocument()
		expect(screen.getByText("run one first")).toBeInTheDocument()
	})
})

describe("SubagentsPanel rows", () => {
	const renderWithOpen = (subagents: SubagentSummary[]) => {
		const open = vi.fn()
		render(
			<TooltipProvider>
				<SubagentTranscriptContext.Provider value={open}>
					<SubagentsPanel subagents={subagents} taskId="parent" />
				</SubagentTranscriptContext.Provider>
			</TooltipProvider>,
		)
		expandPanel()
		return open
	}

	it("a click opens the subagent's whole transcript", () => {
		const open = renderWithOpen([summary({})])

		fireEvent.click(screen.getByRole("button", { name: /first subtask/ }))

		expect(open).toHaveBeenCalledWith("child-1")
	})

	it("a queued placeholder has no task yet: nothing to open", () => {
		const open = renderWithOpen([summary({ taskId: "queued:parent:r1:0", status: "queued" })])

		const row = screen.getByRole("button", { name: /first subtask/ })
		expect(row).toBeDisabled()
		fireEvent.click(row)
		expect(open).not.toHaveBeenCalled()
	})

	it("a running subagent shows what it does now", () => {
		renderWithOpen([summary({ status: "running", activity: "$ npm test" })])

		expect(screen.getByTestId("subagent-row-detail")).toHaveTextContent("$ npm test")
	})

	it("a failed subagent shows why it stopped", () => {
		renderWithOpen([summary({ status: "failed", activity: "$ npm test", finalMessage: "Stopped as stuck: x" })])

		expect(screen.getByTestId("subagent-row-detail")).toHaveTextContent("Stopped as stuck: x")
	})

	it("a completed subagent shows no detail line", () => {
		renderWithOpen([summary({ finalMessage: "all done", activity: "$ npm test" })])

		expect(screen.queryByTestId("subagent-row-detail")).not.toBeInTheDocument()
	})
})
