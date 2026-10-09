// npx vitest run core/webview/__tests__/ClineProvider.resumeStoppedTask.spec.ts
//
// The cloud web page's Resume button sends `resume_task`. The bridge used to
// call only showTaskWithId, which does nothing when the stopped task is
// already the current one (cancelTask rehydrates it) and otherwise only
// rebuilds a task that then waits on a `resume_task` ask. resumeStoppedTask must
// also answer that ask with "yes", and only that ask.

import { describe, expect, it, vi } from "vitest"
import type { ClineMessage } from "@tumble-code/types"

import { ClineProvider } from "../ClineProvider"

type FakeTask = {
	taskId: string
	clineMessages: ClineMessage[]
	handleWebviewAskResponse: ReturnType<typeof vi.fn>
}

function makeTask(taskId: string, messages: ClineMessage[] = []): FakeTask {
	return { taskId, clineMessages: messages, handleWebviewAskResponse: vi.fn() }
}

function resumeAsk(overrides: Partial<ClineMessage> = {}): ClineMessage {
	return { ts: Date.now(), type: "ask", ask: "resume_task", ...overrides } as ClineMessage
}

function makeProvider(findLiveTask: (taskId: string) => FakeTask | undefined, showTaskWithId = vi.fn()) {
	const standIn = {
		showTaskWithId: showTaskWithId.mockResolvedValue(undefined),
		findLiveTask: vi.fn(findLiveTask),
	}
	const resume = (taskId: string, timeoutMs?: number) =>
		ClineProvider.prototype.resumeStoppedTask.call(standIn as unknown as ClineProvider, taskId, timeoutMs)
	return { standIn, resume }
}

describe("ClineProvider.resumeStoppedTask", () => {
	it("answers yes when the current task already waits on resume_task", async () => {
		const task = makeTask("t1", [resumeAsk()])
		const { standIn, resume } = makeProvider((id) => (id === "t1" ? task : undefined))

		await expect(resume("t1")).resolves.toBe(true)

		expect(standIn.showTaskWithId).toHaveBeenCalledWith("t1")
		expect(task.handleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(task.handleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked")
	})

	it("answers the ask that appears only on a later poll", async () => {
		const task = makeTask("t1", [{ ts: 1, type: "say", say: "text", text: "hi" } as ClineMessage])
		let polls = 0
		const { resume } = makeProvider(() => {
			polls++
			// The rehydrated task posts its resume_task ask a few polls later.
			if (polls === 3) {
				task.clineMessages.push(resumeAsk())
			}
			return task
		})

		await expect(resume("t1", 2_000)).resolves.toBe(true)

		expect(polls).toBeGreaterThanOrEqual(3)
		expect(task.handleWebviewAskResponse).toHaveBeenCalledTimes(1)
		expect(task.handleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked")
	})

	it("answers a task that becomes live only after showTaskWithId", async () => {
		const task = makeTask("t1", [resumeAsk()])
		let live: FakeTask | undefined
		const show = vi.fn()
		const { resume } = makeProvider(() => live, show)
		show.mockImplementation(async () => {
			setTimeout(() => {
				live = task
			}, 150)
		})

		await expect(resume("t1", 2_000)).resolves.toBe(true)
		expect(task.handleWebviewAskResponse).toHaveBeenCalledWith("yesButtonClicked")
	})

	it.each<[string, ClineMessage[]]>([
		["resume_completed_task", [resumeAsk({ ask: "resume_completed_task" })]],
		["a partial resume_task", [resumeAsk({ partial: true })]],
		["an answered resume_task", [resumeAsk({ isAnswered: true })]],
		["an older resume_task followed by a say", [resumeAsk(), { ts: 2, type: "say", say: "text" } as ClineMessage]],
		["no messages", []],
	])("returns false and sends no answer when the last message is %s", async (_label, messages) => {
		const task = makeTask("t1", messages)
		const { resume } = makeProvider(() => task)

		await expect(resume("t1", 250)).resolves.toBe(false)
		expect(task.handleWebviewAskResponse).not.toHaveBeenCalled()
	})

	it("returns false when no live task exists", async () => {
		const { standIn, resume } = makeProvider(() => undefined)

		await expect(resume("missing", 250)).resolves.toBe(false)
		expect(standIn.showTaskWithId).toHaveBeenCalledWith("missing")
		expect(standIn.findLiveTask).toHaveBeenCalledWith("missing")
	})
})
