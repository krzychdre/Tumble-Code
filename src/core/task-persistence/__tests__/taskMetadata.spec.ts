import type { ClineMessage } from "@tumble-code/types"

import { taskMetadata } from "../taskMetadata"

vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi.fn(async (_root: string, id: string) => `/storage/tasks/${id}`),
}))
vi.mock("get-folder-size", () => ({ default: { loose: vi.fn(async () => 0) } }))

const say = (ts: number, kind: ClineMessage["say"], text = ""): ClineMessage => ({ ts, type: "say", say: kind, text })
const ask = (ts: number, kind: ClineMessage["ask"], text = ""): ClineMessage => ({ ts, type: "ask", ask: kind, text })

const outcomeOf = async (messages: ClineMessage[]) =>
	(
		await taskMetadata({
			taskId: "task-1",
			taskNumber: 1,
			messages,
			globalStoragePath: "/storage",
			workspace: "/ws",
			// A parent is "active" after its subtask returns, finished or not.
			initialStatus: "active",
		})
	).historyItem.outcome

describe("taskMetadata outcome", () => {
	it("marks a task that ended with its completion result as completed, past a later resume", async () => {
		expect(
			await outcomeOf([
				say(1, "text", "Do it"),
				say(2, "completion_result", "Done"),
				ask(3, "completion_result"),
				ask(4, "resume_completed_task"),
			]),
		).toBe("completed")
	})

	it("marks a subtask that asked to finish after its result as completed", async () => {
		expect(
			await outcomeOf([
				say(1, "text", "Do it"),
				say(2, "completion_result", "Done"),
				ask(3, "tool", '{"tool":"finishTask"}'),
				ask(4, "resume_task"),
			]),
		).toBe("completed")
	})

	it("marks a task that went on after its result as unfinished", async () => {
		expect(
			await outcomeOf([
				say(1, "text", "Do it"),
				say(2, "completion_result", "Done"),
				ask(3, "completion_result"),
				say(4, "user_feedback", "One more thing"),
				say(5, "api_req_started", "{}"),
			]),
		).toBe("unfinished")
	})

	it("marks a task stopped before any result as unfinished", async () => {
		expect(await outcomeOf([say(1, "text", "Do it"), say(2, "api_req_started", "{}"), ask(3, "resume_task")])).toBe(
			"unfinished",
		)
	})
})
