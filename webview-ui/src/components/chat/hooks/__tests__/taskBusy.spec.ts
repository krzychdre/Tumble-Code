import type { ClineMessage } from "@tumble-code/types"

import { isTaskBusy } from "../taskBusy"

const say = (kind: ClineMessage["say"], extra: Partial<ClineMessage> = {}): ClineMessage => ({
	type: "say",
	say: kind,
	ts: 10,
	...extra,
})

const ask = (kind: ClineMessage["ask"], extra: Partial<ClineMessage> = {}): ClineMessage => ({
	type: "ask",
	ask: kind,
	ts: 10,
	...extra,
})

describe("isTaskBusy", () => {
	it("is idle without a task", () => {
		expect(isTaskBusy(undefined, false, undefined)).toBe(false)
	})

	it("is busy while streaming, even on an ask", () => {
		expect(isTaskBusy(say("text", { partial: true }), true, undefined)).toBe(true)
		expect(isTaskBusy(ask("followup"), true, undefined)).toBe(true)
	})

	it.each([
		["the task message alone", say("text", { text: "the task" })],
		["a finished LLM request", say("api_req_started", { text: JSON.stringify({ cost: 0.01 }) })],
		["an MCP call", say("mcp_server_request_started")],
		["a retry countdown", say("api_req_retry_delayed")],
		["a rate-limit wait", say("api_req_rate_limit_wait")],
		["a condense in progress", say("condense_context", { partial: true })],
		["a tool result", say("text", { text: "done" })],
		["a running command (command_output ask)", ask("command_output")],
		["a partial ask", ask("tool", { partial: true })],
		["an ask the host auto-approved", ask("command", { isAnswered: true })],
	])("is busy on %s", (_name, last) => {
		expect(isTaskBusy(last, false, undefined)).toBe(true)
	})

	it.each([
		["tool approval", ask("tool")],
		["command approval", ask("command")],
		["MCP approval", ask("use_mcp_server")],
		["follow-up question", ask("followup")],
		["completion_result", ask("completion_result")],
		["resume_task", ask("resume_task")],
		["resume_completed_task", ask("resume_completed_task")],
		["api_req_failed", ask("api_req_failed")],
		["mistake_limit_reached", ask("mistake_limit_reached")],
		["auto_approval_max_req_reached", ask("auto_approval_max_req_reached")],
	])("is idle while a %s ask waits on the user", (_name, last) => {
		expect(isTaskBusy(last, false, undefined)).toBe(false)
	})

	it("is busy once the user answered the last ask from the view", () => {
		expect(isTaskBusy(ask("command", { ts: 10 }), false, 10)).toBe(true)
		// An answer to an older ask does not cover a new one.
		expect(isTaskBusy(ask("command", { ts: 11 }), false, 10)).toBe(false)
	})
})
