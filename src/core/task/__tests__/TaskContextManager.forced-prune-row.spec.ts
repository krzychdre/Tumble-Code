// cd src && npx vitest run core/task/__tests__/TaskContextManager.forced-prune-row.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"

import type { ClineMessage } from "@roo-code/types"

import type { ApiMessage } from "../../task-persistence/apiMessages"
import { MessageManager } from "../../message-manager"
import { TaskContextManager, type TaskContextManagerAccess } from "../TaskContextManager"

/**
 * The forced path: the provider already rejected the request because the context
 * window was exceeded, so `handleContextWindowExceededError` runs `manageContext`
 * at an aggressive reduction target and persists whatever comes back.
 *
 * That makes it the LIKELIEST place for a real prune-only round, and the place
 * where staying silent hurts most: the stored transcript is rewritten (old tool
 * output moves into a task artifact) while the user is already looking at an
 * error. Every outcome of this method must therefore announce itself, and these
 * tests pin all three announcement branches, not just the prune one.
 *
 * Same approach as TaskContextManager.prune-row.spec.ts: drive the real method
 * against a stubbed `manageContext`, which is the only way to pin the row
 * without standing up a whole Task.
 */

const manageContextMock = vi.hoisted(() => vi.fn())
const willManageContextMock = vi.hoisted(() => vi.fn().mockReturnValue(true))

vi.mock("../../context-management", () => ({
	manageContext: manageContextMock,
	willManageContext: willManageContextMock,
}))

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

const rewrittenHistory: ApiMessage[] = [{ role: "user", content: "rewritten history", ts: 1 }]

function buildAccess() {
	const say = vi.fn().mockResolvedValue(undefined)
	const overwriteApiConversationHistory = vi.fn().mockResolvedValue(undefined)
	const apiHandler = {
		getModel: () => ({ id: "m", info: { contextWindow: 100_000 } }),
		countTokens: async () => 0,
	}

	const access = {
		taskId: "forced-prune-row-task",
		apiConfiguration: {},
		api: apiHandler,
		getCondenseApiHandler: vi.fn().mockResolvedValue(apiHandler),
		apiConversationHistory: [{ role: "user", content: "original history", ts: 1 }],
		consecutiveAutoCompactFailures: 0,
		microcompactedToolUseIds: new Set<string>(),
		microcompactStrippedTokens: 0,
		cwd: "/workspace",
		fileContextTracker: { getFilesReadByRoo: vi.fn().mockResolvedValue([]) },
		// No provider: the spinner messages and the tool metadata build are both
		// optional-chained on it, which keeps this test to the row under test.
		getTaskMode: vi.fn().mockResolvedValue("code"),
		providerRef: { deref: () => undefined },
		history: { overwriteApiConversationHistory },
		askSay: { say },
		getArtifactStore: vi.fn().mockResolvedValue(undefined),
		getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 120_000 }),
		getSystemPrompt: vi.fn().mockResolvedValue("system"),
		emit: vi.fn(),
		processQueuedMessages: vi.fn(),
	} as unknown as TaskContextManagerAccess

	return { access, say, overwriteApiConversationHistory }
}

