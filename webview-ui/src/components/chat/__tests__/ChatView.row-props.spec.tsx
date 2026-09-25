// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatView.row-props.spec.tsx

import React, { memo } from "react"
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

const hydrateState = (clineMessages: ClineMessage[]) => {
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

describe("ChatView row props", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		rowState.props.clear()
		rowState.renders.clear()
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
})
