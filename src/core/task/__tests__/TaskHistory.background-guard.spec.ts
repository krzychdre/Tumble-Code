// npx vitest run core/task/__tests__/TaskHistory.background-guard.spec.ts

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

import { TaskHistory, type TaskHistoryAccess } from "../TaskHistory"
import * as taskPersistence from "../../task-persistence"

const saveTaskMessages = vi.mocked(taskPersistence.saveTaskMessages)
const readTaskMessages = vi.mocked(taskPersistence.readTaskMessages)
const taskMetadata = vi.mocked(taskPersistence.taskMetadata)

function buildAccess(overrides: Partial<TaskHistoryAccess> = {}): TaskHistoryAccess {
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
		providerRef: { deref: () => provider } as unknown as TaskHistoryAccess["providerRef"],
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
	} as unknown as TaskHistoryAccess
}

describe("TaskHistory.saveClineMessages — background guard", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		readTaskMessages.mockResolvedValue([])
	})

	it("calls updateTaskHistory for foreground tasks", async () => {
		const access = buildAccess({ isBackground: false })
		const history = new TaskHistory(access)

		await history.saveClineMessages()

		expect(saveTaskMessages).toHaveBeenCalled()
		expect(taskMetadata).toHaveBeenCalled()
		expect(access.providerRef.deref()?.updateTaskHistory).toHaveBeenCalled()
	})

	it("saves messages but skips updateTaskHistory for background tasks", async () => {
		const access = buildAccess({ isBackground: true })
		const history = new TaskHistory(access)

		await history.saveClineMessages()

		expect(saveTaskMessages).toHaveBeenCalled()
		expect(taskMetadata).toHaveBeenCalled()
		expect(access.providerRef.deref()?.updateTaskHistory).not.toHaveBeenCalled()
	})
})
