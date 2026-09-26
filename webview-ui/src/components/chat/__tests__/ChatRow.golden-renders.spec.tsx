// Golden renders of ChatRowContent: one or more fixed messages per say kind,
// ask kind and tool kind, each snapshotted as the row's innerHTML.
//
// These pin the visible output of every branch of ChatRowContent before its
// renderers move into a registry (refactor plan WEB-2b). The move must leave
// every snapshot byte-identical; a deliberate visual change updates the
// snapshot in its own commit with the reason in the message.
//
// The expected HTML lives in __golden__/ChatRow.golden.json (vitest's own
// snapshot state is not available with this repo's linked node_modules).
// Regenerate it with UPDATE_GOLDEN=1 and review the diff before committing.
//
// Determinism: translations render as their key plus the interpolation
// values, the extension state is a fixed object, token counts stay below 1000
// (the context rows format them with toLocaleString), and the children
// that depend on the wall clock, on async highlighting or on web components
// (BlockTimestamp, CodeBlock, the VS Code toolkit) are stubs that print the props they receive.

import fs from "fs"
import path from "path"
import React from "react"
import { render } from "@/utils/test-utils"
import type { ClineMessage, HistoryItem } from "@roo-code/types"

import { ChatRowContent } from "../ChatRow"
import type { RowMetaEntry } from "../rows/computeRowMeta"

vi.mock("@src/utils/vscode", () => ({
	vscode: { postMessage: vi.fn() },
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) =>
			options && Object.keys(options).length > 0 ? `${key} ${JSON.stringify(options)}` : key,
		i18n: { exists: (key: string) => key === "chat:apiRequest.errorMessage.429" },
	}),
	Trans: ({
		i18nKey,
		values,
		components,
	}: {
		i18nKey: string
		values?: Record<string, unknown>
		components?: Record<string, React.ReactElement>
	}) => (
		<span data-trans={i18nKey} data-values={values ? JSON.stringify(values) : undefined}>
			{components ? Object.values(components).map((c, i) => <React.Fragment key={i}>{c}</React.Fragment>) : null}
		</span>
	),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// The toolkit's web components (FAST) are replaced by plain elements named
// after the component; the real ones hung the worker after enough renders.
vi.mock("@vscode/webview-ui-toolkit/react", async () => {
	const React = await import("react")
	const stub = (name: string) => {
		const Stub = ({ children, ...props }: { children?: React.ReactNode }) =>
			React.createElement("span", { "data-stub": name, ...props }, children)
		return Stub
	}
	return Object.fromEntries(
		["VSCodePanels", "VSCodePanelTab", "VSCodePanelView", "VSCodeProgressRing", "VSCodeTextField"].map((name) => [
			name,
			stub(name),
		]),
	)
})

vi.mock("../BlockTimestamp", () => ({
	BlockTimestamp: (props: { startTs: number; endTs?: number; live?: boolean }) => (
		<span
			data-stub="BlockTimestamp"
			data-start={props.startTs}
			data-end={props.endTs ?? ""}
			data-live={String(!!props.live)}
		/>
	),
}))

// A stub, so the golden records which todos each row hands the block (the
// block's own rendering is covered by UpdateTodoListToolBlock.spec.tsx).
vi.mock("../UpdateTodoListToolBlock", () => ({
	default: (props: { todos?: unknown[]; userEdited?: boolean; startTs?: number; endTs?: number }) => (
		<div
			data-stub="UpdateTodoListToolBlock"
			data-todos={props.todos === undefined ? "undefined" : JSON.stringify(props.todos)}
			data-user-edited={String(!!props.userEdited)}
			data-start={props.startTs}
			data-end={props.endTs ?? ""}
		/>
	),
}))

vi.mock("@src/components/common/CodeBlock", () => ({
	default: ({ source, language }: { source?: string; language?: string }) => (
		<pre data-stub="CodeBlock" data-language={language}>
			{source}
		</pre>
	),
}))

