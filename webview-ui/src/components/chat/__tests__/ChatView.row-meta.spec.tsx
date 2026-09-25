// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatView.row-meta.spec.tsx

// Characterization of what a row shows that depends on the history around it,
// not on the row's own message: the end time of a block (the next message's
// ts), the todo diff against the previous updateTodoList, and the subtask link
// of a newTask ask (its position among the newTask asks, and whether a
// subtask_result follows it). Rendered through ChatView with the real ChatRow,
// so the spec holds no matter where that meta is computed (WEB-2a).

import React from "react"
import { render, waitFor, act, screen, within, fireEvent } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { ClineMessage } from "@roo-code/types"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { vscode } from "@src/utils/vscode"

import ChatView, { ChatViewProps } from "../ChatView"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => [vi.fn()]),
}))

// Deterministic, locale-independent times: a block's end time shows up as its
// duration, D(end - start).
vi.mock("@src/utils/format", async (importOriginal) => ({
	...(await importOriginal<typeof import("@src/utils/format")>()),
	formatTimestamp: (ts: number) => `T(${ts})`,
	formatDuration: (ms: number) => `D(${ms})`,
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: function MockVirtuoso({
		data,
		itemContent,
		computeItemKey,
	}: {
		data: ClineMessage[]
		itemContent: (index: number, item: ClineMessage) => React.ReactNode
		computeItemKey?: (index: number, item: ClineMessage) => React.Key
	}) {
		return (
			<div data-testid="virtuoso-item-list">
				{data.map((item, index) => (
					<div key={computeItemKey?.(index, item) ?? item.ts} data-testid={`row-${item.ts}`}>
						{itemContent(index, item)}
					</div>
				))}
			</div>
		)
	},
}))

vi.mock("../../common/VersionIndicator", () => ({
	default: vi.fn(() => null),
}))

vi.mock("@src/components/welcome/RooTips", () => ({
	default: () => null,
}))

vi.mock("@src/components/welcome/RooHero", () => ({
	default: () => null,
}))

vi.mock("../common/TelemetryBanner", () => ({
	default: () => null,
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { exists: () => true },
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => <>{children || i18nKey}</>,
}))

// TodoChangeDisplay calls the bare i18next `t`, which is undefined in tests.
vi.mock("i18next", async (importOriginal) => {
	const actual = await importOriginal<typeof import("i18next")>()
	return { ...actual, t: (key: string) => key }
})

const hydrateState = (clineMessages: ClineMessage[], extraState: Record<string, unknown> = {}) => {
	window.postMessage(
		{
			type: "state",
			state: {
				version: "1.0.0",
				clineMessages,
				taskHistory: [],
				shouldShowAnnouncement: false,
				allowedCommands: [],
				alwaysAllowExecute: false,
				cloudIsAuthenticated: false,
				telemetrySetting: "enabled",
				...extraState,
			},
		},
		"*",
	)
}

const defaultProps: ChatViewProps = {
	isHidden: false,
	showAnnouncement: false,
	hideAnnouncement: () => {},
}

const queryClient = new QueryClient()

const renderChatView = () =>
	render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatView {...defaultProps} />
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)

const BASE = 1_700_000_000_000

const TS = {
	task: BASE,
	reasoning: BASE + 1_000,
	todoFirst: BASE + 3_000,
	textAfterFirstTodo: BASE + 4_000,
	todoSecond: BASE + 5_000,
	textAfterSecondTodo: BASE + 8_000,
	newTaskFirst: BASE + 10_000,
	textAfterFirstNewTask: BASE + 11_000,
	newTaskSecond: BASE + 12_000,
	subtaskResult: BASE + 13_000,
	apiReq: BASE + 15_000,
	newTaskThird: BASE + 15_500,
}

const todoAsk = (ts: number, todos: { id: string; content: string; status: string }[]): ClineMessage => ({
	type: "ask",
	ask: "tool",
	ts,
	text: JSON.stringify({ tool: "updateTodoList", todos }),
	partial: false,
})

const newTaskAsk = (ts: number, content: string): ClineMessage => ({
	type: "ask",
	ask: "tool",
	ts,
	text: JSON.stringify({ tool: "newTask", mode: "code", content }),
	partial: false,
})

const text = (ts: number, body: string): ClineMessage => ({ type: "say", say: "text", ts, text: body, partial: false })

