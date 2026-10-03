// pnpm --filter @tumble-code/vscode-webview test src/components/chat/__tests__/SubagentsPanel.spec.tsx

import { render, screen } from "@/utils/test-utils"

import type { SubagentSummary } from "@tumble-code/types"

import { TooltipProvider } from "@/components/ui/tooltip"

import SubagentsPanel from "../SubagentsPanel"

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

describe("SubagentsPanel task scope", () => {
	it("lists the fan-out of the open task", () => {
		renderPanel([summary({})], "parent")

		expect(screen.getByText("first subtask")).toBeInTheDocument()
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

		expect(screen.getByText("first subtask")).toBeInTheDocument()
		expect(screen.queryByText("foreign subtask")).not.toBeInTheDocument()
		expect(screen.getByText(/chat:subagents.headerDone/)).toHaveTextContent('{"total":1}')
	})

	it("renders nothing without an open task", () => {
		const { container } = renderPanel([summary({})], undefined)

		expect(container).toBeEmptyDOMElement()
	})
})
