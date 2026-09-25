// pnpm --filter @roo-code/vscode-webview test src/components/chat/__tests__/ChatView.ask-state-machine.spec.tsx

/**
 * WEB-8 characterization: ChatView's ask state machine and the host messages
 * it handles, pinned before ChatView is split into hooks.
 *
 * The last message decides `clineAsk`, `enableButtons`, the two button texts
 * and `sendingDisabled`. `clineAsk` is internal state, so the table pins it
 * through everything it controls: what the primary and the secondary button
 * post back to the host, whether typing pauses a follow-up auto-approval, and
 * whether the API-config picker stays locked (`selectApiConfigDisabled`).
 */

import React from "react"
import { render, act, fireEvent } from "@/utils/test-utils"

import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
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

interface TextAreaProps {
	inputValue: string
	setInputValue: (value: string) => void
	sendingDisabled: boolean
	selectApiConfigDisabled: boolean
	selectedImages: string[]
	isStreaming?: boolean
	onSend: () => void
}

interface TaskHeaderProps {
	aggregatedCost?: number
	hasSubtasks?: boolean
	buttonsDisabled: boolean
	handleCondenseContext: (taskId: string) => void
}

const harness = vi.hoisted(() => ({
	textArea: undefined as TextAreaProps | undefined,
	taskHeader: undefined as TaskHeaderProps | undefined,
	rows: [] as ClineMessage[],
	focus: vi.fn(),
	played: [] as string[],
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Every sound records which file it would play.
vi.mock("use-sound", () => ({
	default: vi.fn().mockImplementation((src: string) => [() => harness.played.push(src)]),
}))

vi.mock("../ChatRow", () => ({
	default: function MockChatRow({ message }: { message: ClineMessage }) {
		harness.rows.push(message)
		return <div data-testid="chat-row">{JSON.stringify(message)}</div>
	},
}))

vi.mock("../TaskHeader", () => ({
	default: function MockTaskHeader(props: TaskHeaderProps) {
		harness.taskHeader = props
		return <div data-testid="task-header" />
	},
}))

vi.mock("../CheckpointWarning", () => ({
	CheckpointWarning: ({ warning }: { warning: { type: string; timeout: number } }) => (
		<div data-testid="checkpoint-warning">{`${warning.type}:${warning.timeout}`}</div>
	),
}))

vi.mock("../ChatTextArea", () => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const mockReact = require("react")
	const MockChatTextArea = mockReact.forwardRef(function MockChatTextArea(
		props: TextAreaProps,
		ref: React.ForwardedRef<{ focus: () => void }>,
	) {
		harness.textArea = props
		mockReact.useImperativeHandle(ref, () => ({ focus: harness.focus }))
		return <div data-testid="chat-textarea" />
	})
	return { ChatTextArea: MockChatTextArea }
})

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
					<div key={item.ts}>{itemContent(index, item)}</div>
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

const postMessage = vscode.postMessage as ReturnType<typeof vi.fn>

// Dispatched synchronously (window.postMessage in jsdom delivers on a timer,
// after act() has returned), so the message lands inside the caller's act().
const fromHost = (data: Record<string, unknown>) => {
	window.dispatchEvent(new MessageEvent("message", { data }))
}

type ExtraState = Record<string, unknown>

const hydrate = (clineMessages: ClineMessage[], extra: ExtraState = {}) =>
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
			telemetrySetting: "enabled",
			...extra,
		},
	})

const defaultProps: ChatViewProps = {
	isHidden: false,
	showAnnouncement: false,
	hideAnnouncement: () => {},
}

const renderChatView = (props: Partial<ChatViewProps> = {}) =>
	render(
		<ExtensionStateContextProvider>
			<ChatView {...defaultProps} {...props} />
		</ExtensionStateContextProvider>,
	)

/** Mount ChatView and apply each state push in its own act(). */
const mount = async (steps: ClineMessage[][], extra: ExtraState = {}) => {
	const view = renderChatView()
	for (const messages of steps) {
		await act(async () => {
			hydrate(messages, extra)
		})
	}
	return view
}

/** Everything posted while `fn` runs, as compact strings. */
const postedDuring = async (fn: () => void) => {
	postMessage.mockClear()
	await act(async () => {
		fn()
	})
	return postMessage.mock.calls.map(([message]) => describePost(message))
}