const history: ClineMessage[] = [
	// The first message is the task itself (TaskHeader shows it, the list never does).
	{ type: "say", say: "text", ts: TS.task, text: "Initial task" },
	{ type: "say", say: "reasoning", ts: TS.reasoning, text: "Thinking it over", partial: false },
	todoAsk(TS.todoFirst, [
		{ id: "a", content: "Todo alpha", status: "in_progress" },
		{ id: "b", content: "Todo beta", status: "pending" },
		{ id: "c", content: "Todo gamma", status: "pending" },
	]),
	text(TS.textAfterFirstTodo, "Working on alpha"),
	todoAsk(TS.todoSecond, [
		{ id: "a", content: "Todo alpha", status: "completed" },
		{ id: "b", content: "Todo beta", status: "in_progress" },
		{ id: "c", content: "Todo gamma", status: "pending" },
	]),
	text(TS.textAfterSecondTodo, "Delegating"),
	newTaskAsk(TS.newTaskFirst, "First subtask"),
	text(TS.textAfterFirstNewTask, "Back from the first subtask"),
	newTaskAsk(TS.newTaskSecond, "Second subtask"),
	{ type: "say", say: "subtask_result", ts: TS.subtaskResult, text: "Second subtask done", partial: false },
	{ type: "say", say: "api_req_started", ts: TS.apiReq, text: JSON.stringify({ cost: 0.01 }), partial: false },
	newTaskAsk(TS.newTaskThird, "Third subtask"),
]

const currentTaskItem = {
	id: "parent-task",
	number: 1,
	ts: TS.task,
	task: "Initial task",
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	// Only the first two newTask asks were approved; the third is still waiting.
	childIds: ["child-a", "child-b"],
	completedByChildId: "child-b",
}

const row = (ts: number) => within(screen.getByTestId(`row-${ts}`))

const showHistory = async () => {
	renderChatView()
	await act(async () => {
		hydrateState(history, { currentTaskItem })
	})
	await waitFor(() => {
		expect(screen.getByTestId(`row-${TS.newTaskThird}`)).toBeInTheDocument()
	})
}

describe("ChatView row meta (characterization)", () => {
	beforeEach(() => {
		vi.mocked(vscode.postMessage).mockClear()
	})

	it("ends a block at the ts of the next message in the history", async () => {
		await showHistory()

		expect(row(TS.reasoning).getByText(`D(${TS.todoFirst - TS.reasoning})`)).toBeInTheDocument()
		expect(row(TS.todoFirst).getByText(`D(${TS.textAfterFirstTodo - TS.todoFirst})`)).toBeInTheDocument()
		expect(row(TS.todoSecond).getByText(`D(${TS.textAfterSecondTodo - TS.todoSecond})`)).toBeInTheDocument()
		expect(row(TS.apiReq).getByText(`D(${TS.newTaskThird - TS.apiReq})`)).toBeInTheDocument()
	})

	it("shows the first todo list whole and a later one as the diff to the previous list", async () => {
		await showHistory()

		const first = row(TS.todoFirst)
		expect(first.getByText("Todo alpha")).toBeInTheDocument()
		expect(first.getByText("Todo beta")).toBeInTheDocument()
		expect(first.getByText("Todo gamma")).toBeInTheDocument()

		// alpha was completed and beta started since the first list; gamma is
		// unchanged, so it is left out.
		const second = row(TS.todoSecond)
		expect(second.getByText("Todo alpha")).toBeInTheDocument()
		expect(second.getByText("Todo beta")).toBeInTheDocument()
		expect(second.queryByText("Todo gamma")).toBeNull()
	})

	it("links each approved newTask to the child at its position among the newTask asks", async () => {
		await showHistory()

		fireEvent.click(row(TS.newTaskFirst).getByText("chat:subtasks.goToSubtask"))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: "child-a" })

		// The third newTask has no child yet (still awaiting approval).
		expect(row(TS.newTaskThird).queryByText("chat:subtasks.goToSubtask")).toBeNull()
	})

	it("leaves the link to the subtask_result that directly follows a newTask", async () => {
		await showHistory()

		expect(row(TS.newTaskSecond).queryByText("chat:subtasks.goToSubtask")).toBeNull()

		fireEvent.click(row(TS.subtaskResult).getByText("chat:subtasks.goToSubtask"))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: "child-b" })
	})
})
