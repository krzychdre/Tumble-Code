import { describe, it, expect, vi, beforeEach } from "vitest"
import { handleCheckpointRestoreOperation } from "../checkpointRestoreHandler"
import { saveTaskMessages } from "../../task-persistence"
import pWaitFor from "p-wait-for"
import * as vscode from "vscode"

// Mock dependencies
vi.mock("../../task-persistence", () => ({
	saveTaskMessages: vi.fn(),
}))
vi.mock("p-wait-for")
vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
	},
}))

describe("checkpointRestoreHandler", () => {
	let mockProvider: any
	let mockCline: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock Cline instance
		mockCline = {
			taskId: "test-task-123",
			abort: false,
			abortTask: vi.fn(() => {
				mockCline.abort = true
			}),
			checkpointRestore: vi.fn(),
			clineMessages: [
				{ ts: 1, type: "user", say: "user", text: "First message" },
				{ ts: 2, type: "assistant", say: "assistant", text: "Response" },
				{
					ts: 3,
					type: "user",
					say: "user",
					text: "Checkpoint message",
					checkpoint: { hash: "abc123" },
				},
				{ ts: 4, type: "assistant", say: "assistant", text: "After checkpoint" },
			],
		}

		// Setup mock provider
		mockProvider = {
			getCurrentTask: vi.fn(() => mockCline),
			postMessageToWebview: vi.fn(),
			getHistoryItem: vi.fn(() => ({ id: "test-task-123", messages: mockCline.clineMessages })),
			createTaskWithHistoryItem: vi.fn(),
			setPendingEditOperation: vi.fn(),
			contextProxy: {
				globalStorageUri: { fsPath: "/test/storage" },
			},
		}

		// Mock pWaitFor to resolve immediately
		;(pWaitFor as any).mockImplementation(async (condition: () => boolean) => {
			// Simulate the condition being met
			return Promise.resolve()
		})
	})

	const restore = (operation: "delete" | "edit", editData?: { editedContent: string; images: string[] }) =>
		handleCheckpointRestoreOperation({
			provider: mockProvider,
			currentCline: mockCline,
			messageTs: 3,
			messageIndex: 2,
			checkpoint: { hash: "abc123" },
			operation,
			editData: editData && { ...editData, apiConversationHistoryIndex: 2 },
		})

	describe("handleCheckpointRestoreOperation", () => {
		it("a delete stops the task, restores, saves the messages and reopens the task from history", async () => {
			mockCline.checkpointRestore.mockImplementation(async () => {
				mockCline.clineMessages = mockCline.clineMessages.slice(0, 2)
			})

			await restore("delete")

			expect(mockCline.abortTask.mock.invocationCallOrder[0]).toBeLessThan(
				mockCline.checkpointRestore.mock.invocationCallOrder[0],
			)
			expect(mockCline.checkpointRestore).toHaveBeenCalledWith({
				ts: 3,
				commitHash: "abc123",
				mode: "restore",
				operation: "delete",
			})
			expect(saveTaskMessages).toHaveBeenCalledWith({
				messages: mockCline.clineMessages,
				taskId: "test-task-123",
				globalStoragePath: "/test/storage",
			})
			expect(mockProvider.getHistoryItem).toHaveBeenCalledWith("test-task-123")
			expect(mockProvider.createTaskWithHistoryItem).toHaveBeenCalledWith(
				mockProvider.getHistoryItem.mock.results[0].value,
			)
		})

		it("a delete does not stop a task that is already stopped", async () => {
			mockCline.abort = true

			await restore("delete")

			expect(mockCline.abortTask).not.toHaveBeenCalled()
			expect(mockCline.checkpointRestore).toHaveBeenCalled()
		})

		it("an edit leaves the edit pending for the restored task and neither saves nor reopens", async () => {
			await restore("edit", { editedContent: "Edited content", images: ["image1.png"] })

			expect(mockCline.abortTask).not.toHaveBeenCalled()
			expect(mockProvider.setPendingEditOperation).toHaveBeenCalledWith("task-test-task-123", {
				messageTs: 3,
				editedContent: "Edited content",
				images: ["image1.png"],
				messageIndex: 2,
				apiConversationHistoryIndex: 2,
			})
			expect(mockCline.checkpointRestore).toHaveBeenCalledWith({
				ts: 3,
				commitHash: "abc123",
				mode: "restore",
				operation: "edit",
			})
			expect(saveTaskMessages).not.toHaveBeenCalled()
			expect(mockProvider.createTaskWithHistoryItem).not.toHaveBeenCalled()
		})

		it("a failed restore is shown and rethrown", async () => {
			mockCline.checkpointRestore.mockRejectedValue(new Error("Checkpoint restore failed"))

			await expect(restore("delete")).rejects.toThrow("Checkpoint restore failed")

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				"Error during checkpoint restore: Checkpoint restore failed",
			)
		})
	})
})
