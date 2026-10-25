/**
 * The provider's own part of message handling, dispatched as real window
 * `message` events: the host posts it sends back and the skipped re-render
 * when a message changes nothing. The state each message produces is the
 * reducer's job (extensionStateReducer.spec.ts runs every row of the table).
 */
import { render, act } from "@/utils/test-utils"

import type { ExtensionMessage } from "@tumble-code/types"

import { vscode } from "@src/utils/vscode"

import {
	ExtensionStateContextProvider,
	useExtensionState,
	type ExtensionStateContextType,
} from "../ExtensionStateContext"
import { extensionMessageCases } from "./extensionMessageCases"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

let latest: ExtensionStateContextType | undefined
let renders = 0

const recordRender = (state: ExtensionStateContextType) => {
	latest = state
	renders++
}

const Probe = () => {
	recordRender(useExtensionState())
	return null
}

const dispatch = (message: ExtensionMessage) => {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data: message }))
	})
}

describe("ExtensionStateContext message table", () => {
	beforeEach(() => {
		latest = undefined
		renders = 0
		vi.mocked(vscode.postMessage).mockClear()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	const providerCases = extensionMessageCases.filter((c) => c.posts !== undefined || c.noChange)

	it.each(providerCases.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
		render(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)

		for (const seed of testCase.seed ?? []) {
			dispatch(seed)
		}

		const postsBefore = vi.mocked(vscode.postMessage).mock.calls.length
		const rendersBefore = renders
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

		dispatch(testCase.message)

		testCase.check(latest!)

		const posts = vi
			.mocked(vscode.postMessage)
			.mock.calls.slice(postsBefore)
			.map(([message]) => message)
		expect(posts).toEqual(testCase.posts ?? [])

		if (testCase.noChange) {
			expect(renders).toBe(rendersBefore)
		} else {
			expect(renders).toBeGreaterThan(rendersBefore)
		}

		if (testCase.warns !== undefined) {
			expect(warn).toHaveBeenCalledTimes(testCase.warns)
		}
	})

	it("covers every message type the provider handles", () => {
		const covered = new Set(extensionMessageCases.map((c) => c.message.type))
		expect([...covered].sort()).toEqual(
			[
				"action",
				"commands",
				"currentCheckpointUpdated",
				"listApiConfig",
				"marketplaceData",
				"mcpServers",
				"memoryActivity",
				"messageAdded",
				"messageUpdated",
				"runningTasksUpdated",
				"selectedImages",
				"skills",
				"state",
				"subagentsUpdated",
				"taskHistoryItemDeleted",
				"taskHistoryItemUpdated",
				"taskHistoryUpdated",
				"workspaceUpdated",
			].sort(),
		)
	})

	it("posts one host update per toggle when auto-approval is toggled twice", () => {
		render(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)

		dispatch({ type: "action", action: "toggleAutoApprove" })
		dispatch({ type: "action", action: "toggleAutoApprove" })

		expect(latest!.autoApprovalEnabled).toBe(false)
		expect(vi.mocked(vscode.postMessage).mock.calls.map(([m]) => m)).toEqual([
			// The launch declares that this view applies messageAdded (CORE-R7).
			{ type: "webviewDidLaunch", acceptsMessageAdded: true },
			{ type: "autoApprovalEnabled", bool: true },
			{ type: "autoApprovalEnabled", bool: false },
		])
	})
})
