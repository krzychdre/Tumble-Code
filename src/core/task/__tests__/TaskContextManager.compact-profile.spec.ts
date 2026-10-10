// cd src && npx vitest run core/task/__tests__/TaskContextManager.compact-profile.spec.ts

// Condensing under the compact profile, read from the task's own profile: the 70 percent default
// threshold on both passes, the compact toolset and one tool call per message in the condense
// request, no prune pass.

import { TaskContextManager, type TaskContextManagerAccess } from "../TaskContextManager"
import type { ProviderState } from "../../webview/ProviderStateBuilder"

const manageContextMock = vi.hoisted(() => vi.fn())
const willManageContextMock = vi.hoisted(() => vi.fn())
const buildToolsMock = vi.hoisted(() => vi.fn())

vi.mock("../../context-management", () => ({
	manageContext: manageContextMock,
	willManageContext: willManageContextMock,
}))
vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))
vi.mock("../build-tools", () => ({ buildNativeToolsArrayWithRestrictions: buildToolsMock }))

function buildAccess(apiConfiguration: Record<string, unknown>) {
	const api = {
		getModel: () => ({ id: "qwen3.5-4b-q4_k_m", info: { contextWindow: 40_960, maxTokens: -1 } }),
		countTokens: async () => 0,
	}
	const provider = {
		getState: vi.fn().mockResolvedValue({ mode: "code" }),
		postMessageForTask: vi.fn(),
	}
	const access = {
		taskId: "t",
		apiConfiguration,
		api,
		getCondenseApiHandler: vi.fn().mockResolvedValue(api),
		apiConversationHistory: [{ role: "user", content: "history", ts: 1 }],
		consecutiveAutoCompactFailures: 0,
		microcompactedIds: new Set<string>(),
		microcompactStrippedTokens: 0,
		cwd: "/workspace",
		fileContextTracker: { getFilesReadByRoo: vi.fn().mockResolvedValue([]) },
		getTaskMode: vi.fn().mockResolvedValue("code"),
		providerRef: { deref: () => provider },
		history: { overwriteApiConversationHistory: vi.fn() },
		askSay: { say: vi.fn() },
		getArtifactStore: vi.fn().mockResolvedValue({ store: true }),
		getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 30_000 }),
		getSystemPrompt: vi.fn().mockResolvedValue("system"),
		emit: vi.fn(),
		processQueuedMessages: vi.fn(),
	} as unknown as TaskContextManagerAccess
	return access
}

const params = {
	state: { mode: "code" } as ProviderState,
	systemPrompt: "system",
	autoCondenseContext: true,
	autoCondenseContextPercent: 100,
	profileThresholds: { local: 85 },
	currentProfileId: "default",
	contextTokens: 30_000,
	maxTokens: 4_096,
	contextWindow: 40_960,
	lastMessageTokens: 10,
}

const COMPACT = { apiProvider: "openai", compactProfile: true }
const FLAG_OFF: Array<[string, Record<string, unknown>]> = [
	["absent", { apiProvider: "openai" }],
	["false", { apiProvider: "openai", compactProfile: false }],
]

