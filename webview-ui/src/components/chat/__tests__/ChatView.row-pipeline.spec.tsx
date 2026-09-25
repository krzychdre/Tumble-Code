// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatView.row-pipeline.spec.tsx

// Characterization of the chat-row pipeline (combine, filter, batch, condensing
// row): which rows ChatView hands to the list for a given history. It pins the
// behavior before the pipeline moves out of the component (WEB-1).

import React from "react"
import { render, waitFor, act, screen } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import type { ClineMessage } from "@roo-code/types"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"

import ChatView, { ChatViewProps } from "../ChatView"

import {
	describeRow,
	hashText,
	retryDelayedLastFixture,
	rowPipelineFixtures,
	toolBatchingFixture,
} from "./fixtures/rowPipelineFixtures"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => [vi.fn()]),
}))

// The row prints its characterization line and nothing else, so the spec
// sees exactly which messages reached the list and in which order.
vi.mock("../ChatRow", async () => {
	const { describeRow } = await import("./fixtures/rowPipelineFixtures")
	return {
		default: ({ message }: { message: ClineMessage }) => <div data-testid="chat-row">{describeRow(message)}</div>,
	}
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

const renderedRows = () => screen.queryAllByTestId("chat-row").map((row) => row.textContent)

const showHistory = async (messages: ClineMessage[]) => {
	await act(async () => {
		hydrateState(messages)
	})
}

describe("ChatView row pipeline (characterization)", () => {
	it.each(rowPipelineFixtures.map((fixture) => [fixture.name, fixture] as const))(
		"renders the expected rows: %s",
		async (_name, fixture) => {
			renderChatView()
			await showHistory(fixture.messages)

			await waitFor(() => {
				expect(renderedRows()).toEqual(fixture.expectedRows)
			})
		},
	)

	// The retry notice after it is no longer the last message. On a fresh
	// render it would be hidden (see the "followed by more messages" fixture).
	const retryDone: ClineMessage = {
		type: "say",
		say: "text",
		ts: 3003,
		text: "The retry went through.",
		partial: false,
	}

	it("keeps a row that was once visible even when its kind is now filtered (ever visible)", async () => {
		renderChatView()
		await showHistory(retryDelayedLastFixture.messages)

		await waitFor(() => {
			expect(renderedRows()).toEqual(retryDelayedLastFixture.expectedRows)
		})

		// The countdown ticks: same message, new text.
		const [taskMessage, apiReq, retry] = retryDelayedLastFixture.messages
		const tick = { ...retry, text: "Retrying in 4 seconds" }
		await showHistory([taskMessage, apiReq, tick])

		await waitFor(() => {
			expect(renderedRows()).toEqual([retryDelayedLastFixture.expectedRows[0], describeRow(tick)])
		})

		// Seen on a render after the task mounted, so it stays.
		await showHistory([taskMessage, apiReq, tick, retryDone])

		await waitFor(() => {
			expect(renderedRows()).toEqual([
				retryDelayedLastFixture.expectedRows[0],
				describeRow(tick),
				describeRow(retryDone),
			])
		})
	})

	it("does not remember rows that were visible only on the task's first render", async () => {
		renderChatView()
		await showHistory(retryDelayedLastFixture.messages)

		await waitFor(() => {
			expect(renderedRows()).toEqual(retryDelayedLastFixture.expectedRows)
		})

		// The task-change effect clears the "ever visible" set after the first
		// render has filled it, so the retry notice is filtered like on a
		// fresh render. Pinned as is: the refactor must not change it.
		await showHistory([...retryDelayedLastFixture.messages, retryDone])

		await waitFor(() => {
			expect(renderedRows()).toEqual([retryDelayedLastFixture.expectedRows[0], describeRow(retryDone)])
		})
	})

	it("appends the synthetic condensing row while the context is condensing", async () => {
		renderChatView()
		await showHistory(toolBatchingFixture.messages)

		await waitFor(() => {
			expect(renderedRows()).toEqual(toolBatchingFixture.expectedRows)
		})

		await act(async () => {
			window.postMessage({ type: "condenseTaskContextStarted", text: "task-id" }, "*")
		})

		await waitFor(() => {
			expect(renderedRows()).toEqual([
				...toolBatchingFixture.expectedRows,
				`${Number.MAX_SAFE_INTEGER} say condense_context ${hashText(undefined)} partial`,
			])
		})
	})
})
