// cd src && npx vitest run core/task/__tests__/TaskResumption.readonly-subagent.spec.ts

import type { ClineMessage } from "@tumble-code/types"

import { TaskResumption, type TaskResumptionAccess } from "../TaskResumption"

function harness(clineMessages: ClineMessage[], replies: Array<{ response: string; text?: string }>) {
	const ask = vi.fn(async () => {
		const reply = replies.shift()
		if (!reply) {
			// The user left the task: a pending ask throws on abort.
			access.abort = true
			throw new Error("aborted")
		}
		return reply
	})
	const say = vi.fn(async () => {})
	const initiateTaskLoop = vi.fn(async () => {})
	const access = {
		taskId: "sub-1",
		instanceId: "1",
		cwd: "/workspace",
		isInitialized: false,
		isReadOnlySubagent: true,
		abort: false,
		abandoned: false,
		clineMessages,
		apiConversationHistory: [],
		providerRef: new WeakRef({}),
		history: {
			getSavedClineMessages: async () => clineMessages,
			overwriteClineMessages: async () => {},
			getSavedApiConversationHistory: async () => [],
			overwriteApiConversationHistory: async () => {},
		},
		askSay: { ask, say },
		emit: () => true,
		initiateTaskLoop,
	} as unknown as TaskResumptionAccess
	return { resumption: new TaskResumption(access), ask, say, initiateTaskLoop }
}

describe("TaskResumption of a finished subagent", () => {
	// A failed subagent ends without completion_result, which would get
	// resume_task (a Resume button) and run it in the parent's workspace.
	it("offers no resume for a subagent that failed and never runs it", async () => {
		const failed: ClineMessage[] = [{ ts: 1, type: "say", say: "error", text: "model gone" }]
		const h = harness(failed, [{ response: "yesButtonClicked" }])

		await h.resumption.resumeTaskFromHistory()

		expect(h.ask).toHaveBeenCalledWith("resume_completed_task")
		expect(h.ask).not.toHaveBeenCalledWith("resume_task")
		expect(h.initiateTaskLoop).not.toHaveBeenCalled()
	})

	it("answers a typed reply with an explanation and keeps waiting", async () => {
		const done: ClineMessage[] = [{ ts: 1, type: "ask", ask: "completion_result", text: "" }]
		const h = harness(done, [{ response: "messageResponse", text: "one more thing" }])

		await h.resumption.resumeTaskFromHistory()

		expect(h.say).toHaveBeenCalledWith("error", expect.any(String))
		expect(h.say).not.toHaveBeenCalledWith("user_feedback", expect.anything(), expect.anything())
		expect(h.ask).toHaveBeenCalledTimes(2)
		expect(h.initiateTaskLoop).not.toHaveBeenCalled()
	})
})
