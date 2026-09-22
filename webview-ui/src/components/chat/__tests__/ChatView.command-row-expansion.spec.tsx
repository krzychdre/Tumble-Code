// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatView.command-row-expansion.spec.tsx

import React from "react"
import { render, waitFor, act, fireEvent } from "@/utils/test-utils"
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
	isAnswered?: boolean
}

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

const mockPlayFunction = vi.fn()
vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => [mockPlayFunction]),
}))

// The real ChatRow is too heavy to mount here, so the mock exposes the two
// props under test and wires its button exactly like ChatRow.handleToggleExpand:
// the target state is computed from what is displayed, not from the parent's
// map, because a default-open row has no entry there yet.
vi.mock("../ChatRow", () => ({
	default: function MockChatRow({
		message,
		isExpanded,
		onToggleExpand,
	}: {
		message: ClineMessage
		isExpanded: boolean
		onToggleExpand: (ts: number, expand?: boolean) => void
	}) {
		return (
			<div data-testid={`chat-row-${message.ts}`} data-expanded={String(isExpanded)}>
				<button aria-label={`toggle-${message.ts}`} onClick={() => onToggleExpand(message.ts, !isExpanded)}>
					toggle
				</button>
			</div>
		)
	},
}))

vi.mock("../AutoApproveMenu", () => ({
	default: () => null,
}))

vi.mock("react-virtuoso", () => ({
	Virtuoso: function MockVirtuoso({
		data,
		itemContent,
	}: {
		data: ClineMessage[]
		itemContent: (index: number, item: ClineMessage) => React.ReactNode
	}) {
		return (
			<div data-testid="virtuoso-item-list">
				{data.map((item, index) => (
					<div key={item.ts} data-testid={`virtuoso-item-${index}`}>
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
	default: () => <div data-testid="roo-tips">Tips content</div>,
}))

vi.mock("@src/components/welcome/RooHero", () => ({
	default: () => <div data-testid="roo-hero">Hero content</div>,
}))

vi.mock("../common/TelemetryBanner", () => ({
	default: () => null,
}))

// The i18n mock returns the key itself, so button labels render as their keys.
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

const RUN_BUTTON_LABEL = "chat:runCommand.title"

const COMMAND_TS = 2

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

const renderChatView = (props: Partial<ChatViewProps> = {}) =>
	render(
		<ExtensionStateContextProvider>
			<QueryClientProvider client={queryClient}>
				<ChatView {...defaultProps} {...props} />
			</QueryClientProvider>
		</ExtensionStateContextProvider>,
	)

const commandAsk = (): ClineMessage[] => [
	{ type: "say", say: "task", ts: 1, text: "Initial task" },
	{ type: "ask", ask: "command", ts: COMMAND_TS, text: "echo hi", partial: false },
]

const autoApprovedCommandAsk = (): ClineMessage[] => [
	{ type: "say", say: "task", ts: 1, text: "Initial task" },
	{ type: "ask", ask: "command", ts: COMMAND_TS, text: "echo hi", partial: false, isAnswered: true },
]

describe("ChatView command row expansion", () => {
	beforeEach(() => vi.clearAllMocks())

	it("opens the command row while it waits for manual approval", async () => {
		const { queryByText, getByTestId } = renderChatView()

		await act(async () => {
			hydrateState(commandAsk())
		})

		// The default-open only applies while the approval buttons are on screen.
		await waitFor(() => {
			expect(queryByText(RUN_BUTTON_LABEL)).toBeInTheDocument()
			expect(getByTestId(`chat-row-${COMMAND_TS}`)).toHaveAttribute("data-expanded", "true")
		})
	})

	it("keeps an auto-approved command row collapsed", async () => {
		const { queryByText, getByTestId } = renderChatView()

		await act(async () => {
			hydrateState(autoApprovedCommandAsk())
		})

		// isAnswered:true means the backend resolved the ask before the webview
		// saw it, so no buttons and therefore no reason to open the row.
		await waitFor(() => {
			expect(queryByText(RUN_BUTTON_LABEL)).not.toBeInTheDocument()
			expect(getByTestId(`chat-row-${COMMAND_TS}`)).toHaveAttribute("data-expanded", "false")
		})
	})

	it("lets the user collapse the default-open row", async () => {
		const { getByTestId, getByLabelText } = renderChatView()

		await act(async () => {
			hydrateState(commandAsk())
		})

		await waitFor(() => {
			expect(getByTestId(`chat-row-${COMMAND_TS}`)).toHaveAttribute("data-expanded", "true")
		})

		await act(async () => {
			fireEvent.click(getByLabelText(`toggle-${COMMAND_TS}`))
		})

		// The explicit false stored in expandedRows must beat the default-open,
		// which is still true because the approval buttons have not gone away.
		await waitFor(() => {
			expect(getByTestId(`chat-row-${COMMAND_TS}`)).toHaveAttribute("data-expanded", "false")
		})
	})
})
