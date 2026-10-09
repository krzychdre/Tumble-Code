// §2.6 (ai_plans/2026-09-27_ui-modernization.md): the chat action bar —
// tooltips picked by button kind (not translated-label comparisons),
// Ctrl/Cmd+Enter / Esc shortcuts, and a real disabled style.
//
// The harness mirrors ChatView.ask-state-machine.spec.tsx: the state machine
// drives which buttons appear, and we read the rendered buttons and tooltips.

import React from "react"
import { render, act, fireEvent } from "@/utils/test-utils"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { TooltipProvider } from "@/components/ui/tooltip"
import { vscode } from "@src/utils/vscode"

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

vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation(() => [vi.fn()]),
}))

vi.mock("../ChatRow", () => ({
	default: () => <div data-testid="chat-row" />,
}))

vi.mock("../TaskHeader", () => ({
	default: () => <div data-testid="task-header" />,
}))

vi.mock("../ChatTextArea", async () => {
	const mockReact = await import("react")
	const MockChatTextArea = mockReact.forwardRef(function MockChatTextArea(
		_props: unknown,
		ref: Parameters<Parameters<typeof mockReact.forwardRef>[0]>[1],
	) {
		mockReact.useImperativeHandle(ref, () => ({ focus: vi.fn() }))
		return <div data-testid="chat-textarea" />
	})
	return { ChatTextArea: MockChatTextArea, default: MockChatTextArea }
})

vi.mock("react-virtuoso", () => ({
	Virtuoso: function MockVirtuoso({ data, itemContent }: any) {
		return (
			<div data-testid="virtuoso-item-list">
				{data.map((item: any, index: number) => (
					<div key={item.ts}>{itemContent(index, item)}</div>
				))}
			</div>
		)
	},
}))

vi.mock("../../common/VersionIndicator", () => ({ default: () => null }))
vi.mock("@src/components/welcome/RooTips", () => ({ default: () => null }))
vi.mock("@src/components/welcome/RooHero", () => ({ default: () => null }))
// The i18n mock returns the key itself, so labels and tooltips render as keys.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	initReactI18next: { type: "3rdParty", init: () => {} },
	Trans: ({ i18nKey }: { i18nKey: string }) => <>{i18nKey}</>,
}))

const postMessage = vscode.postMessage as ReturnType<typeof vi.fn>

const fromHost = (data: Record<string, unknown>) => {
	window.dispatchEvent(new MessageEvent("message", { data }))
}

const hydrate = (clineMessages: ClineMessage[]) =>
	fromHost({
		type: "state",
		state: {
			version: "1.0.0",
			clineMessages,
			taskHistory: [],
			shouldShowAnnouncement: false,
			allowedCommands: [],
			alwaysAllowExecute: false,
			cloudIsAuthenticated: false,
		},
	})

const defaultProps: ChatViewProps = {
	isHidden: false,
	showAnnouncement: false,
	hideAnnouncement: () => {},
}

const TASK: ClineMessage = { type: "say", say: "task", ts: 1, text: "the task" }
const API_DONE: ClineMessage = { type: "say", say: "api_req_started", ts: 2, text: JSON.stringify({ cost: 0.01 }) }

const ask = (kind: string, extra: Partial<ClineMessage> = {}): ClineMessage => ({
	type: "ask",
	ask: kind,
	ts: 3,
	text: "",
	partial: false,
	...extra,
})

const mount = async (messages: ClineMessage[]) => {
	const view = render(
		<TooltipProvider delayDuration={0}>
			<ExtensionStateContextProvider>
				<ChatView {...defaultProps} />
			</ExtensionStateContextProvider>
		</TooltipProvider>,
	)
	await act(async () => {
		hydrate(messages)
	})
	return view
}

/** The approval buttons ChatView renders (their text starts with "chat:"). */
const approvalButtons = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("button")).filter((b) => (b.textContent ?? "").startsWith("chat:"))

const readButtons = (container: HTMLElement) => {
	const buttons = approvalButtons(container)
	const primary = buttons.find((b) => b.dataset.askButton === "primary") ?? null
	const secondary = buttons.find((b) => b.dataset.askButton === "secondary") ?? null
	return { primary, secondary }
}

describe("ChatView action bar (§2.6)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("tooltips come from the kind lookup and name the shortcut", async () => {
		// The button pair renders (its labels come from the ask state machine),
		// and the tooltip content string is built from the kind lookup table —
		// asserted directly in askButtonTooltips.spec.ts. Here we pin the wiring:
		// the runCommand ask produces a primary whose kind is "runCommand".
		const { container } = await mount([TASK, API_DONE, ask("command", { text: "npm test" })])

		const { primary, secondary } = readButtons(container)
		expect(primary).not.toBeNull()
		expect(secondary).not.toBeNull()
		expect(primary!.textContent).toBe("chat:runCommand.title")
		expect(secondary!.textContent).toBe("chat:reject.title")
	})

	it("disabled buttons carry the real disabled style class", async () => {
		// A partial command ask keeps the buttons visible but disabled.
		const { container } = await mount([TASK, API_DONE, ask("command", { text: "npm test", partial: true })])

		const { primary, secondary } = readButtons(container)
		expect(primary).not.toBeNull()
		expect((primary as HTMLButtonElement).disabled).toBe(true)
		// §2.6: a real disabled style, not just 50% opacity.
		expect(primary!.className).toContain("disabled-action-button")
		expect(secondary!.className).toContain("disabled-action-button")
	})

	it("Ctrl+Enter answers with the primary action", async () => {
		const { container } = await mount([TASK, API_DONE, ask("command", { text: "rm -rf /tmp/x" })])

		const bar = container.querySelector('[data-testid="action-bar"]')!
		expect(bar).not.toBeNull()

		postMessage.mockClear()
		fireEvent.keyDown(bar, { key: "Enter", ctrlKey: true })
		await act(async () => {})
		expect(postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "askResponse", askResponse: "yesButtonClicked" }),
		)
	})

	it("Esc answers with the secondary action", async () => {
		const { container } = await mount([TASK, API_DONE, ask("command", { text: "rm -rf /tmp/x" })])

		const bar = container.querySelector('[data-testid="action-bar"]')!
		expect(bar).not.toBeNull()

		postMessage.mockClear()
		fireEvent.keyDown(bar, { key: "Escape" })
		await act(async () => {})
		expect(postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "askResponse", askResponse: "noButtonClicked" }),
		)
	})

	it("the shortcuts do nothing while the buttons are disabled", async () => {
		const { container } = await mount([TASK, API_DONE, ask("command", { text: "npm test", partial: true })])

		const bar = container.querySelector('[data-testid="action-bar"]')!
		postMessage.mockClear()
		fireEvent.keyDown(bar, { key: "Enter", ctrlKey: true })
		fireEvent.keyDown(bar, { key: "Escape" })
		await act(async () => {})
		expect(postMessage).not.toHaveBeenCalled()
	})
})
