import { customToolRegistry } from "@roo-code/core"

import { NativeToolCallParser } from "../NativeToolCallParser"
import type { DispatchableToolName } from "../../tools/toolDescriptors"

/**
 * Characterization snapshots of the argument parsing in NativeToolCallParser (CORE-R4 c).
 *
 * For every tool (and the aliases) this pins two things, bugs and asymmetries included:
 * - the partial parse: the arguments JSON is fed in growing chunks through
 *   `processStreamingChunk`, and every partial ToolUse (or null) is recorded, followed by
 *   what `finalizeStreamingToolCall` returns;
 * - the complete parse: `parseToolCall` on the whole arguments string, including the
 *   malformed and loosely typed inputs weak models (GLM, Qwen, local Llamas) send:
 *   strings for numbers and booleans, stringified arrays, legacy parameter names,
 *   missing required fields, unknown parameters, broken JSON.
 *
 * The snapshots must stay byte-identical across the refactor that moves the two parser
 * switches into per-tool `parseArgs` functions.
 */

type Case = { label: string; args: Record<string, unknown> | string }

const CASES: Record<DispatchableToolName | "write_file", Case[]> = {
	read_file: [
		{ label: "new format, slice", args: { path: "src/app.ts", mode: "slice", offset: 10, limit: 50 } },
		{
			label: "numbers and booleans as strings (weak model)",
			args: {
				path: "src/app.ts",
				mode: "indentation",
				offset: "10",
				limit: " 25 ",
				indentation: {
					anchor_line: "42",
					max_levels: "2",
					max_lines: "abc",
					include_siblings: "TRUE",
					include_header: " false ",
				},
			},
		},
		{ label: "indentation not an object", args: { path: "a.ts", indentation: "yes", offset: Infinity } },
		{ label: "numbers that are not finite", args: { path: "a.ts", offset: "NaN", limit: "" } },
		{
			label: "legacy files array with every line_ranges shape",
			args: {
				files: [
					{ path: "a.ts", line_ranges: [[1, 50], ["60", "70"], [5]] },
					{ path: "b.ts", line_ranges: [{ start: "3", end: 9 }, { start: 1 }] },
					{ path: "c.ts", line_ranges: ["1-20", "30 - 40", "x-y", 7] },
					{ path: "d.ts", line_ranges: "1-5" },
					{ path: "e.ts" },
				],
			},
		},
		{
			label: "legacy files double-stringified",
			args: { files: JSON.stringify([{ path: "a.ts", line_ranges: ["1-2"] }]) },
		},
		{ label: "legacy files stringified but not JSON, with path", args: { files: "a.ts", path: "b.ts" } },
		{ label: "legacy files stringified object", args: { files: JSON.stringify({ path: "a.ts" }) } },
		{ label: "legacy files empty array falls back to path", args: { files: [], path: "p.ts" } },
		{ label: "legacy files wins over path", args: { files: [{ path: "a.ts" }], path: "p.ts" } },
		{ label: "no path, no files", args: { mode: "slice" } },
	],
	read_artifact: [
		{ label: "full", args: { artifact_id: "cmd-1.txt", search: "error", offset: 100, limit: 20 } },
		{ label: "numbers as strings kept raw", args: { artifact_id: "cmd-1.txt", offset: "100", limit: "20" } },
		{ label: "missing artifact_id", args: { search: "x" } },
	],
	read_command_output: [{ label: "legacy name", args: { artifact_id: "cmd-2.txt", search: "warn" } }],
	write_to_file: [
		{ label: "full", args: { path: "out.txt", content: "line 1\nline 2\n" } },
		{ label: "empty content", args: { path: "out.txt", content: "" } },
		{ label: "missing content", args: { path: "out.txt" } },
		{ label: "content first, no path", args: { content: "x" } },
	],
	write_file: [{ label: "alias", args: { path: "out.txt", content: "abc" } }],
	apply_diff: [
		{ label: "full", args: { path: "a.ts", diff: "<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE" } },
		{ label: "missing diff", args: { path: "a.ts" } },
		{ label: "diff only", args: { diff: "d" } },
	],
	edit: [
		{ label: "full", args: { file_path: "a.ts", old_string: "a", new_string: "b", replace_all: true } },
		{
			label: "replace_all as string",
			args: { file_path: "a.ts", old_string: "a", new_string: "b", replace_all: "True" },
		},
		{
			label: "replace_all unrecognized",
			args: { file_path: "a.ts", old_string: "a", new_string: "b", replace_all: "yes" },
		},
		{ label: "missing new_string", args: { file_path: "a.ts", old_string: "a" } },
		{ label: "empty strings", args: { file_path: "a.ts", old_string: "", new_string: "" } },
	],
	search_and_replace: [
		{ label: "alias of edit", args: { file_path: "a.ts", old_string: "a", new_string: "b", replace_all: "false" } },
	],
	search_replace: [
		{ label: "full", args: { file_path: "a.ts", old_string: "a", new_string: "b" } },
		{
			label: "extra replace_all is dropped",
			args: { file_path: "a.ts", old_string: "a", new_string: "b", replace_all: true },
		},
		{ label: "missing old_string", args: { file_path: "a.ts", new_string: "b" } },
	],
	edit_file: [
		{ label: "full", args: { file_path: "a.ts", old_string: "a", new_string: "b", expected_replacements: 2 } },
		{
			label: "expected_replacements as string kept raw",
			args: { file_path: "a.ts", old_string: "a", new_string: "b", expected_replacements: "2" },
		},
		{ label: "missing file_path", args: { old_string: "a", new_string: "b" } },
	],
	apply_patch: [
		{ label: "full", args: { patch: "*** Begin Patch\n*** Add File: x.txt\n+hi\n*** End Patch" } },
		{ label: "missing patch", args: { diff: "x" } },
	],
	search_files: [
		{ label: "full", args: { path: ".", regex: "TODO\\(", file_pattern: "*.ts" } },
		{ label: "missing regex", args: { path: "." } },
		{ label: "regex only", args: { regex: "x" } },
	],
	search_task_history: [
		{ label: "full", args: { query: "retry wrapper", max_results: 5 } },
		{ label: "max_results as string", args: { query: "retry", max_results: "20" } },
		{ label: "max_results not a number", args: { query: "retry", max_results: "many" } },
		{ label: "missing query", args: { max_results: 3 } },
	],
	list_files: [
		{ label: "full", args: { path: "src", recursive: true } },
		{ label: "recursive as string", args: { path: "src", recursive: " FALSE " } },
		{ label: "recursive as number", args: { path: "src", recursive: 1 } },
		{ label: "missing path", args: { recursive: true } },
	],
	use_mcp_tool: [
		{ label: "full", args: { server_name: "github", tool_name: "search", arguments: { q: "x" } } },
		{ label: "arguments as string", args: { server_name: "github", tool_name: "search", arguments: '{"q":"x"}' } },
		{ label: "missing tool_name", args: { server_name: "github" } },
	],
	access_mcp_resource: [
		{ label: "full", args: { server_name: "docs", uri: "docs://readme" } },
		{ label: "missing uri", args: { server_name: "docs" } },
	],
	ask_followup_question: [
		{
			label: "full",
			args: {
				question: "Which one?",
				follow_up: [
					{ text: "A", mode: null },
					{ text: "B", mode: "code" },
				],
			},
		},
		{ label: "follow_up as string", args: { question: "Which one?", follow_up: "A or B" } },
		{ label: "follow_up as object", args: { question: "Which one?", follow_up: { text: "A" } } },
		{ label: "missing follow_up", args: { question: "Which one?" } },
		{ label: "follow_up only", args: { follow_up: [{ text: "A" }] } },
	],
	attempt_completion: [
		{ label: "full", args: { result: "Done. All tests pass." } },
		{ label: "empty result", args: { result: "" } },
		{ label: "result as object", args: { result: { text: "done" } } },
		{ label: "missing result", args: { command: "npm test" } },
	],
	switch_mode: [
		{ label: "full", args: { mode_slug: "architect", reason: "plan first" } },
		{ label: "missing reason", args: { mode_slug: "architect" } },
	],
	new_task: [
		{ label: "full", args: { mode: "code", message: "Implement it", todos: "- [ ] a\n- [ ] b" } },
		{ label: "missing message", args: { mode: "code" } },
		{ label: "todos as array", args: { mode: "code", message: "m", todos: ["a", "b"] } },
	],
	run_parallel_tasks: [
		{
			label: "full",
			args: {
				subtasks: [
					{ message: "one", mode: "code" },
					{ message: "two", mode: "ask" },
				],
				maxConcurrency: 2,
			},
		},
		{ label: "missing maxConcurrency", args: { subtasks: [{ message: "one", mode: "code" }] } },
		{ label: "subtasks stringified", args: { subtasks: JSON.stringify([{ message: "one", mode: "code" }]) } },
		{ label: "maxConcurrency as string", args: { subtasks: [], maxConcurrency: "3" } },
	],
	codebase_search: [
		{ label: "full", args: { query: "auth middleware", path: "src/server" } },
		{ label: "path null", args: { query: "auth", path: null } },
		{ label: "missing query", args: { path: "src" } },
	],
	execute_command: [
		{ label: "full", args: { command: "npm test", cwd: "packages/a", timeout: 120 } },
		{ label: "timeout as string kept raw", args: { command: "ls", timeout: "30" } },
		{ label: "empty command", args: { command: "", cwd: "." } },
	],
	update_todo_list: [
		{ label: "markdown", args: { todos: "[x] a\n[ ] b\n[-] c" } },
		{ label: "array", args: { todos: ["a", "b"] } },
		{ label: "missing todos", args: { items: "x" } },
	],
	run_slash_command: [
		{ label: "full", args: { command: "review", args: "--strict" } },
		{ label: "missing command", args: { args: "x" } },
	],
	skill: [
		{ label: "full", args: { skill: "init", args: "fast" } },
		{ label: "missing skill", args: { args: "x" } },
	],
	generate_image: [
		{ label: "full", args: { prompt: "a red fox", path: "fox.png", image: "base.png" } },
		{ label: "missing path", args: { prompt: "a red fox" } },
		{ label: "path only", args: { path: "fox.png" } },
	],
	tools_load: [
		{ label: "full", args: { names: ["mcp--a--b", 7, "mcp--c--d"] } },
		{ label: "names as string", args: { names: "mcp--a--b" } },
		{ label: "singular name instead of names", args: { name: "mcp--a--b" } },
		{ label: "empty object", args: {} },
	],
	web_search: [
		{ label: "full", args: { queries: ["zod 4 migration", 3, "vitest snapshot"] } },
		{ label: "queries as string", args: { queries: "zod 4 migration" } },
		{ label: "queries as blank string", args: { queries: "   " } },
		{ label: "queries as object", args: { queries: { q: "x" } } },
		{ label: "missing queries", args: { query: "x" } },
	],
	web_fetch: [
		{ label: "full", args: { url: "https://example.com/docs" } },
		{ label: "missing url", args: { href: "https://example.com" } },
	],
}