let mockCurrentTaskItem: Partial<HistoryItem> | undefined

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		mcpServers: [
			{
				name: "weather",
				config: "{}",
				status: "connected",
				tools: [{ name: "forecast", description: "Get the forecast", alwaysAllow: false }],
				resources: [{ uri: "weather://today", name: "Today", mimeType: "text/plain", description: "Today" }],
				resourceTemplates: [],
			},
		],
		alwaysAllowMcp: false,
		currentCheckpoint: "abc123",
		mode: "code",
		currentTaskItem: mockCurrentTaskItem,
		reasoningBlockCollapsed: true,
		autoApprovalEnabled: false,
		alwaysAllowFollowupQuestions: false,
		followupAutoApproveTimeoutMs: 60000,
		allowedCommands: [],
		deniedCommands: [],
		setAllowedCommands: () => {},
		setDeniedCommands: () => {},
		version: "1.0.0",
		apiConfiguration: {},
	}),
}))

const TS = 1_700_000_000_000

type Case = {
	name: string
	message: Partial<ClineMessage> & { type: "say" | "ask" }
	isExpanded?: boolean
	isLast?: boolean
	isStreaming?: boolean
	lastModifiedMessage?: Partial<ClineMessage>
	meta?: RowMetaEntry
	currentTaskItem?: Partial<HistoryItem>
}

const say = (kind: string, text?: string, extra: Partial<ClineMessage> = {}) =>
	({ type: "say", say: kind, ts: TS, text, ...extra }) as Case["message"]
const ask = (kind: string, text?: string, extra: Partial<ClineMessage> = {}) =>
	({ type: "ask", ask: kind, ts: TS, text, ...extra }) as Case["message"]
const toolAsk = (payload: Record<string, unknown>, extra: Partial<ClineMessage> = {}) =>
	ask("tool", JSON.stringify(payload), extra)
const toolSay = (payload: Record<string, unknown>) => say("tool", JSON.stringify(payload))

const DIFF = "@@ -1,2 +1,2 @@\n-old line\n+new line\n context"
const IMAGE = "data:image/png;base64,iVBORw0KGgo="

