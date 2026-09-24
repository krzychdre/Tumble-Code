// cd src && npx vitest run core/task/__tests__/TaskContextManager.task-mode.spec.ts

import { TaskContextManager, type TaskContextManagerAccess } from "../TaskContextManager"

const manageContextMock = vi.hoisted(() => vi.fn())
const buildToolsMock = vi.hoisted(() => vi.fn().mockResolvedValue({ tools: [] }))

vi.mock("../../context-management", () => ({
	manageContext: manageContextMock,
	willManageContext: vi.fn().mockReturnValue(true),
}))
vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue(""),
}))
vi.mock("../build-tools", () => ({ buildNativeToolsArrayWithRestrictions: buildToolsMock }))

/**
 * Condensing sends the same tool set as a normal request of the task. The provider state
 * holds the FOCUSED task's mode; a background subagent or delegated child condensing its
 * own context must build that metadata for its own mode.
 */
describe("TaskContextManager condensing metadata mode", () => {
	it("builds the condensing tools and metadata for the task's mode, not the provider's", async () => {
		manageContextMock.mockResolvedValue({
			messages: [{ role: "user", content: "rewritten", ts: 1 }],
			summary: "",
			cost: 0,
			prevContextTokens: 120_000,
			newContextTokens: 60_000,
		})
		const apiHandler = {
			getModel: () => ({ id: "m", info: { contextWindow: 100_000 } }),
			countTokens: async () => 0,
		}
		const provider = {
			getState: vi.fn().mockResolvedValue({ mode: "code" }),
			postMessageToWebview: vi.fn(),
		}
		const access = {
			taskId: "task-1",
			apiConfiguration: {},
			api: apiHandler,
			getCondenseApiHandler: vi.fn().mockResolvedValue(apiHandler),
			apiConversationHistory: [{ role: "user", content: "original", ts: 1 }],
			consecutiveAutoCompactFailures: 0,
			microcompactedToolUseIds: new Set<string>(),
			microcompactStrippedTokens: 0,
			cwd: "/workspace",
			fileContextTracker: { getFilesReadByRoo: vi.fn().mockResolvedValue([]) },
			providerRef: { deref: () => provider },
			history: { overwriteApiConversationHistory: vi.fn() },
			askSay: { say: vi.fn() },
			getArtifactStore: vi.fn().mockResolvedValue(undefined),
			getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 120_000 }),
			getSystemPrompt: vi.fn().mockResolvedValue("system"),
			getTaskMode: vi.fn().mockResolvedValue("architect"),
			emit: vi.fn(),
			processQueuedMessages: vi.fn(),
		} as unknown as TaskContextManagerAccess

		await new TaskContextManager(access).handleContextWindowExceededError()

		expect(buildToolsMock).toHaveBeenCalledWith(expect.objectContaining({ mode: "architect" }))
		expect(manageContextMock.mock.calls[0][0].metadata).toEqual(expect.objectContaining({ mode: "architect" }))
	})
})
