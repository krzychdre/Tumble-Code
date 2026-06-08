// cd src && npx vitest run core/context-management/__tests__/microcompact.spec.ts

import { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

import { BaseProvider } from "../../../api/providers/base-provider"
import { ApiMessage } from "../../task-persistence/apiMessages"

import {
	microcompactToolResults,
	MICROCOMPACT_CLEARED_PLACEHOLDER,
	MICROCOMPACT_KEEP_RECENT,
	COMPACTABLE_TOOL_NAMES,
} from "../microcompact"
import { manageContext } from "../index"

let counter = 0

/**
 * Build an assistant `tool_use` + user `tool_result` pair for a given tool.
 * The result content is a single string (the common case).
 */
function toolPair(toolName: string, resultContent: string, id?: string): [ApiMessage, ApiMessage] {
	counter += 1
	const useId = id ?? `tool-${counter}`
	const assistant: ApiMessage = {
		role: "assistant",
		content: [{ type: "tool_use", id: useId, name: toolName, input: {} }],
		ts: counter,
	}
	const user: ApiMessage = {
		role: "user",
		content: [{ type: "tool_result", tool_use_id: useId, content: resultContent }],
		ts: counter,
	}
	return [assistant, user]
}

function firstUser(): ApiMessage {
	return { role: "user", content: "Initial task", ts: 0 }
}

/** Find the tool_result content for a given tool_use_id in a message list. */
function resultContentFor(messages: ApiMessage[], toolUseId: string): unknown {
	for (const msg of messages) {
		if (msg.role === "user" && Array.isArray(msg.content)) {
			for (const block of msg.content) {
				if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
					return block.content
				}
			}
		}
	}
	return undefined
}

describe("microcompactToolResults", () => {
	beforeEach(() => {
		counter = 0
	})

	it("clears the content of old compactable results but keeps the most recent N raw", () => {
		const pairs: ApiMessage[] = []
		const ids: string[] = []
		// 8 read_file interactions; keepRecent defaults to 5 -> 3 oldest cleared.
		for (let i = 0; i < 8; i++) {
			const id = `read-${i}`
			ids.push(id)
			pairs.push(...toolPair("read_file", `contents of file ${i} `.repeat(50), id))
		}
		const messages = [firstUser(), ...pairs]

		const result = microcompactToolResults(messages)

		expect(result.clearedCount).toBe(3)
		expect(result.clearedToolUseIds).toEqual(["read-0", "read-1", "read-2"])

		// Oldest 3 cleared.
		for (const id of ["read-0", "read-1", "read-2"]) {
			expect(resultContentFor(result.messages, id)).toBe(MICROCOMPACT_CLEARED_PLACEHOLDER)
		}
		// Most recent 5 untouched.
		for (let i = 3; i < 8; i++) {
			expect(resultContentFor(result.messages, `read-${i}`)).toContain(`contents of file ${i}`)
		}
		// Original content surfaced in clearedText for token accounting.
		expect(result.clearedText).toContain("contents of file 0")
		expect(result.clearedText).toContain("contents of file 2")
		expect(result.clearedText).not.toContain("contents of file 7")
	})

	it("is a no-op (same reference) when there are at most keepRecent compactable results", () => {
		const pairs: ApiMessage[] = []
		for (let i = 0; i < MICROCOMPACT_KEEP_RECENT; i++) {
			pairs.push(...toolPair("read_file", `file ${i}`))
		}
		const messages = [firstUser(), ...pairs]

		const result = microcompactToolResults(messages)

		expect(result.clearedCount).toBe(0)
		expect(result.messages).toBe(messages) // unchanged reference
	})

	it("never clears results from non-compactable tools (e.g. attempt_completion, update_todo_list)", () => {
		// Sanity on the whitelist itself.
		expect(COMPACTABLE_TOOL_NAMES.has("attempt_completion")).toBe(false)
		expect(COMPACTABLE_TOOL_NAMES.has("update_todo_list")).toBe(false)
		expect(COMPACTABLE_TOOL_NAMES.has("read_file")).toBe(true)

		const pairs: ApiMessage[] = []
		// Lots of (old) attempt_completion + update_todo_list results.
		for (let i = 0; i < 6; i++) {
			pairs.push(...toolPair("attempt_completion", `completion ${i}`, `done-${i}`))
			pairs.push(...toolPair("update_todo_list", `todos ${i}`, `todo-${i}`))
		}
		const messages = [firstUser(), ...pairs]

		const result = microcompactToolResults(messages)

		expect(result.clearedCount).toBe(0)
		expect(result.messages).toBe(messages)
	})

	it("respects the keepRecent option override", () => {
		const pairs: ApiMessage[] = []
		for (let i = 0; i < 6; i++) {
			pairs.push(...toolPair("execute_command", `stdout ${i}`, `cmd-${i}`))
		}
		const messages = [firstUser(), ...pairs]

		const result = microcompactToolResults(messages, { keepRecent: 2 })

		expect(result.clearedCount).toBe(4)
		expect(result.clearedToolUseIds).toEqual(["cmd-0", "cmd-1", "cmd-2", "cmd-3"])
		expect(resultContentFor(result.messages, "cmd-4")).toBe("stdout 4")
		expect(resultContentFor(result.messages, "cmd-5")).toBe("stdout 5")
	})

	it("is idempotent: re-running does not re-clear or re-count already cleared blocks", () => {
		const pairs: ApiMessage[] = []
		for (let i = 0; i < 8; i++) {
			pairs.push(...toolPair("search_files", `match ${i}`.repeat(20), `s-${i}`))
		}
		const messages = [firstUser(), ...pairs]

		const first = microcompactToolResults(messages)
		expect(first.clearedCount).toBe(3)

		const second = microcompactToolResults(first.messages)
		expect(second.clearedCount).toBe(0)
		expect(second.messages).toBe(first.messages) // nothing new to clear
	})

	it("handles tool_result content given as an array of text blocks", () => {
		const pairs: ApiMessage[] = []
		for (let i = 0; i < 7; i++) {
			counter += 1
			const useId = `arr-${i}`
			pairs.push({
				role: "assistant",
				content: [{ type: "tool_use", id: useId, name: "read_file", input: {} }],
				ts: counter,
			})
			pairs.push({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: useId,
						content: [{ type: "text", text: `block text ${i}` }],
					},
				],
				ts: counter,
			})
		}
		const messages = [firstUser(), ...pairs]

		const result = microcompactToolResults(messages)

		expect(result.clearedCount).toBe(2)
		expect(resultContentFor(result.messages, "arr-0")).toBe(MICROCOMPACT_CLEARED_PLACEHOLDER)
		expect(result.clearedText).toContain("block text 0")
		// Recent tail keeps the array form intact.
		expect(resultContentFor(result.messages, "arr-6")).toEqual([{ type: "text", text: "block text 6" }])
	})

	it("only considers the effective history (ignores condensed-away messages)", () => {
		// 4 old read_file pairs that were condensed away (tagged + a summary), then
		// 3 recent read_file pairs. Effective compactable = 3 (<= keepRecent) -> no-op.
		const summaryId = "summary-1"
		const old: ApiMessage[] = []
		for (let i = 0; i < 4; i++) {
			const [a, u] = toolPair("read_file", `old ${i}`, `old-${i}`)
			a.condenseParent = summaryId
			u.condenseParent = summaryId
			old.push(a, u)
		}
		const summary: ApiMessage = {
			role: "user",
			content: [{ type: "text", text: "## Conversation Summary\nstuff" }],
			ts: 1000,
			isSummary: true,
			condenseId: summaryId,
		}
		const recent: ApiMessage[] = []
		for (let i = 0; i < 3; i++) {
			recent.push(...toolPair("read_file", `recent ${i}`, `recent-${i}`))
		}
		const messages = [firstUser(), ...old, summary, ...recent]

		const result = microcompactToolResults(messages)

		// Only 3 effective compactable results <= keepRecent(5) => nothing cleared.
		expect(result.clearedCount).toBe(0)
	})
})