const describePost = (message: Record<string, unknown>) => {
	switch (message.type) {
		case "askResponse":
			return `askResponse:${message.askResponse}`
		case "terminalOperation":
			return `terminalOperation:${message.terminalOperation}`
		default:
			return String(message.type)
	}
}

/** The two approval buttons are the only buttons ChatView itself renders here. */
const approvalButtons = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("button")).filter((button) => (button.textContent ?? "").startsWith("chat:"))

const readButtons = (container: HTMLElement) => {
	const buttons = approvalButtons(container)
	const primary = buttons.find((button) => button.className.includes("mr-")) ?? null
	const secondary = buttons.find((button) => button.className.includes("ml-[6px]")) ?? null
	return {
		primary: primary?.textContent ?? null,
		secondary: secondary?.textContent ?? null,
		// null when no button is on screen: enableButtons is not observable then.
		enabled: buttons.length === 0 ? null : buttons.every((button) => !(button as HTMLButtonElement).disabled),
	}
}

const TASK: ClineMessage = { type: "say", say: "task", ts: 1, text: "the task" }
// A finished request (cost present), so nothing counts as streaming by default.
const API_DONE: ClineMessage = { type: "say", say: "api_req_started", ts: 2, text: JSON.stringify({ cost: 0.01 }) }
const API_RUNNING: ClineMessage = { type: "say", say: "api_req_started", ts: 2, text: JSON.stringify({}) }

const ask = (kind: string, extra: Partial<ClineMessage> = {}): ClineMessage => ({
	type: "ask",
	ask: kind,
	ts: 3,
	text: "",
	partial: false,
	...extra,
})

const toolAsk = (tool: Record<string, unknown>, extra: Partial<ClineMessage> = {}) =>
	ask("tool", { text: JSON.stringify(tool), ...extra })

const withAsk = (last: ClineMessage) => [TASK, API_DONE, last]

interface Row {
	name: string
	steps: ClineMessage[][]
	state?: ExtraState
	expected: {
		primary: string | null
		secondary: string | null
		enabled: boolean | null
		sendingDisabled: boolean
		apiConfigLocked: boolean
		streaming: boolean
		onPrimary: string[]
		onSecondary: string[]
		typingPausesFollowUp: boolean
	}
}

const buttons = (
	primary: string | null,
	secondary: string | null,
	enabled: boolean | null,
): Pick<Row["expected"], "primary" | "secondary" | "enabled"> => ({ primary, secondary, enabled })

const idle = { sendingDisabled: false, apiConfigLocked: false, streaming: false, typingPausesFollowUp: false }
const partialAsk = { sendingDisabled: true, apiConfigLocked: true, streaming: true, typingPausesFollowUp: false }

const YES = ["askResponse:yesButtonClicked"]
const NO = ["askResponse:noButtonClicked"]
const NEW_TASK = ["clearTask"]
const CANCEL = ["cancelTask"]

const SAVE_REJECT = buttons("chat:save.title", "chat:reject.title", true)
const APPROVE_REJECT = buttons("chat:approve.title", "chat:reject.title", true)