/** Inputs that are not tied to one tool's argument shape. */
const GENERIC_CASES: Array<{ label: string; name: string; args: string }> = [
	{ label: "empty arguments string", name: "list_files", args: "" },
	{ label: "empty arguments string, tool with no required field", name: "tools_load", args: "" },
	{ label: "broken JSON", name: "read_file", args: '{"path": "a.ts",' },
	{ label: "JSON array instead of object", name: "web_fetch", args: '["https://example.com"]' },
	{ label: "unknown parameter is dropped from params", name: "read_file", args: '{"path":"a.ts","bogus":1}' },
	{ label: "unknown tool name", name: "does_not_exist", args: '{"path":"a.ts"}' },
	{ label: "custom_tool bucket name", name: "custom_tool", args: '{"x":1}' },
]

/** Cut the JSON text into growing prefixes (at most `pieces` of them, the last is the whole text). */
function prefixCuts(text: string, pieces = 8): number[] {
	const cuts = new Set<number>()
	for (let k = 1; k <= pieces; k++) {
		cuts.add(Math.ceil((text.length * k) / pieces))
	}
	return [...cuts].filter((c) => c > 0)
}

function stream(name: string, text: string) {
	const parser = new NativeToolCallParser()
	const id = `call_${name}`
	parser.startStreamingToolCall(id, name)
	const partials: Array<{ received: string; result: unknown }> = []
	let sent = 0
	for (const cut of prefixCuts(text)) {
		const chunk = text.slice(sent, cut)
		sent = cut
		partials.push({ received: text.slice(0, cut), result: parser.processStreamingChunk(id, chunk) })
	}
	return { partials, finalized: parser.finalizeStreamingToolCall(id) }
}

