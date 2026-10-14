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

describe("ChatRow - escaped letters in stored messages", () => {
	it("shows a completion_result say with real letters", () => {
		const { container } = renderRow({ ts: 1, type: "say", say: "completion_result", text: ESCAPED })

		expect(container.textContent).toContain(DECODED)
		expect(container.textContent).not.toContain("\\u0142")
	})

	it("shows a completion_result ask with real letters", () => {
		const { container } = renderRow({ ts: 2, type: "ask", ask: "completion_result", text: ESCAPED })

		expect(container.textContent).toContain(DECODED)
	})

	it("keeps an escape inside a code span as written", () => {
		const { container } = renderRow({
			ts: 3,
			type: "say",
			say: "completion_result",
			text: "Litera `\\u0142` to Dok\\u0142adnie ł",
		})

		expect(container.querySelector("code")?.textContent).toBe("\\u0142")
		expect(container.textContent).toContain("Dokładnie ł")
	})

	it("shows a follow-up question and its suggestions with real letters", () => {
		const { container } = renderRow({
			ts: 4,
			type: "ask",
			ask: "followup",
			text: JSON.stringify({
				question: "Kt\\u00f3ry wariant?",
				suggest: [{ answer: "Pierwszy, bo kr\\u00f3tszy" }, { answer: "Drugi", mode: "architect" }],
			}),
		})

		expect(container.textContent).toContain("Który wariant?")
		expect(container.textContent).toContain("Pierwszy, bo krótszy")
		expect(container.textContent).not.toContain("\\u00f3")
	})

	it("shows a new subtask's instructions with real letters", () => {
		const { container } = renderRow({
			ts: 5,
			type: "ask",
			ask: "tool",
			text: JSON.stringify({ tool: "newTask", mode: "code", content: ESCAPED }),
		})

		expect(container.textContent).toContain(DECODED)
	})

	it("leaves a command row as written", () => {
		const { container } = renderRow({ ts: 6, type: "ask", ask: "command", text: "printf 'Dok\\u0142adnie'" })

		expect(container.textContent).toContain("Dok\\u0142adnie")
	})
})