const TOOL_CASES: Case[] = [
	{ name: "editedExistingFile", message: toolAsk({ tool: "editedExistingFile", path: "src/a.ts", diff: DIFF }) },
	{
		name: "editedExistingFile expanded with diffStats",
		message: toolAsk({
			tool: "editedExistingFile",
			path: "src/a.ts",
			content: DIFF,
			diffStats: { added: 1, removed: 1 },
		}),
		isExpanded: true,
	},
	{
		name: "appliedDiff protected",
		message: toolAsk({ tool: "appliedDiff", path: ".roomodes", diff: DIFF, isProtected: true }),
	},
	{
		name: "newFileCreated outside workspace markdown",
		message: toolAsk({
			tool: "newFileCreated",
			path: "../docs/plan.md",
			content: "# Plan",
			isOutsideWorkspace: true,
		}),
	},
	{ name: "searchAndReplace", message: toolAsk({ tool: "searchAndReplace", path: "src/b.ts", diff: DIFF }) },
	{ name: "search_and_replace", message: toolAsk({ tool: "search_and_replace", path: "src/b.ts", diff: DIFF }) },
	{ name: "search_replace", message: toolAsk({ tool: "search_replace", path: "src/b.ts", diff: DIFF }) },
	{ name: "edit", message: toolAsk({ tool: "edit", path: "src/b.ts", diff: DIFF }, { partial: true }) },
	{ name: "edit_file", message: toolAsk({ tool: "edit_file", path: "src/b.ts", diff: DIFF }) },
	{ name: "apply_patch", message: toolAsk({ tool: "apply_patch", path: "src/b.ts", diff: DIFF }) },
	{
		name: "apply_diff batch",
		message: toolAsk({
			tool: "apply_diff",
			batchDiffs: [
				{ path: "src/a.ts", changeCount: 1, key: "a", content: DIFF, diffStats: { added: 1, removed: 1 } },
				{ path: "src/b.ts", changeCount: 2, key: "b", content: DIFF },
			],
		}),
	},
	{
		name: "insertContent at end",
		message: toolAsk({ tool: "insertContent", path: "src/c.ts", diff: DIFF, lineNumber: 0 }),
	},
	{
		name: "insertContent at line",
		message: toolAsk({ tool: "insertContent", path: "src/c.ts", diff: DIFF, lineNumber: 5 }),
	},
	{
		name: "insertContent protected",
		message: toolAsk({ tool: "insertContent", path: ".roomodes", diff: DIFF, lineNumber: 5, isProtected: true }),
	},
	{ name: "codebaseSearch", message: toolAsk({ tool: "codebaseSearch", query: "auth flow" }) },
	{
		name: "codebaseSearch with path",
		message: toolAsk({ tool: "codebaseSearch", query: "auth flow", path: "src/auth" }),
	},
	{ name: "webSearch", message: toolAsk({ tool: "webSearch", queries: ["vitest snapshot", "react 18"] }) },
	{ name: "webSearch without queries", message: toolAsk({ tool: "webSearch" }) },
	{ name: "webFetch", message: toolAsk({ tool: "webFetch", fetchedUrl: "https://example.com/page" }) },
	{
		name: "updateTodoList",
		message: toolAsk({
			tool: "updateTodoList",
			todos: [
				{ id: "1", content: "Write tests", status: "completed" },
				{ id: "2", content: "Move renderers", status: "in_progress" },
			],
		}),
		meta: {
			nextTs: TS + 4200,
			previousTodos: [{ id: "1", content: "Write tests", status: "in_progress" }],
			newTaskIndex: undefined,
			followedBySubtaskResult: false,
		},
	},
	{
		name: "readFile",
		message: toolAsk({ tool: "readFile", path: "src/a.ts", content: "/work/src/a.ts", startLine: 10 }),
	},
	{
		name: "readFile dot path with reason",
		message: toolAsk({
			tool: "readFile",
			path: ".env.example",
			content: "/work/.env.example",
			reason: "lines 1-20",
		}),
	},
	{
		name: "readFile outside workspace",
		message: toolAsk({ tool: "readFile", path: "../x.ts", content: "/x.ts", isOutsideWorkspace: true }),
	},
	{
		name: "readFile and more",
		message: toolAsk({ tool: "readFile", path: "src/a.ts", content: "/work/src/a.ts", additionalFileCount: 2 }),
	},
	{
		name: "readFile batch",
		message: toolAsk({
			tool: "readFile",
			batchFiles: [
				{ path: "src/a.ts", lineSnippet: "", key: "a", content: "/work/src/a.ts" },
				{ path: "src/b.ts", lineSnippet: "lines 1-5", key: "b", content: "/work/src/b.ts" },
			],
		}),
	},
	{ name: "skill", message: toolAsk({ tool: "skill", skill: "pdf", source: "global" }) },
	{
		name: "skill expanded",
		message: toolAsk({
			tool: "skill",
			skill: "pdf",
			source: "project",
			args: "report.pdf",
			description: "Read PDFs",
		}),
		isExpanded: true,
	},
	{
		name: "listFilesTopLevel",
		message: toolAsk({ tool: "listFilesTopLevel", path: "src", content: "a.ts\nb.ts" }),
		isExpanded: true,
	},
	{
		name: "listFilesTopLevel outside workspace",
		message: toolAsk({ tool: "listFilesTopLevel", path: "..", content: "x", isOutsideWorkspace: true }),
	},
	{
		name: "listFilesRecursive",
		message: toolAsk({ tool: "listFilesRecursive", path: "src", content: "a.ts\nsub/b.ts" }),
		isExpanded: true,
	},
	{
		name: "listFilesRecursive outside workspace",
		message: toolAsk({ tool: "listFilesRecursive", path: "..", content: "x", isOutsideWorkspace: true }),
	},
	{
		name: "searchFiles",
		message: toolAsk({ tool: "searchFiles", path: "src", regex: "TODO", filePattern: "*.ts", content: "a.ts:1" }),
		isExpanded: true,
	},
	{
		name: "searchFiles outside workspace",
		message: toolAsk({ tool: "searchFiles", path: "..", regex: "FIXME", content: "", isOutsideWorkspace: true }),
	},
	{ name: "switchMode", message: toolAsk({ tool: "switchMode", mode: "architect" }) },
	{
		name: "switchMode with reason",
		message: toolAsk({ tool: "switchMode", mode: "architect", reason: "plan first" }),
	},
	{
		name: "newTask with child link",
		message: toolAsk({ tool: "newTask", mode: "code", content: "Implement **the** thing" }),
		meta: { nextTs: undefined, previousTodos: [], newTaskIndex: 0, followedBySubtaskResult: false },
		currentTaskItem: { id: "parent", childIds: ["child-1"] },
	},
	{
		name: "newTask followed by subtask result",
		message: toolAsk({ tool: "newTask", mode: "code", content: "Implement the thing" }),
		meta: { nextTs: undefined, previousTodos: [], newTaskIndex: 0, followedBySubtaskResult: true },
		currentTaskItem: { id: "parent", childIds: ["child-1"] },
	},
	{ name: "finishTask", message: toolAsk({ tool: "finishTask" }) },
	{ name: "reviewPlan", message: toolAsk({ tool: "reviewPlan", path: "plans/p.md" }) },
	{ name: "reviewPlan without path", message: toolAsk({ tool: "reviewPlan" }) },
	{ name: "runSlashCommand", message: toolAsk({ tool: "runSlashCommand", command: "init" }) },
	{
		name: "runSlashCommand expanded",
		message: toolAsk({
			tool: "runSlashCommand",
			command: "test",
			args: "focus on unit tests",
			description: "Run project tests",
			source: "project",
		}),
		isExpanded: true,
	},
	{
		name: "generateImage",
		message: toolAsk({ tool: "generateImage", path: "img/cat.png", content: "a cat" }),
	},
	{
		name: "generateImage protected",
		message: toolAsk({ tool: "generateImage", path: "img/cat.png", content: "a cat", isProtected: true }),
	},
	{
		name: "generateImage outside workspace",
		message: toolAsk({ tool: "generateImage", path: "../cat.png", content: "a cat", isOutsideWorkspace: true }),
	},
	{ name: "imageGenerated (no renderer)", message: toolAsk({ tool: "imageGenerated", path: "img/cat.png" }) },
]

