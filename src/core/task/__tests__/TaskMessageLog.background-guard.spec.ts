// npx vitest run core/task/__tests__/TaskMessageLog.background-guard.spec.ts

import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("../../task-persistence", () => ({
	saveTaskMessages: vi.fn().mockResolvedValue(undefined),
	readTaskMessages: vi.fn().mockResolvedValue([]),
	saveApiMessages: vi.fn().mockResolvedValue(undefined),
	readApiMessages: vi.fn().mockResolvedValue([]),
	taskMetadata: vi.fn().mockResolvedValue({
		historyItem: { id: "bg-task-1", ts: Date.now(), task: "test", messages: [] },
		tokenUsage: {},
	}),
}))

import { TaskMessageLog, type TaskMessageLogAccess } from "../TaskMessageLog"
import * as taskPersistence from "../../task-persistence"

const saveTaskMessages = vi.mocked(taskPersistence.saveTaskMessages)
const readTaskMessages = vi.mocked(taskPersistence.readTaskMessages)
const taskMetadata = vi.mocked(taskPersistence.taskMetadata)

function buildAccess(overrides: Partial<TaskMessageLogAccess> = {}): TaskMessageLogAccess {
	const provider = {
		updateTaskHistory: vi.fn().mockResolvedValue(undefined),
	}
	return {
		taskId: "bg-task-1",
		globalStoragePath: "/tmp/storage",
		apiConversationHistory: [],
		clineMessages: [{ type: "say", say: "text", text: "hello", ts: 1 }],
		api: {} as any,
		apiConfiguration: {} as any,
		userMessageContent: [],
		assistantMessageSavedToHistory: true,
		abort: false,
		providerRef: { deref: () => provider } as unknown as TaskMessageLogAccess["providerRef"],
		cloudSyncedMessageTimestamps: new Set<number>(),
		rootTaskId: undefined,
		parentTaskId: undefined,
		taskNumber: 1,
		cwd: "/tmp",
		_taskMode: "code",
		_taskApiConfigName: "test",
		taskApiConfigReady: Promise.resolve(),
		initialStatus: undefined,
		toolUsage: {},
		debouncedEmitTokenUsage: vi.fn(),
		emit: vi.fn(),
		restoreTodoListForTask: vi.fn(),
		isBackground: false,
		...overrides,
	} as unknown as TaskMessageLogAccess
}

describe("TaskMessageLog.saveClineMessages — background guard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		readTaskMessages.mockResolvedValue([])
	})

	it("calls updateTaskHistory for foreground tasks", async () => {
		const access = buildAccess({ isBackground: false })
		const history = new TaskMessageLog(access)

		await history.saveClineMessages()

		expect(saveTaskMessages).toHaveBeenCalled()
		expect(taskMetadata).toHaveBeenCalled()
		expect(access.providerRef.deref()?.updateTaskHistory).toHaveBeenCalled()
	})

	it("saves messages but skips updateTaskHistory for background tasks", async () => {
		const access = buildAccess({ isBackground: true })
		const history = new TaskMessageLog(access)

		await history.saveClineMessages()

		expect(saveTaskMessages).toHaveBeenCalled()
		expect(taskMetadata).toHaveBeenCalled()
		expect(access.providerRef.deref()?.updateTaskHistory).not.toHaveBeenCalled()
		expect(taskMetadata).toHaveBeenCalledWith(expect.objectContaining({ isSubagent: false, workspace: "/tmp" }))
	})

	// A parallel subagent has no runtime parent; its history lineage places the
	// item under the fan-out parent, in the parent's workspace, not its worktree.
	it("writes a parallel subagent's history item as a subtask of the fan-out parent", async () => {
		const access = buildAccess({
			isBackground: true,
			cwd: "/worktrees/child",
			historyLineage: { parentTaskId: "parent-1", rootTaskId: "root-1", workspace: "/project" },
		})
		const history = new TaskMessageLog(access)

		await history.saveClineMessages()

		expect(taskMetadata).toHaveBeenCalledWith(
			expect.objectContaining({
				parentTaskId: "parent-1",
				rootTaskId: "root-1",
				workspace: "/project",
				taskNumber: 1,
				isSubagent: true,
			}),
		)
		expect(access.providerRef.deref()?.updateTaskHistory).toHaveBeenCalled()
	})
})
