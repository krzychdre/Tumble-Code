// pnpm --filter @tumble-code/vscode-webview test src/components/chat/__tests__/SubagentTranscriptView.spec.tsx

import React, { useContext } from "react"
import { act, fireEvent, render, screen } from "@/utils/test-utils"

import type { ClineMessage, HistoryItem, SubagentSummary } from "@tumble-code/types"

import { vscode } from "@src/utils/vscode"

import SubagentTranscriptView from "../SubagentTranscriptView"
import { ReadOnlyRowsContext } from "../rows/ReadOnlyRowsContext"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key),
	}),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("../../common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown: string }) => <div>{markdown}</div>,
}))

// The real rows are covered by the ChatRow specs; this one shows what each
// row is given, and whether it renders read-only.
vi.mock("../ChatRow", () => ({
	default: function MockChatRow({ message }: { message: ClineMessage }) {
		const readOnly = useContext(ReadOnlyRowsContext)
		return (
			<div data-testid="row" data-read-only={String(readOnly)}>
				{`${message.say ?? message.ask}: ${message.text ?? ""}`}
			</div>
		)
	},
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: function MockVirtuoso({
		data,
		itemContent,
		components,
	}: {
		data: ClineMessage[]
		itemContent: (index: number, item: ClineMessage) => React.ReactNode
		components?: { Header?: () => React.ReactNode }
	}) {
		const Header = components?.Header
		return (
			<div>
				{Header && <Header />}
				{data.map((item, index) => (
					<div key={item.ts}>{itemContent(index, item)}</div>
				))}
			</div>
		)
	},
}))

const state = vi.hoisted(() => ({
	current: { subagents: [] as SubagentSummary[], taskHistory: [] as HistoryItem[] },
}))
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionSelector: (selector: (s: never) => unknown) => selector(state.current as never),
}))

const summary = (overrides: Partial<SubagentSummary> = {}): SubagentSummary => ({
	taskId: "child-1",
	parentTaskId: "parent",
	runId: "r1",
	index: 0,
	mode: "code",
	description: "fix the ladder",
	status: "running",
	apiConfigName: "DeepSeek",
	tokensIn: 1500,
	tokensOut: 500,
	totalCost: 0.25,
	startedAt: 1,
	lastActivityAt: 1,
	...overrides,
})

const fromHost = (data: Record<string, unknown>) =>
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data }))
	})

const TRANSCRIPT: ClineMessage[] = [
	{ ts: 1, type: "say", say: "text", text: "Repo: Game. Fix the ladder." },
	{ ts: 2, type: "say", say: "reasoning", text: "look at ladder.js" },
	{ ts: 3, type: "ask", ask: "tool", text: JSON.stringify({ tool: "readFile", path: "src/game/ladder.js" }) },
	{ ts: 4, type: "say", say: "completion_result", text: "Dok\\u0142adnie tak" },
]

const renderView = (taskId = "child-1") => {
	const onDone = vi.fn()
	render(<SubagentTranscriptView taskId={taskId} onDone={onDone} />)
	return onDone
}

