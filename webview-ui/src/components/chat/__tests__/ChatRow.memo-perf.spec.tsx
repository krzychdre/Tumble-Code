// A streamed token rebuilds the last message only. Through the real store and
// the real memo comparator, every other row must skip its render: the height
// contract of the chat list depends on rows not re-rendering for another row's
// tokens (ai_plans/2026-09-28_p2-chatrow-targeted-comparator.md).
import React, { useCallback } from "react"
import { render, act, waitFor } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useSize } from "react-use"

import type { ClineMessage, ExtensionState } from "@tumble-code/types"

import { ExtensionStateContextProvider, useExtensionSelector } from "@src/context/ExtensionStateContext"
import ChatRow from "../ChatRow"

// useSize runs in ChatRow's own body on every render and is skipped when the
// memo bails out, so its calls count ChatRow renders.
vi.mock("react-use", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>()
	return {
		...actual,
		useSize: vi.fn((element: React.ReactNode) => [element, { height: 42 }]),
	}
})
const useSizeSpy = vi.mocked(useSize as unknown as (element: React.ReactNode) => [React.ReactNode, { height: number }])

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))
vi.mock("use-sound", () => ({ default: vi.fn().mockImplementation(() => [vi.fn()]) }))

// ---------------------------------------------------------------------------
// Deterministic seed data
// ---------------------------------------------------------------------------

const TASK_TS = 1_000
const N_ROWS = 20
const N_TOKEN_UPDATES = 20

/** A realistic 20-row history: varied tool/say/checkpoint rows, one streaming partial at the end. */
const seedMessages = (): ClineMessage[] => {
	const messages: ClineMessage[] = [
		{ type: "say", say: "text", ts: TASK_TS, text: "Refactor the chat row memo", partial: false },
	]
	for (let i = 1; i < N_ROWS - 1; i++) {
		const kind = i % 4
		if (kind === 0) {
			messages.push({
				type: "say",
				say: "tool",
				ts: TASK_TS + i,
				text: JSON.stringify({ tool: "readFile", path: `/src/file${i}.ts`, content: "x".repeat(120) }),
				partial: false,
			})
		} else if (kind === 1) {
			messages.push({
				type: "say",
				say: "text",
				ts: TASK_TS + i,
				text: `answer ${i} ${"y".repeat(60)}`,
				partial: false,
			})
		} else if (kind === 2) {
			messages.push({ type: "say", say: "checkpoint_saved", ts: TASK_TS + i, text: `hash${i}` })
		} else {
			messages.push({
				type: "say",
				say: "user_feedback",
				ts: TASK_TS + i,
				text: `feedback ${i}`,
				partial: false,
			})
		}
	}
	// The streaming answer the tokens extend.
	messages.push({ type: "say", say: "text", ts: TASK_TS + N_ROWS, text: "", partial: true })
	return messages
}

const seedState = (clineMessages: ClineMessage[], seq: number): Partial<ExtensionState> => ({
	apiConfiguration: { apiProvider: "anthropic", apiModelId: "claude-3-5-sonnet-20241022" },
	clineMessages,
	clineMessagesSeq: seq,
	currentTaskId: "task-1",
	currentTaskItem: {
		id: "task-1",
		number: 1,
		ts: TASK_TS,
		task: "Refactor the chat row memo",
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
		size: 4096,
	},
	cwd: "/home/user/project",
	currentApiConfigName: "default",
	listApiConfigMeta: [{ id: "default", name: "default" }],
	mode: "code",
	customModes: [],
	taskHistory: [],
	mcpServers: [],
	alwaysAllowReadOnly: true,
	soundEnabled: true,
	language: "en",
})

const dispatchState = (state: Partial<ExtensionState>) => {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: { type: "state", state } }))
	})
}

const StoreBackedList = () => {
	const messages = useExtensionSelector((s: { clineMessages?: ClineMessage[] }) => s.clineMessages)
	// Stable identities, exactly like ChatView's itemContent.
	const onToggleExpand = useCallback(() => {}, [])
	const onHeightChange = useCallback(() => {}, [])
	const onSuggestionClick = useCallback(() => {}, [])
	const onBatchFileResponse = useCallback(() => {}, [])
	const onFollowUpUnmount = useCallback(() => {}, [])
	const lastTs = messages?.at(-1)?.ts
	return (
		<div>
			{messages?.map((message, index) => (
				<ChatRow
					key={message.ts}
					message={message}
					isExpanded={false}
					onToggleExpand={onToggleExpand}
					lastModifiedMessage={index === messages.length - 1 ? messages.at(-1) : undefined}
					isLast={message.ts === lastTs}
					onHeightChange={onHeightChange}
					isStreaming={true}
					onSuggestionClick={onSuggestionClick}
					onBatchFileResponse={onBatchFileResponse}
					onFollowUpUnmount={onFollowUpUnmount}
				/>
			))}
		</div>
	)
}

describe("ChatRow memo during streaming", () => {
	it("re-renders only the streaming row on each token", async () => {
		render(
			<ExtensionStateContextProvider>
				<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
					<StoreBackedList />
				</QueryClientProvider>
			</ExtensionStateContextProvider>,
		)

		const seed = seedMessages()
		dispatchState(seedState(seed, 1))
		await waitFor(() => expect(useSizeSpy.mock.calls.length).toBe(N_ROWS))
		useSizeSpy.mockClear()

		for (let i = 1; i <= N_TOKEN_UPDATES; i++) {
			const messages = seed.map((message, index) =>
				index === seed.length - 1 ? { ...message, text: `answer ${"t".repeat(i)}`, partial: true } : message,
			)
			dispatchState({ clineMessages: messages, clineMessagesSeq: i + 1 })
		}

		// useSize receives the wrapper div; its child carries the row's message.
		const streamedTs = seed[seed.length - 1]!.ts
		const renderedTs = useSizeSpy.mock.calls.map(
			(call) =>
				(call[0] as React.ReactElement<{ children: React.ReactElement<{ message: ClineMessage }> }>).props
					.children.props.message.ts,
		)
		expect(renderedTs.filter((ts) => ts === streamedTs).length).toBeGreaterThanOrEqual(N_TOKEN_UPDATES)
		expect(renderedTs.filter((ts) => ts !== streamedTs)).toEqual([])
	})
})