function complete(name: string, text: string) {
	return NativeToolCallParser.parseToolCall({
		id: `call_${name}`,
		name: name as DispatchableToolName,
		arguments: text,
	})
}

describe("NativeToolCallParser argument parsing (characterization)", () => {
	let warnings: string[]
	let errors: string[]

	beforeEach(() => {
		warnings = []
		errors = []
		vi.spyOn(console, "warn").mockImplementation((first: unknown) => {
			warnings.push(String(first))
		})
		vi.spyOn(console, "error").mockImplementation((first: unknown) => {
			errors.push(String(first))
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	const toolNames = Object.keys(CASES) as Array<keyof typeof CASES>

	describe.each(toolNames)("%s", (name) => {
		it("partial parse over growing chunks", () => {
			const snapshot = CASES[name].map(({ label, args }) => {
				const text = typeof args === "string" ? args : JSON.stringify(args)
				return { label, ...stream(name, text) }
			})
			expect(snapshot).toMatchSnapshot()
		})

		it("complete parse, including weak-model inputs", () => {
			const snapshot = CASES[name].map(({ label, args }) => {
				const text = typeof args === "string" ? args : JSON.stringify(args)
				warnings = []
				errors = []
				const result = complete(name, text)
				return { label, result, warnings: [...warnings], errors: [...errors] }
			})
			expect(snapshot).toMatchSnapshot()
		})
	})

	it("generic inputs", () => {
		const snapshot = GENERIC_CASES.map(({ label, name, args }) => {
			warnings = []
			errors = []
			const completeResult = complete(name, args)
			const completeLog = { warnings: [...warnings], errors: [...errors] }
			const streamed = stream(name, args)
			return { label, complete: completeResult, completeLog, streamed }
		})
		expect(snapshot).toMatchSnapshot()
	})

	it("a registered custom tool gets its raw arguments as nativeArgs", () => {
		const has = customToolRegistry.has.bind(customToolRegistry)
		vi.spyOn(customToolRegistry, "has").mockImplementation((id: string) => id === "my_custom" || has(id))
		const text = JSON.stringify({ anything: "goes", count: "3", nested: { a: [1] } })
		const snapshot = { complete: complete("my_custom", text), streamed: stream("my_custom", text), warnings }
		expect(snapshot).toMatchSnapshot()
	})
})
