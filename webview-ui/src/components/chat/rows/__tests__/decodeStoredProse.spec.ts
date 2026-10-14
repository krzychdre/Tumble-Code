// pnpm --filter @tumble-code/vscode-webview test src/components/chat/rows/__tests__/decodeStoredProse.spec.ts

import type { ClineMessage } from "@tumble-code/types"

import { decodeProseTool, decodeStoredProse } from "../decodeStoredProse"

const ESCAPED = "Dok\\u0142adnie"
const DECODED = "Dokładnie"

describe("decodeStoredProse", () => {
	it("decodes the text of completion and subtask results", () => {
		const say = (kind: "completion_result" | "subtask_result"): ClineMessage => ({
			ts: 1,
			type: "say",
			say: kind,
			text: ESCAPED,
		})

		expect(decodeStoredProse(say("completion_result")).text).toBe(DECODED)
		expect(decodeStoredProse(say("subtask_result")).text).toBe(DECODED)
	})

	it("returns the same object when there is nothing to decode", () => {
		const message: ClineMessage = { ts: 1, type: "say", say: "completion_result", text: DECODED }

		expect(decodeStoredProse(message)).toBe(message)
	})

	it("leaves prose of other kinds and partial follow-ups alone", () => {
		const text: ClineMessage = { ts: 1, type: "say", say: "text", text: ESCAPED }
		const partial: ClineMessage = { ts: 2, type: "ask", ask: "followup", text: ESCAPED, partial: true }

		expect(decodeStoredProse(text)).toBe(text)
		expect(decodeStoredProse(partial)).toBe(partial)
	})

	it("decodes the question and answers of a follow-up and keeps the other fields", () => {
		const message: ClineMessage = {
			ts: 1,
			type: "ask",
			ask: "followup",
			text: JSON.stringify({ question: ESCAPED, suggest: [{ answer: ESCAPED, mode: "code" }] }),
		}

		expect(JSON.parse(decodeStoredProse(message).text!)).toEqual({
			question: DECODED,
			suggest: [{ answer: DECODED, mode: "code" }],
		})
	})

	it("returns a follow-up that is not JSON unchanged", () => {
		const message: ClineMessage = { ts: 1, type: "ask", ask: "followup", text: ESCAPED }

		expect(decodeStoredProse(message)).toBe(message)
	})
})

describe("decodeProseTool", () => {
	it("decodes subtask instructions, mode switch reasons and todo items", () => {
		expect(decodeProseTool({ tool: "newTask", mode: "code", content: ESCAPED }).content).toBe(DECODED)
		expect(decodeProseTool({ tool: "switchMode", mode: "code", reason: ESCAPED }).reason).toBe(DECODED)
		expect(
			decodeProseTool({ tool: "updateTodoList", todos: [{ id: "1", content: ESCAPED, status: "pending" }] })
				.todos,
		).toEqual([{ id: "1", content: DECODED, status: "pending" }])
	})

	it("returns file and command payloads as the same object", () => {
		const write = { tool: "newFileCreated", path: "a.js", content: "const s = '\\u0142'" }

		expect(decodeProseTool(write)).toBe(write)
		expect(decodeProseTool(undefined)).toBeUndefined()
	})
})