// --- Integration with manageContext -------------------------------------------------

class MockApiHandler extends BaseProvider {
	createMessage(): any {
		const mockStream = {
			async *[Symbol.asyncIterator]() {
				yield { type: "text", text: "Mock summary content" }
				yield { type: "usage", inputTokens: 100, outputTokens: 50, totalCost: 0.01 }
			},
		}
		return mockStream
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "test-model",
			info: {
				contextWindow: 30000,
				maxTokens: 1000,
				supportsPromptCache: true,
				supportsImages: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "Test model",
			},
		}
	}
}

describe("manageContext microcompaction pre-pass", () => {
	const apiHandler = new MockApiHandler()
	const taskId = "microcompact-task"

	beforeEach(() => {
		counter = 0
		if (!TelemetryService.hasInstance()) {
			TelemetryService.createInstance([])
		}
	})

	function bigReadPairs(count: number, charsEach: number): ApiMessage[] {
		const out: ApiMessage[] = []
		for (let i = 0; i < count; i++) {
			out.push(...toolPair("read_file", "x".repeat(charsEach), `big-${i}`))
		}
		return out
	}

	it("takes the quiet path: microcompaction frees enough, so no summarization runs", async () => {
		// 10 large read results -> 5 cleared, freeing a large number of tokens.
		const messages = [firstUser(), ...bigReadPairs(10, 6000)]

		const result = await manageContext({
			messages,
			totalTokens: 16000, // ~53% of 30000 -> over the 50% threshold, under allowedTokens (~26000)
			contextWindow: 30000,
			maxTokens: 1000,
			apiHandler,
			autoCondenseContext: true,
			autoCondenseContextPercent: 50,
			systemPrompt: "sys",
			taskId,
			profileThresholds: {},
			currentProfileId: "default",
		})

		expect(result.microcompacted).toBe(true)
		expect(result.microcompactClearedCount).toBe(5)
		expect(result.summary).toBe("") // no summarization
		expect(result.truncationId).toBeUndefined() // no truncation
		// Non-destructive contract: stored history stays pristine (same reference);
		// the clearing decision is carried as ids and applied only at send time.
		expect(result.messages).toBe(messages) // pristine — nothing persisted
		expect(result.microcompactClearedToolUseIds).toHaveLength(5)
		expect(result.microcompactClearedToolUseIds).toContain("big-0")
		// The actual content in the (pristine) history is untouched.
		expect(resultContentFor(result.messages, "big-0")).not.toBe(MICROCOMPACT_CLEARED_PLACEHOLDER)
		expect(resultContentFor(result.messages, "big-0")).toContain("x")
	})

	it("escalates to summarization when microcompaction does not free enough", async () => {
		// Same large reads, but context is so far over that even after clearing we
		// remain above the condense threshold -> full summarization runs.
		const messages = [firstUser(), ...bigReadPairs(10, 6000)]

		const result = await manageContext({
			messages,
			totalTokens: 29000, // ~97% of 30000; even after clearing still over threshold
			contextWindow: 30000,
			maxTokens: 1000,
			apiHandler,
			autoCondenseContext: true,
			autoCondenseContextPercent: 50,
			systemPrompt: "sys",
			taskId,
			profileThresholds: {},
			currentProfileId: "default",
		})

		expect(result.microcompacted).toBe(true)
		expect(result.microcompactClearedCount).toBe(5)
		expect(result.summary).toBe("Mock summary content") // summarization ran
	})
})
