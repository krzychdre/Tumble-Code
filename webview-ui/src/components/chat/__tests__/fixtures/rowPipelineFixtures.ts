// Sanitized chat histories that exercise every step of the chat-row pipeline:
// combining (command output, api_req_finished), the visibility filter, the
// batching of consecutive tool asks and the synthetic condensing row.
//
// Each fixture is a full `clineMessages` array as the host sends it: the first
// message is the task itself (TaskHeader shows it, the list never does).
// `expectedRows` is what the list renders, one line per row, in the format of
// `describeRow` below. The lines were recorded from ChatView before the
// pipeline moved into pure functions, so they pin the behavior of that code.

import type { ClineMessage } from "@roo-code/types"

// FNV-1a over the UTF-16 code units, printed as 8 hex digits. Enough to tell
// two texts apart in a characterization line without printing whole payloads.
export function hashText(text: string | undefined): string {
	let hash = 0x811c9dc5
	const value = text ?? ""
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i)
		hash = Math.imul(hash, 0x01000193) >>> 0
	}
	return hash.toString(16).padStart(8, "0")
}

// One characterization line per rendered row: ts, type, say or ask kind, text
// hash, plus "partial" for rows still streaming.
export function describeRow(message: Pick<ClineMessage, "ts" | "type" | "say" | "ask" | "text" | "partial">): string {
	const kind = message.type === "ask" ? message.ask : message.say
	return `${message.ts} ${message.type} ${kind} ${hashText(message.text)}${message.partial ? " partial" : ""}`
}

const task = (ts: number): ClineMessage => ({ type: "say", say: "text", ts, text: "Sanitized task" })

const tool = (ts: number, payload: Record<string, unknown>): ClineMessage => ({
	type: "ask",
	ask: "tool",
	ts,
	text: JSON.stringify(payload),
	partial: false,
})

const text = (ts: number, value: string, extra: Partial<ClineMessage> = {}): ClineMessage => ({
	type: "say",
	say: "text",
	ts,
	text: value,
	partial: false,
	...extra,
})

const apiReqStarted = (ts: number, info: Record<string, unknown> = { cost: 0.01 }): ClineMessage => ({
	type: "say",
	say: "api_req_started",
	ts,
	text: JSON.stringify({ request: "sanitized request", ...info }),
})

export interface RowPipelineFixture {
	name: string
	messages: ClineMessage[]
	expectedRows: string[]
}

// Runs of read_file, list_files and file-edit asks, each batched into one row;
// single asks, already batched asks and asks with broken JSON pass through.
export const toolBatchingFixture: RowPipelineFixture = {
	name: "consecutive read_file, list_files and edit asks",
	messages: [
		task(1000),
		apiReqStarted(1001),
		tool(1002, { tool: "readFile", path: "src/a.ts", content: "a", reason: "lines 1-10" }),
		tool(1003, { tool: "readFile", path: "src/b.ts", content: "b" }),
		tool(1004, { tool: "readFile", path: "src/c.ts", content: "c", isOutsideWorkspace: true }),
		text(1005, "Now listing directories."),
		tool(1006, { tool: "listFilesTopLevel", path: "src", content: "a.ts\nb.ts" }),
		tool(1007, { tool: "listFilesRecursive", path: "docs", content: "x.md" }),
		text(1008, "Now editing."),
		tool(1009, { tool: "appliedDiff", path: "src/a.ts", diff: "-a\n+A", diffStats: { added: 1, removed: 1 } }),
		tool(1010, { tool: "newFileCreated", path: "src/d.ts", content: "d" }),
		tool(1011, { tool: "editedExistingFile", path: "src/b.ts", content: "B" }),
		text(1012, "A single read and an already batched read follow."),
		tool(1013, { tool: "readFile", path: "src/single.ts", content: "s" }),
		text(1014, "Separator."),
		tool(1015, { tool: "readFile", path: "src/e.ts", batchFiles: [{ path: "src/e.ts" }] }),
		tool(1016, { tool: "readFile", path: "src/f.ts", content: "f" }),
		{ type: "ask", ask: "tool", ts: 1017, text: "{not json", partial: false },
		tool(1018, { tool: "readFile", path: "src/g.ts", content: "g" }),
	],
	expectedRows: [
		"1001 say api_req_started 71c5f6d8",
		"1002 ask tool bfe6a9ed",
		"1005 say text 9ddecfce",
		"1006 ask tool ce1625d9",
		"1008 say text 6e9e45e3",
		"1009 ask tool d7b1e9b7",
		"1012 say text 7e40573a",
		"1013 ask tool 9a047ed2",
		"1014 say text eebc2976",
		"1015 ask tool 698b3c7a",
		"1016 ask tool 19558857",
		"1017 ask tool 16f075a3",
		"1018 ask tool 6399576d",
	],
}

