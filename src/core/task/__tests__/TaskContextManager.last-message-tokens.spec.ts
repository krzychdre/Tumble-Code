// cd src && ./node_modules/.bin/vitest run core/task/__tests__/TaskContextManager.last-message-tokens.spec.ts

// API P4 (Phase 10): TaskApiLoop counts the last message's tokens for the
// threshold check; manageContext counted the same message again. The manager
// now hands the count on when manageContext uses the same handler, and leaves
// it out when a different (condense) handler does the counting.

import { describe, it, expect, beforeEach, vi } from "vitest"

import { TaskContextManager, type TaskContextManagerAccess } from "../TaskContextManager"

const manageContextMock = vi.hoisted(() => vi.fn())
const willManageContextMock = vi.hoisted(() => vi.fn())

vi.mock("../../context-management", () => ({
	manageContext: manageContextMock,
	willManageContext: willManageContextMock,
}))

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))

function buildAccess(condenseHandler?: object) {
	const api = { getModel: () => ({ id: "m", info: {} }), countTokens: async () => 0 }
	const access = {
		taskId: "t",
		apiConfiguration: {},
		api,
		getCondenseApiHandler: vi.fn().mockResolvedValue(condenseHandler ?? api),
		apiConversationHistory: [{ role: "user", content: "history", ts: 1 }],
		consecutiveAutoCompactFailures: 0,
		microcompactedToolUseIds: new Set<string>(),
		microcompactStrippedTokens: 0,
		cwd: "/workspace",
		fileContextTracker: { getFilesReadByRoo: vi.fn().mockResolvedValue([]) },
		getTaskMode: vi.fn().mockResolvedValue("code"),
		providerRef: { deref: () => undefined },
		history: { overwriteApiConversationHistory: vi.fn() },
		askSay: { say: vi.fn() },
		getArtifactStore: vi.fn().mockResolvedValue(undefined),
		getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 0 }),
		getSystemPrompt: vi.fn().mockResolvedValue("system"),
		emit: vi.fn(),
		processQueuedMessages: vi.fn(),
	} as unknown as TaskContextManagerAccess
	return access
}

const params = {
	state: { mode: "code" },
	systemPrompt: "system",
	autoCondenseContext: true,
	autoCondenseContextPercent: 70,
	profileThresholds: {},
	currentProfileId: "default",
	contextTokens: 10_000,
	maxTokens: 8_000,
	contextWindow: 100_000,
	lastMessageTokens: 123,
}

describe("TaskContextManager hands the last-message count to manageContext (API P4)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		manageContextMock.mockResolvedValue({ messages: [], summary: "", cost: 0, prevContextTokens: 10_123 })
	})

	it("passes the count when no condense runs (manageContext counts with the task's own handler)", async () => {
		willManageContextMock.mockReturnValue(false)

		await new TaskContextManager(buildAccess()).manageContextIfNeeded(params)

		expect(manageContextMock.mock.calls[0][0].lastMessageTokens).toBe(123)
	})

	it("leaves it out when a separate condense handler counts", async () => {
		willManageContextMock.mockReturnValue(true)
		const condenseHandler = { getModel: () => ({ id: "c", info: {} }), countTokens: async () => 0 }

		await new TaskContextManager(buildAccess(condenseHandler)).manageContextIfNeeded(params)

		expect(manageContextMock.mock.calls[0][0].apiHandler).toBe(condenseHandler)
		expect(manageContextMock.mock.calls[0][0].lastMessageTokens).toBeUndefined()
	})
})