const rows: Row[] = [
	{
		name: "api_req_failed",
		steps: [withAsk(ask("api_req_failed"))],
		expected: {
			...buttons("chat:retry.title", "chat:startNewTask.title", true),
			...idle,
			// The only ask that disables sending but keeps the API-config picker usable.
			sendingDisabled: true,
			onPrimary: YES,
			onSecondary: NEW_TASK,
		},
	},
	{
		name: "mistake_limit_reached",
		steps: [withAsk(ask("mistake_limit_reached"))],
		expected: {
			...buttons("chat:proceedAnyways.title", "chat:startNewTask.title", true),
			...idle,
			onPrimary: YES,
			onSecondary: NEW_TASK,
		},
	},
	{
		name: "followup",
		steps: [withAsk(ask("followup"))],
		expected: { ...buttons(null, null, null), ...idle, onPrimary: [], onSecondary: [], typingPausesFollowUp: true },
	},
	{
		name: "followup, partial",
		steps: [withAsk(ask("followup", { partial: true }))],
		expected: {
			...buttons(null, null, null),
			...partialAsk,
			onPrimary: [],
			onSecondary: CANCEL,
			typingPausesFollowUp: true,
		},
	},
	{
		name: "tool editedExistingFile",
		steps: [withAsk(toolAsk({ tool: "editedExistingFile", path: "a.ts" }))],
		expected: { ...SAVE_REJECT, ...idle, onPrimary: YES, onSecondary: NO },
	},
	{
		name: "tool appliedDiff with batchDiffs",
		steps: [withAsk(toolAsk({ tool: "appliedDiff", batchDiffs: [{ path: "a.ts" }] }))],
		expected: {
			...buttons("chat:edit-batch.approve.title", "chat:edit-batch.deny.title", true),
			...idle,
			onPrimary: YES,
			onSecondary: NO,
		},
	},
	{
		name: "tool newFileCreated",
		steps: [withAsk(toolAsk({ tool: "newFileCreated", path: "a.ts" }))],
		expected: { ...SAVE_REJECT, ...idle, onPrimary: YES, onSecondary: NO },
	},
	{
		name: "tool generateImage",
		steps: [withAsk(toolAsk({ tool: "generateImage", path: "a.png" }))],
		expected: { ...SAVE_REJECT, ...idle, onPrimary: YES, onSecondary: NO },
	},
	{
		name: "tool finishTask",
		steps: [withAsk(toolAsk({ tool: "finishTask" }))],
		expected: {
			...buttons("chat:completeSubtaskAndReturn", null, true),
			...idle,
			onPrimary: YES,
			onSecondary: NO,
		},
	},
	{
		name: "tool readFile",
		steps: [withAsk(toolAsk({ tool: "readFile", path: "a.ts" }))],
		expected: { ...APPROVE_REJECT, ...idle, onPrimary: YES, onSecondary: NO },
	},
	{
		name: "tool readFile with batchFiles",
		steps: [withAsk(toolAsk({ tool: "readFile", batchFiles: [{ path: "a.ts" }] }))],
		expected: {
			...buttons("chat:read-batch.approve.title", "chat:read-batch.deny.title", true),
			...idle,
			onPrimary: YES,
			onSecondary: NO,
		},
	},
	{
		name: "tool listFilesTopLevel",
		steps: [withAsk(toolAsk({ tool: "listFilesTopLevel", path: "src" }))],
		expected: { ...APPROVE_REJECT, ...idle, onPrimary: YES, onSecondary: NO },
	},
	{
		name: "tool listFilesRecursive with batchDirs",
		steps: [withAsk(toolAsk({ tool: "listFilesRecursive", batchDirs: [{ path: "src" }] }))],
		expected: {
			...buttons("chat:list-batch.approve.title", "chat:list-batch.deny.title", true),
			...idle,
			onPrimary: YES,
			onSecondary: NO,
		},
	},
	{
		name: "tool of any other kind (searchFiles)",
		steps: [withAsk(toolAsk({ tool: "searchFiles", path: "src", regex: "x" }))],
		expected: { ...APPROVE_REJECT, ...idle, onPrimary: YES, onSecondary: NO },
	},
	{
		name: "tool, partial",
		steps: [withAsk(toolAsk({ tool: "editedExistingFile", path: "a.ts" }, { partial: true }))],
		expected: {
			...buttons("chat:save.title", "chat:reject.title", false),
			...partialAsk,
			onPrimary: YES,
			onSecondary: CANCEL,
		},
	},
	{
		name: "command",
		steps: [withAsk(ask("command", { text: "echo hi" }))],
		expected: {
			...buttons("chat:runCommand.title", "chat:reject.title", true),
			...idle,
			onPrimary: YES,
			onSecondary: NO,
		},
	},
	{
		name: "command, partial",
		steps: [withAsk(ask("command", { text: "echo", partial: true }))],
		expected: {
			...buttons("chat:runCommand.title", "chat:reject.title", false),
			...partialAsk,
			onPrimary: YES,
			onSecondary: CANCEL,
		},
	},
	{
		name: "command_output",
		steps: [withAsk(ask("command_output"))],
		expected: {
			...buttons("chat:proceedWhileRunning.title", "chat:killCommand.title", true),
			...idle,
			onPrimary: ["terminalOperation:continue"],
			onSecondary: ["terminalOperation:abort"],
		},
	},
	{
		name: "use_mcp_server",
		steps: [withAsk(ask("use_mcp_server", { text: "{}" }))],
		expected: { ...APPROVE_REJECT, ...idle, onPrimary: YES, onSecondary: NO },
	},
	{
		name: "use_mcp_server, partial",
		steps: [withAsk(ask("use_mcp_server", { text: "{}", partial: true }))],
		expected: {
			...buttons("chat:approve.title", "chat:reject.title", false),
			...partialAsk,
			onPrimary: YES,
			onSecondary: CANCEL,
		},
	},
	{
		name: "completion_result",
		steps: [withAsk(ask("completion_result", { text: "done" }))],
		expected: {
			...buttons("chat:startNewTask.title", null, true),
			...idle,
			onPrimary: NEW_TASK,
			onSecondary: [],
		},
	},
	{
		name: "completion_result, partial",
		steps: [withAsk(ask("completion_result", { text: "do", partial: true }))],
		expected: {
			...buttons("chat:startNewTask.title", null, false),
			...partialAsk,
			onPrimary: NEW_TASK,
			onSecondary: CANCEL,
		},
	},
	{
		name: "resume_task",
		steps: [withAsk(ask("resume_task"))],
		expected: {
			...buttons("chat:resumeTask.title", "chat:terminate.title", true),
			...idle,
			onPrimary: YES,
			onSecondary: NEW_TASK,
		},
	},
	{
		name: "resume_task of a completed subtask",
		steps: [[TASK, { type: "say", say: "completion_result", ts: 2, text: "done" }, ask("resume_task")]],
		state: { currentTaskItem: { id: "child", parentTaskId: "parent", ts: 1, task: "t", number: 1 } },
		expected: {
			...buttons("chat:startNewTask.title", null, true),
			...idle,
			onPrimary: NEW_TASK,
			onSecondary: NEW_TASK,
		},
	},
	{
		name: "resume_task of a subtask whose completion_result arrives afterwards",
		steps: [
			[TASK, API_DONE, ask("resume_task")],
			[TASK, API_DONE, ask("resume_task"), { type: "say", say: "completion_result", ts: 4, text: "done" }],
		],
		state: { currentTaskItem: { id: "child", parentTaskId: "parent", ts: 1, task: "t", number: 1 } },
		expected: {
			...buttons("chat:startNewTask.title", null, true),
			...idle,
			onPrimary: NEW_TASK,
			onSecondary: NEW_TASK,
		},
	},
	{
		name: "resume_completed_task",
		steps: [withAsk(ask("resume_completed_task"))],
		expected: {
			...buttons("chat:startNewTask.title", null, true),
			...idle,
			onPrimary: NEW_TASK,
			onSecondary: [],
		},
	},
	{
		name: "an ask the machine does not handle (auto_approval_max_req_reached) after a running request",
		steps: [
			[TASK, API_RUNNING],
			[TASK, API_DONE, ask("auto_approval_max_req_reached")],
		],
		// The request's say disabled sending, and the unhandled ask leaves it so.
		expected: {
			...buttons(null, null, null),
			...idle,
			sendingDisabled: true,
			apiConfigLocked: true,
			onPrimary: [],
			onSecondary: [],
		},
	},
	{
		name: "an ask already answered by the host (isAnswered)",
		steps: [withAsk(toolAsk({ tool: "readFile", path: "a.ts" }, { isAnswered: true }))],
		expected: { ...buttons(null, null, null), ...idle, onPrimary: [], onSecondary: [] },
	},
	{
		name: "say api_req_started after an ask clears the buttons",
		steps: [
			withAsk(ask("command", { text: "echo hi" })),
			[TASK, API_DONE, ask("command"), { ...API_RUNNING, ts: 4 }],
		],
		expected: {
			...buttons(null, null, null),
			sendingDisabled: true,
			apiConfigLocked: true,
			streaming: true,
			typingPausesFollowUp: false,
			onPrimary: [],
			onSecondary: CANCEL,
		},
	},
	{
		name: "say api_req_retry_delayed after an ask only disables sending",
		steps: [
			withAsk(toolAsk({ tool: "readFile", path: "a.ts" })),
			[
				TASK,
				API_DONE,
				toolAsk({ tool: "readFile", path: "a.ts" }),
				{ type: "say", say: "api_req_retry_delayed", ts: 4 },
			],
		],
		expected: {
			...APPROVE_REJECT,
			...idle,
			sendingDisabled: true,
			apiConfigLocked: true,
			onPrimary: YES,
			onSecondary: NO,
		},
	},
	{
		name: "say api_req_rate_limit_wait after an ask only disables sending",
		steps: [
			withAsk(ask("command", { text: "echo hi" })),
			[TASK, API_DONE, ask("command"), { type: "say", say: "api_req_rate_limit_wait", ts: 4 }],
		],
		expected: {
			...buttons("chat:runCommand.title", "chat:reject.title", true),
			...idle,
			sendingDisabled: true,
			apiConfigLocked: true,
			onPrimary: YES,
			onSecondary: NO,
		},
	},
	{
		name: "say text after an ask keeps the ask",
		steps: [
			withAsk(toolAsk({ tool: "readFile", path: "a.ts" })),
			[
				TASK,
				API_DONE,
				toolAsk({ tool: "readFile", path: "a.ts" }),
				{ type: "say", say: "text", ts: 4, text: "hi" },
			],
		],
		expected: { ...APPROVE_REJECT, ...idle, onPrimary: YES, onSecondary: NO },
	},
	{
		name: "an empty message list after an ask resets everything",
		steps: [withAsk(ask("command", { text: "echo hi" })), []],
		expected: { ...buttons(null, null, null), ...idle, onPrimary: [], onSecondary: [] },
	},
]