describe("forced truncation announces what it did", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		willManageContextMock.mockReturnValue(true)
	})

	it("emits a context_pruned row when pruning alone relieved the pressure", async () => {
		manageContextMock.mockResolvedValue({
			messages: rewrittenHistory,
			summary: "",
			cost: 0,
			prevContextTokens: 120_000,
			newContextTokens: 61_000,
			prunedCount: 4,
			prunedBytesSaved: 512_000,
			summarySkipped: true,
		})

		const { access, say, overwriteApiConversationHistory } = buildAccess()
		await new TaskContextManager(access).handleContextWindowExceededError()

		// The destructive rewrite is persisted...
		expect(overwriteApiConversationHistory).toHaveBeenCalledWith(rewrittenHistory)

		// ...and it is not silent.
		const pruneRow = say.mock.calls.find((call) => call[0] === "context_pruned")
		expect(pruneRow).toBeDefined()
		expect(pruneRow![9]).toEqual({
			prunedCount: 4,
			bytesSaved: 512_000,
			prevContextTokens: 120_000,
			newContextTokens: 61_000,
		})
		// Non-interactive: it must never consume a pending ask.
		expect(pruneRow![6]).toEqual({ isNonInteractive: true })

		// The prune row is the ONLY context row: nothing was condensed or truncated.
		expect(say.mock.calls.some((call) => call[0] === "condense_context")).toBe(false)
		expect(say.mock.calls.some((call) => call[0] === "sliding_window_truncation")).toBe(false)
	})

	it("emits a condense_context row when the round condensed, and no prune row", async () => {
		manageContextMock.mockResolvedValue({
			messages: rewrittenHistory,
			summary: "a summary",
			cost: 0.02,
			prevContextTokens: 120_000,
			newContextTokens: 30_000,
			condenseId: "forced-condense-1",
			prunedCount: 2,
			prunedBytesSaved: 100_000,
			summarySkipped: false,
		})

		const { access, say, overwriteApiConversationHistory } = buildAccess()
		await new TaskContextManager(access).handleContextWindowExceededError()

		expect(overwriteApiConversationHistory).toHaveBeenCalledWith(rewrittenHistory)

		const condenseRow = say.mock.calls.find((call) => call[0] === "condense_context")
		expect(condenseRow).toBeDefined()
		// `condenseId` is the only link between this row and the Summary message the
		// condense wrote into the API history; rewind needs it (see the round trip below).
		expect(condenseRow![7]).toEqual({
			summary: "a summary",
			cost: 0.02,
			newContextTokens: 30_000,
			prevContextTokens: 120_000,
			condenseId: "forced-condense-1",
		})
		// The condense row already tells the story of the whole round.
		expect(say.mock.calls.some((call) => call[0] === "context_pruned")).toBe(false)
	})

	it("emits a sliding_window_truncation row when the round truncated, and no prune row", async () => {
		manageContextMock.mockResolvedValue({
			messages: rewrittenHistory,
			summary: "",
			cost: 0,
			prevContextTokens: 120_000,
			newContextTokens: 80_000,
			newContextTokensAfterTruncation: 80_000,
			truncationId: "trunc-1",
			messagesRemoved: 6,
			prunedCount: 2,
			prunedBytesSaved: 100_000,
			summarySkipped: false,
		})

		const { access, say, overwriteApiConversationHistory } = buildAccess()
		await new TaskContextManager(access).handleContextWindowExceededError()

		expect(overwriteApiConversationHistory).toHaveBeenCalledWith(rewrittenHistory)

		const truncationRow = say.mock.calls.find((call) => call[0] === "sliding_window_truncation")
		expect(truncationRow).toBeDefined()
		expect(truncationRow![8]).toEqual({
			truncationId: "trunc-1",
			messagesRemoved: 6,
			prevContextTokens: 120_000,
			newContextTokens: 80_000,
		})
		expect(say.mock.calls.some((call) => call[0] === "context_pruned")).toBe(false)
	})
})

describe("forced condense row survives a rewind round trip", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		willManageContextMock.mockReturnValue(true)
	})

	it("a rewind across the forced condense row removes its Summary and restores the hidden history", async () => {
		// The history as summarizeConversation leaves it: the prefix is tagged with
		// the condense id, the Summary follows with ts = last message ts + 1, and
		// the recent raw tail stays untagged.
		const condenseId = "forced-condense-rt"
		const condensedHistory: ApiMessage[] = [
			{ role: "user", content: "task", ts: 100, condenseParent: condenseId },
			{ role: "assistant", content: "early work", ts: 200, condenseParent: condenseId },
			{ role: "user", content: "summary text", ts: 1001, isSummary: true, condenseId },
			{ role: "user", content: "recent tool results", ts: 1000 },
		]
		manageContextMock.mockResolvedValue({
			messages: condensedHistory,
			summary: "summary text",
			cost: 0.01,
			prevContextTokens: 120_000,
			newContextTokens: 20_000,
			condenseId,
		})

		const { access, say } = buildAccess()
		await new TaskContextManager(access).handleContextWindowExceededError()

		const condenseRow = say.mock.calls.find((call) => call[0] === "condense_context")
		expect(condenseRow).toBeDefined()

		// Persist the row the way Task.say would, then rewind to a message that sits
		// AFTER the Summary's timestamp but BEFORE the condense row (for example a
		// row the rejected attempt emitted before the provider reported the
		// overflow). The timestamp filter keeps the Summary here, so the row's
		// condenseId is the only thing that can tell rewind to drop it.
		const clineMessages: ClineMessage[] = [
			{ type: "say", say: "text", text: "task", ts: 100 },
			{ type: "say", say: "api_req_started", text: "{}", ts: 900 },
			{ type: "say", say: "text", text: "partial answer of the rejected attempt", ts: 1100 },
			{ type: "say", say: "condense_context", ts: 1200, contextCondense: condenseRow![7] },
		]
		const task = {
			clineMessages,
			apiConversationHistory: condensedHistory,
			overwriteClineMessages: vi.fn(async (messages: ClineMessage[]) => {
				task.clineMessages = messages
			}),
			overwriteApiConversationHistory: vi.fn(async (messages: ApiMessage[]) => {
				task.apiConversationHistory = messages
			}),
		}

		await new MessageManager(task as any).rewindToTimestamp(1100)

		// The condense row is gone from the chat...
		expect(task.clineMessages.some((m) => m.say === "condense_context")).toBe(false)
		// ...so its Summary must be gone from the API history too, and the prefix it
		// was hiding must be visible again (no dangling condenseParent tags).
		expect(task.apiConversationHistory.some((m) => m.isSummary)).toBe(false)
		expect(task.apiConversationHistory.some((m) => m.condenseParent)).toBe(false)
		expect(task.apiConversationHistory.map((m) => m.ts)).toEqual([100, 200, 1000])
	})
})
