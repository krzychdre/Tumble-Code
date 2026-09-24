// cd src && npx vitest run core/task/__tests__/TaskResumption.interrupted-tool-calls.spec.ts

import type { ClineMessage } from "@roo-code/types"
import type { Anthropic } from "@anthropic-ai/sdk"

import type { ApiMessage } from "../../task-persistence"
import { TaskResumption, type TaskResumptionAccess } from "../TaskResumption"

const INTERRUPTED = "Task was interrupted before this tool call could be completed."

/** Resumes `apiHistory` and returns the user content the first resumed request starts with. */
async function resume(apiHistory: ApiMessage[]): Promise<Anthropic.Messages.ContentBlockParam[]> {
	const clineMessages: ClineMessage[] = [
		{ ts: Date.now(), type: "say", say: "text", text: "working" } as ClineMessage,
	]
	let userContent: Anthropic.Messages.ContentBlockParam[] = []

	const access = {
		taskId: "task-1",
		instanceId: "1",
		cwd: "/tmp",
		isInitialized: false,
		abort: false,
		abandoned: false,
		clineMessages,
		apiConversationHistory: apiHistory,
		providerRef: new WeakRef({}),
		history: {
			getSavedClineMessages: async () => clineMessages,
			overwriteClineMessages: async () => {},
			getSavedApiConversationHistory: async () => apiHistory,
			overwriteApiConversationHistory: async () => {},
		},
		askSay: {
			ask: async () => ({ response: "yesButtonClicked" }),
			say: async () => {},
		},
		emit: () => true,
		initiateTaskLoop: async (content: Anthropic.Messages.ContentBlockParam[]) => {
			userContent = content
		},
	} as unknown as TaskResumptionAccess

	await new TaskResumption(access).resumeTaskFromHistory()
	return userContent
}

function toolResults(content: Anthropic.Messages.ContentBlockParam[]) {
	return content.filter((block) => block.type === "tool_result")
}

describe("TaskResumption interrupted tool calls", () => {
	// The synthetic results must be errors: the task list records the task as interrupted, so the
	// persisted API history must not read like a successful attempt_completion (or any other call).

	it("marks the synthetic results for an unanswered assistant turn as errors", async () => {
		const userContent = await resume([
			{ role: "user", ts: 1, content: [{ type: "text", text: "<task>finish up</task>" }] },
			{
				role: "assistant",
				ts: 2,
				content: [
					{ type: "text", text: "Wrapping up" },
					{ type: "tool_use", id: "toolu_1", name: "attempt_completion", input: { result: "done" } },
				],
			},
		])

		expect(toolResults(userContent)).toEqual([
			{ type: "tool_result", tool_use_id: "toolu_1", content: INTERRUPTED, is_error: true },
		])
	})

	it("marks only the missing results of a partly answered turn as errors", async () => {
		const userContent = await resume([
			{ role: "user", ts: 1, content: [{ type: "text", text: "<task>look around</task>" }] },
			{
				role: "assistant",
				ts: 2,
				content: [
					{ type: "tool_use", id: "toolu_a", name: "execute_command", input: { command: "ls" } },
					{ type: "tool_use", id: "toolu_b", name: "read_file", input: { path: "a.txt" } },
				],
			},
			{
				role: "user",
				ts: 3,
				content: [{ type: "tool_result", tool_use_id: "toolu_a", content: "partial result" }],
			},
		])

		expect(toolResults(userContent)).toEqual([
			// The real result is kept exactly as it was.
			{ type: "tool_result", tool_use_id: "toolu_a", content: "partial result" },
			{ type: "tool_result", tool_use_id: "toolu_b", content: INTERRUPTED, is_error: true },
		])
	})
})