const primaryInvoke = () => fromHost({ type: "invoke", invoke: "primaryButtonClick" })
const secondaryInvoke = () => fromHost({ type: "invoke", invoke: "secondaryButtonClick" })

describe("ChatView ask state machine", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		harness.textArea = undefined
		harness.taskHeader = undefined
		harness.rows = []
		harness.played = []
	})

	it.each(rows)("$name", async ({ steps, state, expected }) => {
		// First mount: the visible state, the follow-up typing probe, then the primary action.
		const first = await mount(steps, state)
		const textArea = harness.textArea!
		const observed = {
			...readButtons(first.container),
			sendingDisabled: textArea.sendingDisabled,
			apiConfigLocked: textArea.selectApiConfigDisabled,
			streaming: textArea.isStreaming === true,
		}
		const typing = await postedDuring(() => harness.textArea!.setInputValue("typed"))
		await act(async () => harness.textArea!.setInputValue(""))
		const onPrimary = await postedDuring(primaryInvoke)
		first.unmount()

		// Second mount: the secondary action on the same state.
		const second = await mount(steps, state)
		const onSecondary = await postedDuring(secondaryInvoke)
		second.unmount()

		expect({
			...observed,
			onPrimary,
			onSecondary,
			typingPausesFollowUp: typing.includes("cancelAutoApproval"),
		}).toEqual(expected)
	})
})

