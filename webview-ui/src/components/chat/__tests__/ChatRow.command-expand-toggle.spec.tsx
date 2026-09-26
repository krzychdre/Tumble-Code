// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatRow.command-expand-toggle.spec.tsx

import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"
import { describe, it, expect, beforeEach, vi } from "vitest"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"

import { ChatRowContent } from "../ChatRow"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: "en", changeLanguage: () => {}, t: (key: string) => key },
	}),
	Trans: ({ i18nKey, children }: { i18nKey: string; children?: React.ReactNode }) => <>{children || i18nKey}</>,
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
}))

// CommandExecution labels the chevron through i18next's bare `t`, which is not
// initialised under vitest and would return undefined. The default export has
// to survive too: ExtensionStateContextProvider pulls in src/i18n/setup.ts,
// which calls i18next.use(...).init(...) at import time.
vi.mock("i18next", () => ({
	t: (key: string) => key,
	default: {
		use: () => ({ init: () => {} }),
		init: () => {},
		addResourceBundle: () => {},
		changeLanguage: () => {},
		language: "en",
		t: (key: string) => key,
	},
}))

vi.mock("@src/components/common/CodeBlock", () => ({
	default: ({ source }: { source: string }) => <div data-testid="code-block">{source}</div>,
}))

const onToggleExpand = vi.fn()

const commandMessage = {
	type: "ask" as const,
	ask: "command" as const,
	ts: 1234,
	text: "echo hi",
	partial: false,
}

const renderCommandRow = (isExpanded: boolean) =>
	render(
		<ExtensionStateContextProvider>
			<ChatRowContent
				message={commandMessage as any}
				isExpanded={isExpanded}
				isLast={true}
				isStreaming={false}
				onToggleExpand={onToggleExpand}
			/>
		</ExtensionStateContextProvider>,
	)

describe("ChatRow - command row expand toggle", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("asks the parent to open a collapsed row", () => {
		renderCommandRow(false)

		fireEvent.click(screen.getByRole("button", { name: "chat:commandExecution.expandCommand" }))

		expect(onToggleExpand).toHaveBeenCalledWith(commandMessage.ts, true)
	})

	it("asks the parent to close an expanded row", () => {
		renderCommandRow(true)

		// The target state comes from what is displayed. A row that opens by
		// default has no entry in the parent's map, so flipping the stored value
		// instead would compute !undefined === true and keep the row open.
		fireEvent.click(screen.getByRole("button", { name: "chat:commandExecution.collapseCommand" }))

		expect(onToggleExpand).toHaveBeenCalledWith(commandMessage.ts, false)
	})
})