describe("SubagentTranscriptView", () => {
	beforeEach(() => {
		vi.mocked(vscode.postMessage).mockClear()
		state.current = { subagents: [summary()], taskHistory: [] }
	})

	it("subscribes on open and unsubscribes on close", () => {
		const { unmount } = render(<SubagentTranscriptView taskId="child-1" onDone={vi.fn()} />)

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "subscribeSubagentMessages", taskId: "child-1" })
		unmount()
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "unsubscribeSubagentMessages", taskId: "child-1" })
	})

	it("switching to another subagent drops the old transcript and resubscribes", () => {
		state.current = { subagents: [summary(), summary({ taskId: "child-2", index: 1 })], taskHistory: [] }
		const { rerender } = render(<SubagentTranscriptView taskId="child-1" onDone={vi.fn()} />)
		fromHost({ type: "subagentMessages", sourceTaskId: "child-1", subagentMessages: TRANSCRIPT })
		expect(screen.getAllByTestId("row")).toHaveLength(3)

		rerender(<SubagentTranscriptView taskId="child-2" onDone={vi.fn()} />)

		expect(screen.queryByTestId("row")).not.toBeInTheDocument()
		expect(screen.queryByText("Repo: Game. Fix the ladder.")).not.toBeInTheDocument()
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "unsubscribeSubagentMessages", taskId: "child-1" })
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "subscribeSubagentMessages", taskId: "child-2" })
	})

	it("shows the subtask message, then every row, read-only", () => {
		renderView()
		fromHost({ type: "subagentMessages", sourceTaskId: "child-1", subagentMessages: TRANSCRIPT })

		expect(screen.getByText("Repo: Game. Fix the ladder.")).toBeInTheDocument()
		const rows = screen.getAllByTestId("row")
		expect(rows.map((row) => row.textContent)).toEqual([
			"reasoning: look at ladder.js",
			expect.stringContaining("readFile"),
			"completion_result: Dok\\u0142adnie tak",
		])
		expect(rows.every((row) => row.dataset.readOnly === "true")).toBe(true)
	})

	it("follows a running subagent: new and updated messages", () => {
		renderView()
		fromHost({ type: "subagentMessages", sourceTaskId: "child-1", subagentMessages: TRANSCRIPT.slice(0, 2) })
		fromHost({ type: "messageUpdated", sourceTaskId: "child-1", clineMessage: { ...TRANSCRIPT[1], text: "more" } })
		fromHost({ type: "messageUpdated", sourceTaskId: "child-1", clineMessage: TRANSCRIPT[2] })
		fromHost({ type: "messageUpdated", sourceTaskId: "other", clineMessage: TRANSCRIPT[3] })

		expect(screen.getAllByTestId("row").map((row) => row.textContent)).toEqual([
			"reasoning: more",
			expect.stringContaining("readFile"),
		])
	})

	it("a running subagent can be stopped and guided from the transcript", () => {
		renderView()
		fromHost({ type: "subagentMessages", sourceTaskId: "child-1", subagentMessages: TRANSCRIPT.slice(0, 2) })

		fireEvent.click(screen.getByLabelText("chat:subagents.cancel"))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "cancelSubagent", taskId: "child-1" })

		const input = screen.getByPlaceholderText("chat:subagents.guidancePlaceholder")
		fireEvent.change(input, { target: { value: "use the solver" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "queueSubagentMessage",
			text: "use the solver",
			taskId: "child-1",
		})
	})

	it("a subagent waiting on a question: its suggestions answer it", () => {
		state.current = { subagents: [summary({ status: "awaiting_input" })], taskHistory: [] }
		renderView()
		fromHost({
			type: "subagentMessages",
			sourceTaskId: "child-1",
			subagentMessages: [
				TRANSCRIPT[0],
				{
					ts: 5,
					type: "ask",
					ask: "followup",
					text: JSON.stringify({ question: "Which file?", suggest: [{ answer: "ladder.js" }] }),
				},
			],
		})

		fireEvent.click(screen.getByText("ladder.js"))
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "messageResponse",
			text: "ladder.js",
			taskId: "child-1",
		})
	})

	it("a failed subagent: the stop reason in the header, no controls", () => {
		state.current = {
			subagents: [summary({ status: "failed", finalMessage: "Stopped as stuck: it made 6 mistakes." })],
			taskHistory: [],
		}
		renderView()
		fromHost({ type: "subagentMessages", sourceTaskId: "child-1", subagentMessages: TRANSCRIPT })

		expect(screen.getByTestId("subagent-stop-reason")).toHaveTextContent("Stopped as stuck: it made 6 mistakes.")
		expect(screen.queryByLabelText("chat:subagents.cancel")).not.toBeInTheDocument()
		expect(screen.queryByPlaceholderText(/chat:subagents/)).not.toBeInTheDocument()
	})

	it("opened from history (not in the panel): the header comes from its history item", () => {
		state.current = {
			subagents: [],
			taskHistory: [
				{
					id: "old-child",
					number: 1,
					ts: 1,
					task: "Old subtask\nwith details",
					tokensIn: 1000,
					tokensOut: 0,
					totalCost: 0.5,
					mode: "debug",
				} as HistoryItem,
			],
		}
		const onDone = renderView("old-child")

		expect(screen.getByText("Old subtask")).toBeInTheDocument()
		expect(screen.getByText("debug")).toBeInTheDocument()
		expect(screen.getByText("$0.50")).toBeInTheDocument()
		fireEvent.click(screen.getByTestId("subagent-transcript-back"))
		expect(onDone).toHaveBeenCalled()
	})
})