const SAY_CASES: Case[] = [
	{ name: "error", message: say("error", "Something broke") },
	{ name: "error without text", message: say("error") },
	{ name: "error MODEL_NO_TOOLS_USED", message: say("error", "MODEL_NO_TOOLS_USED") },
	{ name: "error MODEL_NO_ASSISTANT_MESSAGES", message: say("error", "MODEL_NO_ASSISTANT_MESSAGES") },
	{
		name: "api_req_started in progress (last)",
		message: say("api_req_started", JSON.stringify({ request: "..." })),
		isLast: true,
	},
	{
		name: "api_req_started not last, no cost",
		message: say("api_req_started", JSON.stringify({ request: "..." })),
		meta: { nextTs: TS + 1500, previousTodos: [], newTaskIndex: undefined, followedBySubtaskResult: false },
	},
	{
		name: "api_req_started with cost",
		message: say("api_req_started", JSON.stringify({ request: "...", cost: 0.0123 })),
		meta: { nextTs: TS + 1500, previousTodos: [], newTaskIndex: undefined, followedBySubtaskResult: false },
	},
	{
		name: "api_req_started zero cost",
		message: say("api_req_started", JSON.stringify({ request: "...", cost: 0 })),
	},
	{
		name: "api_req_started user cancelled",
		message: say("api_req_started", JSON.stringify({ cancelReason: "user_cancelled" })),
	},
	{
		name: "api_req_started streaming failed",
		message: say(
			"api_req_started",
			JSON.stringify({ cancelReason: "streaming_failed", streamingFailedMessage: "socket hang up" }),
		),
	},
	{
		name: "api_req_started failed (last is api_req_failed)",
		message: say("api_req_started", JSON.stringify({ request: "..." })),
		isLast: true,
		lastModifiedMessage: { type: "ask", ask: "api_req_failed", ts: TS + 1, text: "PowerShell is not recognized" },
	},
	{ name: "api_req_started without text", message: say("api_req_started") },
	{ name: "api_req_finished", message: say("api_req_finished", "{}") },
	{ name: "api_req_retried (default)", message: say("api_req_retried") },
	{
		name: "api_req_retry_delayed known code",
		message: say("api_req_retry_delayed", "429 Too many requests<retry_timer>12</retry_timer>"),
	},
	{ name: "api_req_retry_delayed unknown code", message: say("api_req_retry_delayed", "503 Service unavailable") },
	{ name: "api_req_retry_delayed no code", message: say("api_req_retry_delayed", "connection reset") },
	{ name: "api_req_retry_delayed without text", message: say("api_req_retry_delayed") },
	{
		name: "api_req_rate_limit_wait waiting",
		message: say("api_req_rate_limit_wait", JSON.stringify({ seconds: 7 }), { partial: true }),
	},
	{ name: "api_req_rate_limit_wait done", message: say("api_req_rate_limit_wait", JSON.stringify({ seconds: 7 })) },
	{ name: "api_req_deleted (default)", message: say("api_req_deleted") },
	{ name: "text", message: say("text", "Hello **world**\n\n- item") },
	{ name: "text partial with images", message: say("text", "Streaming", { partial: true, images: [IMAGE] }) },
	{
		name: "image",
		message: say("image", JSON.stringify({ imageUri: "vscode-resource://img.png", imagePath: "/w/img.png" })),
	},
	{ name: "image invalid", message: say("image", "not json") },
	{
		name: "reasoning",
		message: say("reasoning", "Thinking about it"),
		meta: { nextTs: TS + 3000, previousTodos: [], newTaskIndex: undefined, followedBySubtaskResult: false },
	},
	{ name: "completion_result", message: say("completion_result", "All done.") },
	{ name: "completion_result partial", message: say("completion_result", "All do", { partial: true }) },
	{ name: "user_feedback", message: say("user_feedback", "Please fix @/src/a.ts", { images: [IMAGE] }) },
	{ name: "user_feedback while streaming", message: say("user_feedback", "Stop"), isStreaming: true },
	{
		name: "user_feedback_diff",
		message: say("user_feedback_diff", JSON.stringify({ tool: "appliedDiff", diff: DIFF })),
	},
	{ name: "command_output (default)", message: say("command_output", "npm test output") },
	{ name: "shell_integration_warning", message: say("shell_integration_warning") },
	{ name: "mcp_server_request_started (default)", message: say("mcp_server_request_started") },
	{ name: "mcp_server_response (default)", message: say("mcp_server_response", '{"temp": 21}') },
	{ name: "subtask_result", message: say("subtask_result", "Child finished") },
	{
		name: "subtask_result with child link",
		message: say("subtask_result", "Child finished"),
		currentTaskItem: { id: "parent", completedByChildId: "child-1" },
	},
	{ name: "checkpoint_saved", message: say("checkpoint_saved", "abc123", { checkpoint: { from: "a", to: "b" } }) },
	{ name: "checkpoint_saved not current", message: say("checkpoint_saved", "def456") },
	{ name: "rooignore_error (default)", message: say("rooignore_error", "secret.txt") },
	{ name: "diff_error", message: say("diff_error", "No match found") },
	{ name: "condense_context partial", message: say("condense_context", undefined, { partial: true }) },
	{
		name: "condense_context done",
		message: say("condense_context", undefined, {
			contextCondense: { cost: 0.01, prevContextTokens: 900, newContextTokens: 200, summary: "Summary" },
		}),
	},
	{ name: "condense_context empty", message: say("condense_context") },
	{ name: "condense_context_error", message: say("condense_context_error", "Too short") },
	{
		name: "sliding_window_truncation partial",
		message: say("sliding_window_truncation", undefined, { partial: true }),
	},
	{
		name: "sliding_window_truncation done",
		message: say("sliding_window_truncation", undefined, {
			contextTruncation: {
				truncationId: "t1",
				messagesRemoved: 4,
				prevContextTokens: 900,
				newContextTokens: 600,
			},
		}),
	},
	{ name: "sliding_window_truncation empty", message: say("sliding_window_truncation") },
	{
		name: "context_pruned",
		message: say("context_pruned", undefined, {
			contextPrune: { prunedCount: 3, bytesSaved: 12000, prevContextTokens: 900, newContextTokens: 700 },
		}),
	},
	{ name: "context_pruned empty", message: say("context_pruned") },
	{
		name: "codebase_search_result",
		message: say(
			"codebase_search_result",
			JSON.stringify({
				content: {
					query: "auth",
					results: [{ filePath: "src/auth.ts", score: 0.91, startLine: 1, endLine: 9, codeChunk: "login()" }],
				},
			}),
		),
	},
	{ name: "codebase_search_result invalid", message: say("codebase_search_result", JSON.stringify({ other: 1 })) },
	{ name: "codebase_search_result unparsable", message: say("codebase_search_result", "{oops") },
	{
		name: "user_edit_todos",
		message: say(
			"user_edit_todos",
			JSON.stringify({ tool: "updateTodoList", todos: [{ id: "1", content: "Edited", status: "completed" }] }),
		),
		meta: { nextTs: TS + 900, previousTodos: [], newTaskIndex: undefined, followedBySubtaskResult: false },
	},
	{
		name: "too_many_tools_warning",
		message: say("too_many_tools_warning", JSON.stringify({ toolCount: 80, serverCount: 5, threshold: 40 })),
	},
	{ name: "too_many_tools_warning invalid", message: say("too_many_tools_warning", "not json") },
	{
		name: "tool runSlashCommand",
		message: toolSay({ tool: "runSlashCommand", command: "deploy", source: "global" }),
	},
	{
		name: "tool runSlashCommand full",
		message: toolSay({
			tool: "runSlashCommand",
			command: "test",
			args: "unit",
			description: "Run project tests",
			source: "project",
		}),
	},
	{ name: "tool searchTaskHistory", message: toolSay({ tool: "searchTaskHistory", query: "oauth" }) },
	{ name: "tool searchTaskHistory without query", message: toolSay({ tool: "searchTaskHistory" }) },
	{
		name: "tool readArtifact search",
		message: toolSay({ tool: "readArtifact", searchPattern: "ERROR", matchCount: 3 }),
	},
	{
		name: "tool readArtifact search one match",
		message: toolSay({ tool: "readArtifact", searchPattern: "ERROR", matchCount: 1 }),
	},
	{
		name: "tool readArtifact range",
		message: toolSay({ tool: "readArtifact", readStart: 0, readEnd: 2048, totalBytes: 5 * 1024 * 1024 }),
	},
	{ name: "tool readCommandOutput total", message: toolSay({ tool: "readCommandOutput", totalBytes: 512 }) },
	{ name: "tool readCommandOutput bare", message: toolSay({ tool: "readCommandOutput" }) },
	{ name: "tool unknown", message: toolSay({ tool: "readFile", path: "a.ts" }) },
	{ name: "tool unparsable", message: say("tool", "{oops") },
]