// checkpoint_saved rows: hidden when flagged suppressMessage or when a user
// message carries the same checkpoint hash (legacy), shown otherwise.
export const checkpointFixture: RowPipelineFixture = {
	name: "checkpoint_saved with and without suppressMessage",
	messages: [
		task(2000),
		apiReqStarted(2001),
		{
			type: "say",
			say: "checkpoint_saved",
			ts: 2002,
			text: "hash-suppressed",
			checkpoint: { suppressMessage: true },
		},
		text(2003, "First step done."),
		{ type: "say", say: "checkpoint_saved", ts: 2004, text: "hash-visible", checkpoint: { from: "a", to: "b" } },
		{
			type: "say",
			say: "user_feedback",
			ts: 2005,
			text: "Please continue.",
			checkpoint: { type: "user_message", hash: "hash-user" },
		},
		{ type: "say", say: "checkpoint_saved", ts: 2006, text: "hash-user" },
		text(2007, "Second step done."),
	],
	expectedRows: [
		"2001 say api_req_started 71c5f6d8",
		"2003 say text b5536f73",
		"2004 say checkpoint_saved 878106f6",
		"2005 say user_feedback dfe08a22",
		"2007 say text ac3deecf",
	],
}

// api_req_retry_delayed is shown only as the last message, or right before a
// trailing resume_task ask; everywhere else it is hidden.
export const retryDelayedLastFixture: RowPipelineFixture = {
	name: "api_req_retry_delayed as the last message",
	messages: [
		task(3000),
		apiReqStarted(3001, {}),
		{ type: "say", say: "api_req_retry_delayed", ts: 3002, text: "Retrying in 5 seconds", partial: true },
	],
	expectedRows: ["3001 say api_req_started b25012b6", "3002 say api_req_retry_delayed feb0bb14 partial"],
}

export const retryDelayedNotLastFixture: RowPipelineFixture = {
	name: "api_req_retry_delayed followed by more messages",
	messages: [
		task(3100),
		apiReqStarted(3101),
		{ type: "say", say: "api_req_retry_delayed", ts: 3102, text: "Retrying in 5 seconds", partial: false },
		text(3103, "The retry went through."),
	],
	expectedRows: ["3101 say api_req_started 71c5f6d8", "3103 say text db22d729"],
}

export const retryDelayedBeforeResumeFixture: RowPipelineFixture = {
	name: "api_req_retry_delayed right before a resume_task ask",
	messages: [
		task(3200),
		apiReqStarted(3201, {}),
		{ type: "say", say: "api_req_retry_delayed", ts: 3202, text: "Retrying in 5 seconds", partial: false },
		{ type: "ask", ask: "resume_task", ts: 3203, text: "" },
	],
	expectedRows: ["3201 say api_req_started b25012b6", "3202 say api_req_retry_delayed feb0bb14"],
}

// completion_result asks with an empty text are hidden, others shown; plus the
// other always-hidden kinds and the combining of command output and
// api_req_finished into earlier rows.
export const completionAndHiddenKindsFixture: RowPipelineFixture = {
	name: "completion_result with empty text and always-hidden kinds",
	messages: [
		task(4000),
		apiReqStarted(4001),
		{ type: "say", say: "api_req_finished", ts: 4002, text: JSON.stringify({ cost: 0.02 }) },
		{ type: "ask", ask: "command", ts: 4003, text: "ls -la", partial: false },
		{ type: "ask", ask: "command_output", ts: 4004, text: "" },
		{ type: "say", say: "command_output", ts: 4005, text: "total 0" },
		text(4006, ""),
		{ type: "say", say: "mcp_server_request_started", ts: 4007, text: "" },
		{ type: "say", say: "api_req_retried", ts: 4008 },
		{ type: "say", say: "api_req_deleted", ts: 4009 },
		{ type: "ask", ask: "api_req_failed", ts: 4010, text: "Request failed" },
		text(4011, "", { images: ["data:image/png;base64,AAAA"] }),
		{ type: "say", say: "completion_result", ts: 4012, text: "All done." },
		{ type: "ask", ask: "completion_result", ts: 4013, text: "" },
	],
	expectedRows: [
		"4001 say api_req_started 71bda813",
		"4003 ask command 669fdedf",
		"4011 say text 811c9dc5",
		"4012 say completion_result 17422266",
	],
}

export const completionWithTextFixture: RowPipelineFixture = {
	name: "completion_result ask with text",
	messages: [
		task(4100),
		apiReqStarted(4101),
		{ type: "ask", ask: "completion_result", ts: 4102, text: "Summary of the result." },
	],
	expectedRows: ["4101 say api_req_started 71c5f6d8", "4102 ask completion_result 874e941e"],
}

export const rowPipelineFixtures: RowPipelineFixture[] = [
	toolBatchingFixture,
	checkpointFixture,
	retryDelayedLastFixture,
	retryDelayedNotLastFixture,
	retryDelayedBeforeResumeFixture,
	completionAndHiddenKindsFixture,
	completionWithTextFixture,
]
