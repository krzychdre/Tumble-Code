// Tasks saved before #893 hold literal `\u0142` text (a backslash, `u` and four
// hex digits) in their prose; the rows must show the real letters.
// pnpm --filter @tumble-code/vscode-webview test src/components/chat/__tests__/ChatRow.stored-escapes.spec.tsx

import React from "react"
import { render } from "@/utils/test-utils"
import type { ClineMessage } from "@tumble-code/types"

import { ChatRowContent } from "../ChatRow"
import type { RowMetaEntry } from "../rows/computeRowMeta"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

// A bare i18next `t` is undefined in this test environment, so translations are mocked.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
	Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

const state = {
	mcpServers: [],
	alwaysAllowMcp: false,
	currentCheckpoint: null,
	mode: "code",
	currentTaskItem: undefined,
	autoApprovalEnabled: false,
	alwaysAllowFollowupQuestions: false,
	followupAutoApproveTimeoutMs: 60000,
}

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => state,
	useExtensionSelector: (selector: (s: never) => unknown) => selector(state as never),
}))

const META: RowMetaEntry = { nextTs: undefined, previousTodos: [], newTaskIndex: 0, followedBySubtaskResult: false }

// What ui_messages.json of task 01a134d6 holds: the six characters `\u0142`, not the letter.
const ESCAPED = "Dok\\u0142adnie tak, w kt\\u00f3rym miejscu"
const DECODED = "Dokładnie tak, w którym miejscu"

function renderRow(message: ClineMessage) {
	return render(
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
			meta={META}
		/>,
	)
}

// decodeStoredProse.spec.ts covers which kinds are decoded; here the row must
// apply it to the message and to a tool ask's payload.
describe("ChatRow - escaped letters in stored messages", () => {
	it.each([
		["completion_result say", { ts: 1, type: "say", say: "completion_result", text: ESCAPED }],
		[
			"newTask tool ask",
			{
				ts: 2,
				type: "ask",
				ask: "tool",
				text: JSON.stringify({ tool: "newTask", mode: "code", content: ESCAPED }),
			},
		],
	] as const)("shows a %s with real letters", (_name, message) => {
		const { container } = renderRow(message as ClineMessage)

		expect(container.textContent).toContain(DECODED)
		expect(container.textContent).not.toContain("\\u0142")
	})
})
