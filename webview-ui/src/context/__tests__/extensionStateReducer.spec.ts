/**
 * Unit tests for the pure reducer, driven by the same table as the provider
 * test (`ExtensionStateContext.messages.spec.tsx`): the reducer alone must
 * produce the state the provider exposes, without posting to the host and
 * without mutating its input.
 */
import type { ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

import {
	applyExtensionMessage,
	createInitialExtensionStore,
	flattenExtensionStore,
	updateExtensionState,
	type ExtensionStore,
} from "../extensionStateReducer"
import { extensionMessageCases, makeClineMessage } from "./extensionMessageCases"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

const deepFreeze = <T>(value: T): T => {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value)
		for (const key of Object.keys(value)) {
			deepFreeze((value as Record<string, unknown>)[key])
		}
	}
	return value
}

const applyAll = (messages: ExtensionMessage[], start = createInitialExtensionStore()): ExtensionStore =>
	messages.reduce(applyExtensionMessage, start)

describe("applyExtensionMessage", () => {
	beforeEach(() => {
		vi.mocked(vscode.postMessage).mockClear()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it.each(extensionMessageCases.map((c) => [c.name, c] as const))("%s", (_name, testCase) => {
		const prev = deepFreeze(applyAll(testCase.seed ?? []))
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

		// A frozen input makes any in-place mutation throw (modules run in strict mode).
		const next = applyExtensionMessage(prev, testCase.message)

		testCase.check(flattenExtensionStore(next))

		if (testCase.noChange) {
			expect(next).toBe(prev)
		} else {
			expect(next).not.toBe(prev)
		}

		if (testCase.warns !== undefined) {
			expect(warn).toHaveBeenCalledTimes(testCase.warns)
		}

		// Host posts are the provider's job, never the reducer's.
		expect(vscode.postMessage).not.toHaveBeenCalled()
	})

	it("returns the same result for the same input (no hidden state)", () => {
		const seed = createInitialExtensionStore()
		const message: ExtensionMessage = { type: "action", action: "toggleAutoApprove" }

		expect(applyExtensionMessage(seed, message)).toEqual(applyExtensionMessage(seed, message))
		expect(applyExtensionMessage(seed, message).extensionState.autoApprovalEnabled).toBe(true)
		expect(seed.extensionState.autoApprovalEnabled).toBe(false)
	})

	it("keeps the slices that did not change by reference", () => {
		const prev = applyAll([
			{ type: "state", state: { clineMessages: [makeClineMessage(1, "one")] } },
			{ type: "commands", commands: [{ name: "deploy", source: "project" }] },
		])

		const next = applyExtensionMessage(prev, { type: "messageUpdated", clineMessage: makeClineMessage(1, "edited") })

		expect(next.commands).toBe(prev.commands)
		expect(next.extensionState.taskHistory).toBe(prev.extensionState.taskHistory)
		expect(next.extensionState.clineMessages).not.toBe(prev.extensionState.clineMessages)
	})
})

describe("updateExtensionState", () => {
	it("returns the previous store when the update returns the same state", () => {
		const prev = createInitialExtensionStore()
		expect(updateExtensionState(prev, (state) => state)).toBe(prev)
	})

	it("returns a new store with the updated state otherwise", () => {
		const prev = createInitialExtensionStore()
		const next = updateExtensionState(prev, (state) => ({ ...state, mode: "architect" }))

		expect(next).not.toBe(prev)
		expect(next.extensionState.mode).toBe("architect")
		expect(next.filePaths).toBe(prev.filePaths)
	})
})

describe("flattenExtensionStore", () => {
	it("lets the slices win over same-named keys of the host state", () => {
		const store = applyAll([
			{ type: "mcpServers", mcpServers: [] },
			{ type: "state", state: { mcpServers: [{ name: "from-state" } as never] } },
		])

		expect(store.extensionState.mcpServers).toHaveLength(1)
		expect(flattenExtensionStore(store).mcpServers).toEqual([])
	})
})
