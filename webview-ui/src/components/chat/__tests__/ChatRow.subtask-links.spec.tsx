import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ChatRowContent } from "../ChatRow"
import type { HistoryItem } from "@tumble-code/types"

import type { RowMetaEntry } from "../rows/computeRowMeta"

// Mock vscode API
const mockPostMessage = vi.fn()
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (msg: unknown) => mockPostMessage(msg),
	},
}))

// Mock i18n
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:subtasks.wantsToCreate": "Roo wants to create a new subtask",
				"chat:subtasks.resultContent": "Task result",
				"chat:subtasks.goToSubtask": "Go to subtask",
			}
			return map[key] ?? key
		},
		i18n: { exists: () => true },
	}),
	Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// Mock extension state context. It has no clineMessages: the row gets what it
// needs from the history through its `meta` prop.
let mockCurrentTaskItem: Partial<HistoryItem> | undefined = undefined

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [],
		alwaysAllowMcp: false,
		currentCheckpoint: null,
		mode: "code",
		currentTaskItem: mockCurrentTaskItem,
	}),
	useExtensionSelector: (selector: (s: never) => unknown) =>
		selector({
			mcpServers: [],
			alwaysAllowMcp: false,
			currentCheckpoint: null,
			mode: "code",
			currentTaskItem: mockCurrentTaskItem,
		} as never),
}))

// Mock useSelectedModel hook
vi.mock("@src/hooks/models/useSelectedModel", () => ({
	useSelectedModel: () => ({ info: { supportsImages: true } }),
}))

const queryClient = new QueryClient()

// The meta ChatView computes for a lone newTask ask: the first newTask ask, not
// followed by a subtask_result.
const FIRST_NEW_TASK_META: RowMetaEntry = {
	nextTs: undefined,
	previousTodos: [],
	newTaskIndex: 0,
	followedBySubtaskResult: false,
}

function renderChatRow(message: any, currentTaskItem?: Partial<HistoryItem>, meta: RowMetaEntry = FIRST_NEW_TASK_META) {
	mockCurrentTaskItem = currentTaskItem

	return render(
		<QueryClientProvider client={queryClient}>
			<ChatRowContent
				message={message}
				isExpanded={false}
				isLast={false}
				isStreaming={false}
				onToggleExpand={() => {}}
				onSuggestionClick={() => {}}
				onBatchFileResponse={() => {}}
				onFollowUpUnmount={() => {}}
				isFollowUpAnswered={false}
				meta={meta}
			/>
		</QueryClientProvider>,
	)
}

const newTaskAsk = {
	ts: 1000,
	type: "ask" as const,
	ask: "tool" as const,
	text: JSON.stringify({ tool: "newTask", mode: "code", content: "Implement feature X" }),
}

const subtaskResult = {
	ts: 2000,
	type: "say" as const,
	say: "subtask_result" as const,
	text: "The subtask has been completed successfully.",
}

describe("ChatRow - subtask links", () => {
	beforeEach(() => {
		mockPostMessage.mockClear()
	})

	// childIds maps by index to the task's newTask asks (meta.newTaskIndex).
	it.each([
		[
			"the first newTask",
			newTaskAsk,
			{ childIds: ["first-child", "second-child"] },
			FIRST_NEW_TASK_META,
			"first-child",
		],
		[
			"the second newTask",
			newTaskAsk,
			{ childIds: ["first-child", "second-child"] },
			{ ...FIRST_NEW_TASK_META, newTaskIndex: 1 },
			"second-child",
		],
		[
			"a subtask_result",
			subtaskResult,
			{ completedByChildId: "completed-child-456" },
			FIRST_NEW_TASK_META,
			"completed-child-456",
		],
	])("links %s to its child task", (_name, message, taskItem, meta, childId) => {
		renderChatRow(message, taskItem, meta)

		fireEvent.click(screen.getByText("Go to subtask"))

		expect(mockPostMessage).toHaveBeenCalledWith({ type: "showTaskWithId", text: childId })
	})

	// Directly followed by a subtask_result, the result row carries the link.
	it.each([
		["a newTask without a child", newTaskAsk, undefined, FIRST_NEW_TASK_META],
		[
			"a newTask followed by its result",
			newTaskAsk,
			{ childIds: ["child-task-123"] },
			{ ...FIRST_NEW_TASK_META, nextTs: 1001, followedBySubtaskResult: true },
		],
		["a subtask_result without a child", subtaskResult, undefined, FIRST_NEW_TASK_META],
	])("shows no link for %s", (_name, message, taskItem, meta) => {
		renderChatRow(message, taskItem, meta)

		expect(screen.queryByText("Go to subtask")).toBeNull()
	})
})
