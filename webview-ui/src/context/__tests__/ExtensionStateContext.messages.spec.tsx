/**
 * Table test: every extension message type ExtensionStateContextProvider
 * handles, dispatched as a real window `message` event. The rows live in
 * `extensionMessageCases.ts` so the pure reducer tests can reuse them.
 */
import { render, act } from "@/utils/test-utils"

import type { ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

import { ExtensionStateContextProvider, useExtensionState, type ExtensionStateContextType } from "../ExtensionStateContext"
import { extensionMessageCases } from "./extensionMessageCases"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

let latest: ExtensionStateContextType | undefined
let renders = 0

const Probe = () => {
	latest = useExtensionState()
	renders++
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

	it.each(extensionMessageCases.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
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

		const posts = vi.mocked(vscode.postMessage).mock.calls.slice(postsBefore).map(([message]) => message)
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
				"messageUpdated",
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
			{ type: "webviewDidLaunch" },
			{ type: "autoApprovalEnabled", bool: true },
			{ type: "autoApprovalEnabled", bool: false },
		])
	})
})