describe("TaskContextManager under the compact profile", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		manageContextMock.mockResolvedValue({ messages: [], summary: "", cost: 0, prevContextTokens: 30_000 })
		willManageContextMock.mockReturnValue(true)
		buildToolsMock.mockResolvedValue({ tools: [{ type: "function", function: { name: "read_file" } }] })
	})

	describe("condense threshold", () => {
		it("regular pass: the global 100 percent becomes 70, for the pre-check and the pass alike", async () => {
			await new TaskContextManager(buildAccess(COMPACT)).manageContextIfNeeded(params)

			expect(willManageContextMock.mock.calls[0][0].autoCondenseContextPercent).toBe(70)
			expect(manageContextMock.mock.calls[0][0].autoCondenseContextPercent).toBe(70)
			// The per-profile thresholds still travel, so a valid one wins inside resolveCondenseThreshold.
			expect(manageContextMock.mock.calls[0][0].profileThresholds).toEqual({ local: 85 })
		})

		it("regular pass: a lower global setting wins", async () => {
			await new TaskContextManager(buildAccess(COMPACT)).manageContextIfNeeded({
				...params,
				autoCondenseContextPercent: 50,
			})
			expect(manageContextMock.mock.calls[0][0].autoCondenseContextPercent).toBe(50)
		})

		it("forced pass after a context-window error aims at 70 instead of 75", async () => {
			await new TaskContextManager(buildAccess(COMPACT)).handleContextWindowExceededError()
			expect(manageContextMock.mock.calls[0][0].autoCondenseContextPercent).toBe(70)
			expect(manageContextMock.mock.calls[0][0].maxTokens).toBe(4096)
		})

		it.each(FLAG_OFF)("flag %s: today's percents and reservation", async (_label, apiConfiguration) => {
			await new TaskContextManager(buildAccess(apiConfiguration)).manageContextIfNeeded(params)
			expect(willManageContextMock.mock.calls[0][0].autoCondenseContextPercent).toBe(100)
			expect(manageContextMock.mock.calls[0][0].autoCondenseContextPercent).toBe(100)

			manageContextMock.mockClear()
			await new TaskContextManager(buildAccess(apiConfiguration)).handleContextWindowExceededError()
			expect(manageContextMock.mock.calls[0][0].autoCondenseContextPercent).toBe(75)
			expect(manageContextMock.mock.calls[0][0].maxTokens).toBe(-1)
		})
	})

	describe("condense request tools", () => {
		it("builds the condense tools with the compact toolset", async () => {
			await new TaskContextManager(buildAccess(COMPACT)).manageContextIfNeeded(params)
			expect(buildToolsMock).toHaveBeenCalledWith(expect.objectContaining({ compactProfile: true }))
		})

		it.each(FLAG_OFF)("flag %s: the regular toolset", async (_label, apiConfiguration) => {
			await new TaskContextManager(buildAccess(apiConfiguration)).manageContextIfNeeded(params)
			expect(buildToolsMock.mock.calls[0][0].compactProfile).toBe(false)
		})

		it("asks for one tool call per message, on the regular and the forced pass", async () => {
			await new TaskContextManager(buildAccess(COMPACT)).manageContextIfNeeded(params)
			await new TaskContextManager(buildAccess(COMPACT)).handleContextWindowExceededError()

			expect(manageContextMock.mock.calls[0][0].metadata.parallelToolCalls).toBe(false)
			expect(manageContextMock.mock.calls[1][0].metadata.parallelToolCalls).toBe(false)
		})

		it.each(FLAG_OFF)("flag %s: parallel tool calls stay on", async (_label, apiConfiguration) => {
			await new TaskContextManager(buildAccess(apiConfiguration)).manageContextIfNeeded(params)
			await new TaskContextManager(buildAccess(apiConfiguration)).handleContextWindowExceededError()

			expect(manageContextMock.mock.calls[0][0].metadata.parallelToolCalls).toBe(true)
			expect(manageContextMock.mock.calls[1][0].metadata.parallelToolCalls).toBe(true)
		})
	})

	describe("prune pass", () => {
		it("is skipped: its previews cite read_artifact, which compact does not offer", async () => {
			const access = buildAccess(COMPACT)
			await new TaskContextManager(access).manageContextIfNeeded(params)

			expect(manageContextMock.mock.calls[0][0].pruneBeforeCondense).toBe(false)
			expect(manageContextMock.mock.calls[0][0].artifactStore).toBeUndefined()
			expect(access.getArtifactStore).not.toHaveBeenCalled()
		})

		it.each(FLAG_OFF)("flag %s: runs as today", async (_label, apiConfiguration) => {
			await new TaskContextManager(buildAccess(apiConfiguration)).manageContextIfNeeded(params)
			expect(manageContextMock.mock.calls[0][0].pruneBeforeCondense).toBe(true)
			expect(manageContextMock.mock.calls[0][0].artifactStore).toEqual({ store: true })
		})
	})
})
