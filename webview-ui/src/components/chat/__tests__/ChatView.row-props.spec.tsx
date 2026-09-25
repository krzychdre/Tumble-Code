// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatView.row-props.spec.tsx

import React, { memo, useEffect } from "react"
import deepEqual from "fast-deep-equal"
import { render, waitFor, act } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"

import ChatView, { ChatViewProps } from "../ChatView"

interface ClineMessage {
	type: "say" | "ask"
	say?: string
	ask?: string
	ts: number
	text?: string
	partial?: boolean
}

// What each row received on its latest render, and how often each row
// rendered. The mock is wrapped in memo(deepEqual) exactly like the real
// ChatRow, so the render count shows whether the real memo would hold.
const rowState = vi.hoisted(() => ({
	props: new Map<number, Record<string, unknown>>(),
	renders: new Map<number, number>(),
	condensingMounts: 0,
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => [vi.fn()]),
}))

vi.mock("../ChatRow", () => {
	const MockChatRow = memo((props: { message: ClineMessage } & Record<string, unknown>) => {
		const ts = props.message.ts
		rowState.props.set(ts, props)
		rowState.renders.set(ts, (rowState.renders.get(ts) ?? 0) + 1)
		const isCondensingRow = props.message.say === "condense_context"
		useEffect(() => {
			if (isCondensingRow) {
				rowState.condensingMounts++
			}
		}, [isCondensingRow])
		return <div data-testid={`chat-row-${ts}`} />
	}, deepEqual)
	return { default: MockChatRow }
})

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
					<div key={computeItemKey?.(index, item) ?? item.ts}>{itemContent(index, item)}</div>
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
	}),
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => <>{children || i18nKey}</>,
}))

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

const TASK_TS = 1
const CHECKPOINT_TS = 2
const TODO_ASK_TS = 3

// A checkpoint and an updateTodoList tool ask: the two inputs of the removed
// `hasCheckpoint` and `editable` computations.
const todoTask = (): ClineMessage[] => [
	{ type: "say", say: "task", ts: TASK_TS, text: "Initial task" },
	{ type: "say", say: "checkpoint_saved", ts: CHECKPOINT_TS, text: "abc123" },
	{
		type: "ask",
		ask: "tool",
		ts: TODO_ASK_TS,
		text: JSON.stringify({ tool: "updateTodoList", todos: [] }),
		partial: false,
	},
]

const EARLIER_TS = 2
const STREAMED_TS = 3

// An earlier finished text row and a last text row that is still streaming.
const streamingTask = (streamedText: string): ClineMessage[] => [
	{ type: "say", say: "task", ts: TASK_TS, text: "Initial task" },
	{ type: "say", say: "text", ts: EARLIER_TS, text: "Earlier answer", partial: false },
	{ type: "say", say: "text", ts: STREAMED_TS, text: streamedText, partial: true },
]

const streamToken = (text: string) => {
	window.postMessage(
		{
			type: "messageUpdated",
			clineMessage: { type: "say", say: "text", ts: STREAMED_TS, text, partial: true },
		},
		"*",
	)
}

describe("ChatView row props", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		rowState.props.clear()
		rowState.renders.clear()
		rowState.condensingMounts = 0
	})

	it("passes rows no props that ChatRow does not read", async () => {
		const { getByTestId } = renderChatView()

		await act(async () => {
			hydrateState(todoTask())
		})

		await waitFor(() => {
			expect(getByTestId(`chat-row-${TODO_ASK_TS}`)).toBeInTheDocument()
		})

		// ChatRow declared `editable` and `hasCheckpoint` but never read them.
		for (const props of rowState.props.values()) {
			expect(props).not.toHaveProperty("editable")
			expect(props).not.toHaveProperty("hasCheckpoint")
		}
	})

	it("gives lastModifiedMessage only to the last row", async () => {
		const { getByTestId } = renderChatView()

		await act(async () => {
			hydrateState(streamingTask("Hel"))
		})

		await waitFor(() => {
			expect(getByTestId(`chat-row-${STREAMED_TS}`)).toBeInTheDocument()
		})

		expect(rowState.props.get(EARLIER_TS)?.lastModifiedMessage).toBeUndefined()
		expect(rowState.props.get(STREAMED_TS)?.lastModifiedMessage).toMatchObject({ ts: STREAMED_TS })
	})

	it("does not re-render earlier rows when only the streamed last message changes", async () => {
		const { getByTestId } = renderChatView()

		await act(async () => {
			hydrateState(streamingTask("Hel"))
		})

		await waitFor(() => {
			expect(getByTestId(`chat-row-${STREAMED_TS}`)).toBeInTheDocument()
		})

		const earlierRenders = rowState.renders.get(EARLIER_TS)
		const streamedRenders = rowState.renders.get(STREAMED_TS) ?? 0

		await act(async () => {
			streamToken("Hello")
		})

		await waitFor(() => {
			expect(rowState.renders.get(STREAMED_TS)).toBeGreaterThan(streamedRenders)
		})

		// Every row used to receive the last message, which changes on each
		// token, so the deepEqual memo let every row re-render per token.
		expect(rowState.renders.get(EARLIER_TS)).toBe(earlierRenders)
	})

	it.each([
		["claude-opus-5", true],
		["claude-3-5-haiku-20241022", false],
	])("tells rows whether the selected model %s takes images (%s)", async (apiModelId, supportsImages) => {
		const { getByTestId } = renderChatView()

		await act(async () => {
			hydrateState(streamingTask("Hel"), { apiConfiguration: { apiProvider: "anthropic", apiModelId } })
		})

		await waitFor(() => {
			expect(getByTestId(`chat-row-${STREAMED_TS}`)).toBeInTheDocument()
			expect(rowState.props.get(EARLIER_TS)?.supportsImages).toBe(supportsImages)
		})
	})

	it("keeps the condensing row mounted while the list recomputes", async () => {
		// Every call returns a later time, as it would between two tokens.
		let now = 1_000_000
		const dateNow = vi.spyOn(Date, "now").mockImplementation(() => (now += 1000))
		onTestFinished(() => dateNow.mockRestore())

		const { getByTestId } = renderChatView()

		await act(async () => {
			hydrateState(streamingTask("Hel"))
		})

		await waitFor(() => {
			expect(getByTestId(`chat-row-${STREAMED_TS}`)).toBeInTheDocument()
		})

		await act(async () => {
			window.postMessage({ type: "condenseTaskContextStarted", text: "task-id" }, "*")
		})

		await waitFor(() => {
			expect(rowState.condensingMounts).toBe(1)
		})

		const streamedRenders = rowState.renders.get(STREAMED_TS) ?? 0

		await act(async () => {
			streamToken("Hello")
		})

		await waitFor(() => {
			expect(rowState.renders.get(STREAMED_TS)).toBeGreaterThan(streamedRenders)
		})

		// The synthetic row used `ts: Date.now()`, so every recompute of the
		// list gave it a new key and React mounted a fresh row (the spinner
		// restarted and the row lost its measured height).
		expect(rowState.condensingMounts).toBe(1)
	})
})
