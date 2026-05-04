import { Task } from "../Task"
import { TaskAskSay } from "../TaskAskSay"

// Keep this test focused: if a queued message arrives while Task.ask() is blocked,
// it should be consumed and used to fulfill the ask.

describe("Task.ask queued message drain", () => {
	it("consumes queued message while blocked on followup ask", async () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).abort = false
		;(task as any).clineMessages = []
		;(task as any).askResponse = undefined
		;(task as any).askResponseText = undefined
		;(task as any).askResponseImages = undefined
		;(task as any).lastMessageTs = undefined
		;(task as any).taskId = "test-task-id"
		;(task as any).instanceId = "test-instance-id"
		;(task as any).idleAsk = undefined
		;(task as any).resumableAsk = undefined
		;(task as any).interactiveAsk = undefined
		;(task as any).autoApprovalTimeoutRef = undefined

		// Message queue service exists in constructor; for unit test we can attach a real one.
		const { MessageQueueService } = await import("../../message-queue/MessageQueueService")
		;(task as any).messageQueueService = new MessageQueueService()

		// Minimal stubs used by ask() - these are now delegated via history
		const historyStub = {
			addToClineMessages: vi.fn(async () => {}),
			saveClineMessages: vi.fn(async () => {}),
			updateClineMessage: vi.fn(async () => {}),
			findMessageByTimestamp: vi.fn(() => undefined),
		}
		;(task as any).history = historyStub
		;(task as any).checkpointSave = vi.fn(async () => {})
		;(task as any).emit = vi.fn()
		;(task as any).providerRef = { deref: () => undefined }

		// Initialize TaskAskSay with the task-like object as the access interface
		// so that property reads/writes in TaskAskSay go through the live task object
		;(task as any).askSay = new TaskAskSay(task as any)

		const askPromise = task.ask("followup", "Q?", false)

		// Simulate webview queuing the user's selection text while the ask is pending.
		;(task as any).messageQueueService.addMessage("picked answer")

		const result = await askPromise
		expect(result.response).toBe("messageResponse")
		expect(result.text).toBe("picked answer")
	})

	it("does not consume queued messages for command_output asks", async () => {
		const task = Object.create(Task.prototype) as Task
		;(task as any).abort = false
		;(task as any).clineMessages = []
		;(task as any).askResponse = undefined
		;(task as any).askResponseText = undefined
		;(task as any).askResponseImages = undefined
		;(task as any).lastMessageTs = undefined
		;(task as any).taskId = "test-task-id"
		;(task as any).instanceId = "test-instance-id"
		;(task as any).idleAsk = undefined
		;(task as any).resumableAsk = undefined
		;(task as any).interactiveAsk = undefined
		;(task as any).autoApprovalTimeoutRef = undefined

		const { MessageQueueService } = await import("../../message-queue/MessageQueueService")
		;(task as any).messageQueueService = new MessageQueueService()

		// Minimal stubs used by ask() - these are now delegated via history
		const historyStub = {
			addToClineMessages: vi.fn(async () => {}),
			saveClineMessages: vi.fn(async () => {}),
			updateClineMessage: vi.fn(async () => {}),
			findMessageByTimestamp: vi.fn(() => undefined),
		}
		;(task as any).history = historyStub
		;(task as any).checkpointSave = vi.fn(async () => {})
		;(task as any).emit = vi.fn()
		;(task as any).providerRef = { deref: () => undefined }

		// Initialize TaskAskSay with the task-like object as the access interface
		;(task as any).askSay = new TaskAskSay(task as any)

		const askPromise = task.ask("command_output", "command is still running...", false)
		;(task as any).messageQueueService.addMessage("1+1=?")

		setTimeout(() => {
			task.approveAsk()
		}, 0)

		const result = await askPromise

		expect(result.response).toBe("yesButtonClicked")
		expect(result.text).toBeUndefined()
		expect((task as any).messageQueueService.isEmpty()).toBe(false)
		expect((task as any).messageQueueService.messages[0]?.text).toBe("1+1=?")
	})
})