describe("ChatView host messages", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		harness.textArea = undefined
		harness.taskHeader = undefined
		harness.rows = []
		harness.played = []
	})

	const type = async (text: string) => act(async () => harness.textArea!.setInputValue(text))

	it("invoke newChat empties the input and the images and disables sending", async () => {
		await mount([withAsk(ask("followup"))])
		await type("draft")
		await act(async () => fromHost({ type: "selectedImages", images: ["data:image/png;base64,a"] }))
		expect(harness.textArea!.selectedImages).toEqual(["data:image/png;base64,a"])

		const posted = await postedDuring(() => fromHost({ type: "invoke", invoke: "newChat" }))

		expect(posted).toEqual([])
		expect(harness.textArea!.inputValue).toBe("")
		expect(harness.textArea!.selectedImages).toEqual([])
		expect(harness.textArea!.sendingDisabled).toBe(true)
	})

	it("invoke sendMessage without a task starts a new task", async () => {
		await mount([])

		postMessage.mockClear()
		await act(async () =>
			fromHost({ type: "invoke", invoke: "sendMessage", text: "  build it  ", images: ["img"] }),
		)

		expect(postMessage).toHaveBeenCalledWith({ type: "newTask", text: "build it", images: ["img"] })
	})

	it("invoke sendMessage answers a pending follow-up", async () => {
		await mount([withAsk(ask("followup"))])

		postMessage.mockClear()
		await act(async () => fromHost({ type: "invoke", invoke: "sendMessage", text: "yes" }))

		expect(postMessage).toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "messageResponse",
			text: "yes",
			images: [],
		})
		expect(harness.textArea!.sendingDisabled).toBe(true)
	})

	it("invoke sendMessage while sending is disabled queues the message", async () => {
		await mount([[TASK, API_RUNNING]])

		postMessage.mockClear()
		await act(async () => fromHost({ type: "invoke", invoke: "sendMessage", text: "later" }))

		expect(postMessage).toHaveBeenCalledWith({ type: "queueMessage", text: "later", images: [] })
	})

	it("invoke setChatBoxMessage appends to the typed text and the images", async () => {
		await mount([withAsk(ask("followup"))])
		await type("first")
		await act(async () => fromHost({ type: "selectedImages", images: ["a"] }))

		await act(async () => fromHost({ type: "invoke", invoke: "setChatBoxMessage", text: "second", images: ["b"] }))

		expect(harness.textArea!.inputValue).toBe("first second")
		expect(harness.textArea!.selectedImages).toEqual(["a", "b"])
	})

	it("invoke primaryButtonClick sends the trimmed text and images and clears the input", async () => {
		await mount([withAsk(toolAsk({ tool: "readFile", path: "a.ts" }))])
		await type("keep going")

		postMessage.mockClear()
		await act(async () =>
			fromHost({ type: "invoke", invoke: "primaryButtonClick", text: "  note  ", images: ["img"] }),
		)

		expect(postMessage).toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "yesButtonClicked",
			text: "note",
			images: ["img"],
		})
		expect(harness.textArea!.inputValue).toBe("")
		expect(harness.textArea!.sendingDisabled).toBe(true)
	})

	it("invoke secondaryButtonClick sends the trimmed text and images as a rejection", async () => {
		await mount([withAsk(ask("command", { text: "rm -rf" }))])

		postMessage.mockClear()
		await act(async () =>
			fromHost({ type: "invoke", invoke: "secondaryButtonClick", text: " why ", images: ["img"] }),
		)

		expect(postMessage).toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "noButtonClicked",
			text: "why",
			images: ["img"],
		})
		expect(approvalButtons(document.body)).toEqual([])
	})

	it("clicking the rendered buttons sends the typed text and images", async () => {
		const { container } = await mount([withAsk(ask("command", { text: "ls" }))])
		await type("  careful ")
		await act(async () => fromHost({ type: "selectedImages", images: ["img"] }))

		postMessage.mockClear()
		await act(async () => {
			fireEvent.click(readButtonElement(container, "chat:runCommand.title"))
		})

		expect(postMessage).toHaveBeenCalledWith({
			type: "askResponse",
			askResponse: "yesButtonClicked",
			text: "careful",
			images: ["img"],
		})
		expect(harness.textArea!.selectedImages).toEqual([])
	})

	it("action focusInput always focuses the text area", async () => {
		await mount([withAsk(ask("command", { text: "ls" }))])
		harness.focus.mockClear()

		await act(async () => fromHost({ type: "action", action: "focusInput" }))

		expect(harness.focus).toHaveBeenCalledTimes(1)
	})

	it("action didBecomeVisible focuses only when the user could type", async () => {
		await mount([withAsk(ask("command", { text: "ls" }))])
		harness.focus.mockClear()
		await act(async () => fromHost({ type: "action", action: "didBecomeVisible" }))
		// Buttons are enabled: the user is meant to decide, not type.
		expect(harness.focus).not.toHaveBeenCalled()

		await act(async () => hydrate([]))
		harness.focus.mockClear()
		await act(async () => fromHost({ type: "action", action: "didBecomeVisible" }))
		expect(harness.focus).toHaveBeenCalledTimes(1)
	})

	it("selectedImages appends up to the limit and ignores images for an edit", async () => {
		await mount([withAsk(ask("followup"))])

		await act(async () => fromHost({ type: "selectedImages", images: ["a", "b"] }))
		await act(async () => fromHost({ type: "selectedImages", images: ["c"], context: "edit" }))
		expect(harness.textArea!.selectedImages).toEqual(["a", "b"])

		const many = Array.from({ length: 25 }, (_, index) => `img${index}`)
		await act(async () => fromHost({ type: "selectedImages", images: many }))
		expect(harness.textArea!.selectedImages).toHaveLength(20)
		expect(harness.textArea!.selectedImages.slice(0, 3)).toEqual(["a", "b", "img0"])
	})

	it("condenseTaskContextStarted adds the condensing row and the response removes it", async () => {
		await mount([withAsk(ask("followup"))])
		const condensingRows = () => harness.rows.filter((row) => row.say === "condense_context")

		harness.rows = []
		await act(async () => fromHost({ type: "condenseTaskContextStarted", text: "task-1" }))
		expect(condensingRows().length).toBeGreaterThan(0)
		// An automatic condense does not disable sending.
		expect(harness.textArea!.sendingDisabled).toBe(false)

		await act(async () => fromHost({ type: "condenseTaskContextResponse", text: "task-1" }))
		harness.rows = []
		await act(async () => fromHost({ type: "selectedImages", images: [] }))
		expect(condensingRows()).toEqual([])
	})

	it("a manual condense disables sending until the response", async () => {
		await mount([withAsk(ask("followup"))])

		postMessage.mockClear()
		await act(async () => harness.taskHeader!.handleCondenseContext("task-1"))
		expect(postMessage).toHaveBeenCalledWith({ type: "condenseTaskContextRequest", text: "task-1" })
		expect(harness.textArea!.sendingDisabled).toBe(true)

		// A second request while condensing is ignored.
		postMessage.mockClear()
		await act(async () => harness.taskHeader!.handleCondenseContext("task-1"))
		expect(postMessage).not.toHaveBeenCalled()

		await act(async () => fromHost({ type: "condenseTaskContextResponse", text: "task-1" }))
		expect(harness.textArea!.sendingDisabled).toBe(false)
	})

	it("condense messages without text are ignored", async () => {
		await mount([withAsk(ask("followup"))])

		harness.rows = []
		await act(async () => fromHost({ type: "condenseTaskContextStarted" }))
		expect(harness.rows.filter((row) => row.say === "condense_context")).toEqual([])
	})

	it("checkpointInitWarning shows the warning", async () => {
		const { findByTestId } = await mount([withAsk(ask("followup"))])

		await act(async () =>
			fromHost({ type: "checkpointInitWarning", checkpointWarning: { type: "WAIT_TIMEOUT", timeout: 5 } }),
		)

		expect((await findByTestId("checkpoint-warning")).textContent).toBe("WAIT_TIMEOUT:5")
	})

	it("interactionRequired plays the notification sound", async () => {
		await mount([withAsk(ask("followup"))], { soundEnabled: true })
		harness.played = []

		await act(async () => fromHost({ type: "interactionRequired" }))

		expect(harness.played).toEqual(["/notification.wav"])
	})

	it("interactionRequired stays silent when sounds are off", async () => {
		await mount([withAsk(ask("followup"))], { soundEnabled: false })
		harness.played = []

		await act(async () => fromHost({ type: "interactionRequired" }))

		expect(harness.played).toEqual([])
	})

	it("taskWithAggregatedCosts feeds the header of the matching task", async () => {
		const currentTaskItem = { id: "parent", ts: 1, task: "t", number: 1, childIds: ["child"] }
		await mount([withAsk(ask("followup"))], { currentTaskItem })

		await act(async () =>
			fromHost({
				type: "taskWithAggregatedCosts",
				text: "other",
				aggregatedCosts: { totalCost: 9, ownCost: 9, childrenCost: 0 },
			}),
		)
		expect(harness.taskHeader!.aggregatedCost).toBeUndefined()

		await act(async () =>
			fromHost({
				type: "taskWithAggregatedCosts",
				text: "parent",
				aggregatedCosts: { totalCost: 3, ownCost: 1, childrenCost: 2 },
			}),
		)
		expect(harness.taskHeader!.aggregatedCost).toBe(3)
		expect(harness.taskHeader!.hasSubtasks).toBe(true)
	})

	it("asks the host for aggregated costs when the task has children", async () => {
		const currentTaskItem = { id: "parent", ts: 1, task: "t", number: 1, childIds: ["child"] }
		await mount([withAsk(ask("followup"))], { currentTaskItem })

		expect(postMessage).toHaveBeenCalledWith({ type: "getTaskWithAggregatedCosts", text: "parent" })
	})
})

const readButtonElement = (container: HTMLElement, label: string) => {
	const button = approvalButtons(container).find((candidate) => candidate.textContent === label)
	if (!button) {
		throw new Error(`no button "${label}"`)
	}
	return button
}