const ASK_CASES: Case[] = [
	{
		name: "followup",
		message: ask(
			"followup",
			JSON.stringify({
				question: "Which database?",
				suggest: [{ answer: "Postgres" }, { answer: "SQLite", mode: "architect" }],
			}),
		),
	},
	{ name: "followup partial", message: ask("followup", "Which data", { partial: true }) },
	{ name: "command", message: ask("command", "npm test") },
	{ name: "command expanded", message: ask("command", "npm test"), isExpanded: true },
	{
		name: "command executing (last)",
		message: ask("command", "npm test\nOutput:\nok"),
		isLast: true,
		lastModifiedMessage: { type: "ask", ask: "command", ts: TS, text: "npm test\nOutput:\nok" },
	},
	{ name: "command_output (default)", message: ask("command_output", "") },
	{ name: "completion_result", message: ask("completion_result", "Finished.") },
	{ name: "completion_result empty", message: ask("completion_result", "") },
	{ name: "api_req_failed (default)", message: ask("api_req_failed", "500") },
	{ name: "resume_task (default)", message: ask("resume_task") },
	{ name: "resume_completed_task (default)", message: ask("resume_completed_task") },
	{ name: "mistake_limit_reached", message: ask("mistake_limit_reached", "Too many mistakes") },
	{
		name: "use_mcp_server tool",
		message: ask(
			"use_mcp_server",
			JSON.stringify({
				type: "use_mcp_tool",
				serverName: "weather",
				toolName: "forecast",
				arguments: '{"city":"Oslo"}',
			}),
		),
	},
	{
		name: "use_mcp_server tool responding (last)",
		message: ask(
			"use_mcp_server",
			JSON.stringify({ type: "use_mcp_tool", serverName: "weather", toolName: "forecast", arguments: "{}" }),
		),
		isLast: true,
		lastModifiedMessage: { type: "say", say: "mcp_server_request_started", ts: TS + 1 },
	},
	{
		name: "use_mcp_server resource",
		message: ask(
			"use_mcp_server",
			JSON.stringify({ type: "access_mcp_resource", serverName: "weather", uri: "weather://today" }),
		),
	},
	{
		name: "use_mcp_server unknown resource",
		message: ask(
			"use_mcp_server",
			JSON.stringify({ type: "access_mcp_resource", serverName: "other", uri: "x://y" }),
		),
	},
	{ name: "use_mcp_server unparsable", message: ask("use_mcp_server", "{oops") },
	{
		name: "auto_approval_max_req_reached",
		message: ask("auto_approval_max_req_reached", JSON.stringify({ count: 20, type: "requests" })),
	},
]

// Radix and React generate ids per render order (":r1:"); normalize them so a
// snapshot does not depend on how many components rendered before it.
// styled-components names its classes after a per-process counter of styled
// components, which depends on module load order; a registry move changes that
// order without changing any output, so the generated names are masked too.
const normalize = (html: string) =>
	html.replace(/:r[0-9a-z]+:/g, ":r:").replace(/\bsc-[A-Za-z0-9]+ [A-Za-z0-9]+\b/g, "sc-styled")

function renderCase(c: Case) {
	mockCurrentTaskItem = c.currentTaskItem
	const { container, unmount } = render(
		<ChatRowContent
			message={c.message as ClineMessage}
			lastModifiedMessage={c.lastModifiedMessage as ClineMessage | undefined}
			isExpanded={c.isExpanded ?? false}
			isLast={c.isLast ?? false}
			isStreaming={c.isStreaming ?? false}
			supportsImages={true}
			onToggleExpand={() => {}}
			onSuggestionClick={() => {}}
			onBatchFileResponse={() => {}}
			onFollowUpUnmount={() => {}}
			isFollowUpAnswered={false}
			meta={c.meta}
		/>,
	)
	const html = normalize(container.innerHTML)
	unmount()
	return html
}

const GOLDEN_FILE = path.join(__dirname, "__golden__", "ChatRow.golden.json")
const UPDATE = process.env.UPDATE_GOLDEN === "1"
const golden: Record<string, string> = fs.existsSync(GOLDEN_FILE)
	? JSON.parse(fs.readFileSync(GOLDEN_FILE, "utf8"))
	: {}
const actual: Record<string, string> = {}

const GROUPS = [
	["tool asks", TOOL_CASES],
	["say", SAY_CASES],
	["ask", ASK_CASES],
] as const

describe("ChatRowContent golden renders", () => {
	afterAll(() => {
		if (UPDATE) {
			fs.mkdirSync(path.dirname(GOLDEN_FILE), { recursive: true })
			fs.writeFileSync(GOLDEN_FILE, JSON.stringify(actual, null, "\t") + "\n")
		}
	})

	it("has a unique name for every case", () => {
		const names = GROUPS.flatMap(([group, cases]) => cases.map((c) => `${group} > ${c.name}`))
		expect(new Set(names).size).toBe(names.length)
	})

	for (const [group, cases] of GROUPS) {
		describe(group, () => {
			it.each(cases.map((c) => [c.name, c] as const))("%s", (name, c) => {
				const key = `${group} > ${name}`
				const html = renderCase(c)
				actual[key] = html
				if (!UPDATE) {
					expect(html).toBe(golden[key])
				}
			})
		})
	}
})
