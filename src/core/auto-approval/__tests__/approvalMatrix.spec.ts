// cd src && ./node_modules/.bin/vitest run core/auto-approval/__tests__/approvalMatrix.spec.ts

// Characterization of every auto-approval decision (CORE-R4 d). It pins what
// checkAutoApproval answers today for every tool action a "tool" ask can carry, for the
// non-tool asks, and for the read-only / write helpers other modules import. The
// decisions moved from hand-kept lists and `tool.tool ===` chains to a category declared
// on each tool descriptor; this spec passed before that move and must pass unchanged
// after it. A deliberate policy change edits the expectations here in the same commit.

import { describe, it, expect } from "vitest"

import type { ClineAsk, ExtensionState } from "@roo-code/types"

import {
	checkAutoApproval,
	type AutoApprovalState,
	type AutoApprovalStateOptions,
	type AutoApprovalPlanState,
	type CheckAutoApprovalResult,
} from "../index"
import { isReadOnlyToolAction, isWriteToolAction } from "../tools"

type State = Pick<ExtensionState, AutoApprovalState | AutoApprovalStateOptions | AutoApprovalPlanState>

/**
 * Every value of `ClineSayTool["tool"]`, plus names a tool ask can carry that are not in
 * the type: `listFiles` (still in the read-only list), `runParallelTasks` (raised by
 * run_parallel_tasks), an unknown name and names that live on Object.prototype.
 */
const TOOL_ACTIONS = [
	"editedExistingFile",
	"appliedDiff",
	"newFileCreated",
	"codebaseSearch",
	"readFile",
	"readArtifact",
	"readCommandOutput",
	"listFilesTopLevel",
	"listFilesRecursive",
	"searchFiles",
	"searchTaskHistory",
	"switchMode",
	"newTask",
	"finishTask",
	"reviewPlan",
	"generateImage",
	"imageGenerated",
	"runSlashCommand",
	"updateTodoList",
	"skill",
	"webSearch",
	"webFetch",
	"listFiles",
	"runParallelTasks",
	"notATool",
	"constructor",
	"__proto__",
	"toString",
	"hasOwnProperty",
] as const

/** Tool ask texts that carry no usable action. */
const MALFORMED_TOOL_TEXTS: Record<string, string | undefined> = {
	"(no text)": undefined,
	"(empty object)": "{}",
	"(not json)": "{not json",
	"(json null)": "null",
	"(json number)": "5",
	"(json string)": '"readFile"',
	"(tool is a number)": '{"tool":5}',
	"(tool is an array)": '{"tool":["readFile"]}',
}

const allOff: State = {
	autoApprovalEnabled: true,
	autoApprovalMode: "default",
	alwaysAllowReadOnly: false,
	alwaysAllowReadOnlyOutsideWorkspace: false,
	alwaysAllowWrite: false,
	alwaysAllowWriteOutsideWorkspace: false,
	alwaysAllowWriteProtected: false,
	alwaysAllowMcp: false,
	alwaysAllowModeSwitch: false,
	alwaysAllowSubtasks: false,
	alwaysApprovePlan: false,
	alwaysAllowExecute: false,
	alwaysAllowFollowupQuestions: false,
	followupAutoApproveTimeoutMs: 0,
	allowedCommands: [],
	deniedCommands: [],
	mcpServers: [],
	mode: "code",
	customModes: [],
}

/** One decision as a short token: A approve, - ask, D deny, T<ms>:<answer> timeout. */
function token(result: CheckAutoApprovalResult): string {
	switch (result.decision) {
		case "approve":
			return "A"
		case "ask":
			return "-"
		case "deny":
			return "D"
		case "timeout": {
			const response = result.fn()
			return `T${result.timeout}:${response.askResponse}:${JSON.stringify(response.text)}`
		}
	}
}

/** "A" runs are long; compress for a readable snapshot. */
function runLength(tokens: string[]): string {
	const out: string[] = []
	let i = 0
	while (i < tokens.length) {
		let j = i
		while (j < tokens.length && tokens[j] === tokens[i]) j++
		out.push(j - i === 1 ? tokens[i] : `${tokens[i]}*${j - i}`)
		i = j
	}
	return out.join(" ")
}

interface ToolCase {
	state: Partial<State>
	outside?: boolean
	isProtected?: boolean
}

/**
 * Named setting combinations for the readable table. "plan" means the current mode is
 * architect, whose `planApprovalRequired` gates switchMode and newTask.
 */
const TOOL_CASES: Record<string, ToolCase> = {
	"all off": { state: {} },
	readOnly: { state: { alwaysAllowReadOnly: true } },
	"readOnly, outside": { state: { alwaysAllowReadOnly: true }, outside: true },
	"readOnly+outside, outside": {
		state: { alwaysAllowReadOnly: true, alwaysAllowReadOnlyOutsideWorkspace: true },
		outside: true,
	},
	write: { state: { alwaysAllowWrite: true } },
	"write, outside": { state: { alwaysAllowWrite: true }, outside: true },
	"write+outside, outside": {
		state: { alwaysAllowWrite: true, alwaysAllowWriteOutsideWorkspace: true },
		outside: true,
	},
	"write, protected": { state: { alwaysAllowWrite: true }, isProtected: true },
	"write+protected, protected": {
		state: { alwaysAllowWrite: true, alwaysAllowWriteProtected: true },
		isProtected: true,
	},
	modeSwitch: { state: { alwaysAllowModeSwitch: true } },
	"modeSwitch, plan": { state: { alwaysAllowModeSwitch: true, mode: "architect" } },
	"modeSwitch+approvePlan, plan": {
		state: { alwaysAllowModeSwitch: true, alwaysApprovePlan: true, mode: "architect" },
	},
	subtasks: { state: { alwaysAllowSubtasks: true } },
	"subtasks, plan": { state: { alwaysAllowSubtasks: true, mode: "architect" } },
	"subtasks+approvePlan, plan": {
		state: { alwaysAllowSubtasks: true, alwaysApprovePlan: true, mode: "architect" },
	},
	approvePlan: { state: { alwaysApprovePlan: true } },
	"execute+mcp+followup": {
		state: { alwaysAllowExecute: true, alwaysAllowMcp: true, alwaysAllowFollowupQuestions: true },
	},
	"everything on, outside, protected, plan": {
		state: {
			alwaysAllowReadOnly: true,
			alwaysAllowReadOnlyOutsideWorkspace: true,
			alwaysAllowWrite: true,
			alwaysAllowWriteOutsideWorkspace: true,
			alwaysAllowWriteProtected: true,
			alwaysAllowMcp: true,
			alwaysAllowModeSwitch: true,
			alwaysAllowSubtasks: true,
			alwaysApprovePlan: true,
			alwaysAllowExecute: true,
			alwaysAllowFollowupQuestions: true,
			mode: "architect",
		},
		outside: true,
		isProtected: true,
	},
	bypass: { state: { autoApprovalMode: "bypass" } },
	"bypass, plan": { state: { autoApprovalMode: "bypass", mode: "architect" } },
	"bypass+approvePlan, plan": {
		state: { autoApprovalMode: "bypass", alwaysApprovePlan: true, mode: "architect" },
	},
	"autonomous, plan": { state: { autoApprovalMode: "autonomous", mode: "architect" } },
	"disabled, everything on": {
		state: {
			autoApprovalEnabled: false,
			autoApprovalMode: "autonomous",
			alwaysAllowReadOnly: true,
			alwaysAllowWrite: true,
			alwaysAllowModeSwitch: true,
			alwaysAllowSubtasks: true,
			alwaysApprovePlan: true,
		},
	},
}

function toolText(action: string, outside?: boolean): string {
	return JSON.stringify({ tool: action, path: "src/a.ts", ...(outside ? { isOutsideWorkspace: true } : {}) })
}

async function decide(ask: ClineAsk, state: State | undefined, text?: string, isProtected?: boolean) {
	return token(await checkAutoApproval({ state, ask, text, isProtected }))
}

async function readableRow(text: (outside?: boolean) => string | undefined): Promise<string> {
	const cells: string[] = []
	for (const c of Object.values(TOOL_CASES)) {
		cells.push(await decide("tool", { ...allOff, ...c.state }, text(c.outside), c.isProtected))
	}
	return cells.join("")
}

const TOOL_BOOLEAN_KEYS = [
	"alwaysAllowReadOnly",
	"alwaysAllowReadOnlyOutsideWorkspace",
	"alwaysAllowWrite",
	"alwaysAllowWriteOutsideWorkspace",
	"alwaysAllowWriteProtected",
	"alwaysAllowModeSwitch",
	"alwaysAllowSubtasks",
	"alwaysApprovePlan",
] as const

/**
 * Every combination of the eight tool toggles, outside-workspace, protected, plan mode
 * and the four approval tiers (disabled, default, bypass, autonomous): 8,192 decisions
 * per action, compressed with run-length encoding.
 */
async function exhaustiveToolRow(action: string | undefined, rawText?: string): Promise<string> {
	const tokens: string[] = []
	for (const tier of ["disabled", "default", "bypass", "autonomous"] as const) {
		for (let bits = 0; bits < 1 << (TOOL_BOOLEAN_KEYS.length + 3); bits++) {
			const state: State = {
				...allOff,
				autoApprovalEnabled: tier !== "disabled",
				autoApprovalMode: tier === "disabled" ? "autonomous" : tier,
			}
			TOOL_BOOLEAN_KEYS.forEach((key, i) => {
				state[key] = (bits & (1 << i)) !== 0
			})
			const outside = (bits & (1 << TOOL_BOOLEAN_KEYS.length)) !== 0
			const isProtected = (bits & (1 << (TOOL_BOOLEAN_KEYS.length + 1))) !== 0
			state.mode = (bits & (1 << (TOOL_BOOLEAN_KEYS.length + 2))) !== 0 ? "architect" : "code"
			const text = action === undefined ? rawText : toolText(action, outside)
			tokens.push(await decide("tool", state, text, isProtected))
		}
	}
	return runLength(tokens)
}

describe("auto-approval decision matrix (CORE-R4 d characterization)", () => {
	it("tool asks: the readable table", async () => {
		const rows: Array<[string, string]> = []
		for (const action of TOOL_ACTIONS) {
			rows.push([action, await readableRow((outside) => toolText(action, outside))])
		}
		for (const [label, text] of Object.entries(MALFORMED_TOOL_TEXTS)) {
			rows.push([label, await readableRow(() => text)])
		}
		// fromEntries keeps `__proto__` as an own key; an assignment would not.
		const table = Object.fromEntries(rows)
		// One character per entry of TOOL_CASES, in order: A approve, - ask.
		expect({ columns: Object.keys(TOOL_CASES), table }).toMatchInlineSnapshot(`
			{
			  "columns": [
			    "all off",
			    "readOnly",
			    "readOnly, outside",
			    "readOnly+outside, outside",
			    "write",
			    "write, outside",
			    "write+outside, outside",
			    "write, protected",
			    "write+protected, protected",
			    "modeSwitch",
			    "modeSwitch, plan",
			    "modeSwitch+approvePlan, plan",
			    "subtasks",
			    "subtasks, plan",
			    "subtasks+approvePlan, plan",
			    "approvePlan",
			    "execute+mcp+followup",
			    "everything on, outside, protected, plan",
			    "bypass",
			    "bypass, plan",
			    "bypass+approvePlan, plan",
			    "autonomous, plan",
			    "disabled, everything on",
			  ],
			  "table": {
			    "(empty object)": "------------------AAAA-",
			    "(json null)": "------------------AAAA-",
			    "(json number)": "------------------AAAA-",
			    "(json string)": "------------------AAAA-",
			    "(no text)": "------------------AAAA-",
			    "(not json)": "------------------AAAA-",
			    "(tool is a number)": "------------------AAAA-",
			    "(tool is an array)": "------------------AAAA-",
			    "__proto__": "------------------AAAA-",
			    "appliedDiff": "----A-A-A--------AAAAA-",
			    "codebaseSearch": "-A-A-------------AAAAA-",
			    "constructor": "------------------AAAA-",
			    "editedExistingFile": "----A-A-A--------AAAAA-",
			    "finishTask": "------------AAA--AAAAA-",
			    "generateImage": "----A-A-A--------AAAAA-",
			    "hasOwnProperty": "------------------AAAA-",
			    "imageGenerated": "------------------AAAA-",
			    "listFiles": "-A-A-------------AAAAA-",
			    "listFilesRecursive": "-A-A-------------AAAAA-",
			    "listFilesTopLevel": "-A-A-------------AAAAA-",
			    "newFileCreated": "----A-A-A--------AAAAA-",
			    "newTask": "------------A-A--AA-AA-",
			    "notATool": "------------------AAAA-",
			    "readArtifact": "------------------AAAA-",
			    "readCommandOutput": "------------------AAAA-",
			    "readFile": "-A-A-------------AAAAA-",
			    "reviewPlan": "-----------A--AA-A--AA-",
			    "runParallelTasks": "------------------AAAA-",
			    "runSlashCommand": "-A-A-------------AAAAA-",
			    "searchFiles": "-A-A-------------AAAAA-",
			    "searchTaskHistory": "------------------AAAA-",
			    "skill": "AAAAAAAAAAAAAAAAAAAAAA-",
			    "switchMode": "---------A-A-----AA-AA-",
			    "toString": "------------------AAAA-",
			    "updateTodoList": "AAAAAAAAAAAAAAAAAAAAAA-",
			    "webFetch": "-A-A-------------AAAAA-",
			    "webSearch": "-A-A-------------AAAAA-",
			  },
			}
		`)
	})

	it("tool asks: every settings combination", async () => {
		const rows: Array<[string, string]> = []
		for (const action of TOOL_ACTIONS) {
			rows.push([action, await exhaustiveToolRow(action)])
		}
		for (const [label, text] of Object.entries(MALFORMED_TOOL_TEXTS)) {
			rows.push([label, await exhaustiveToolRow(undefined, text)])
		}
		expect(Object.fromEntries(rows)).toMatchSnapshot()
	})

	it("non-tool asks: every settings combination", async () => {
		const mcpServers: State["mcpServers"] = [
			{
				name: "srv",
				config: "{}",
				status: "connected",
				tools: [
					{ name: "allowed", alwaysAllow: true },
					{ name: "manual", alwaysAllow: false },
				],
			},
		]
		const cases: Array<[string, ClineAsk, string | undefined]> = [
			["command: allowed", "command", "git status"],
			["command: denied", "command", "git push origin"],
			["command: unknown", "command", "curl example.com"],
			["command: chain with a denied part", "command", "git status && rm -rf x"],
			["command: escaped quote (DEF-S1)", "command", "git log \\' && rm -rf /tmp/x \\'"],
			["command: empty", "command", ""],
			["command: no text", "command", undefined],
			[
				"mcp: always-allowed tool",
				"use_mcp_server",
				JSON.stringify({ type: "use_mcp_tool", serverName: "srv", toolName: "allowed" }),
			],
			[
				"mcp: manual tool",
				"use_mcp_server",
				JSON.stringify({ type: "use_mcp_tool", serverName: "srv", toolName: "manual" }),
			],
			[
				"mcp: unknown server",
				"use_mcp_server",
				JSON.stringify({ type: "use_mcp_tool", serverName: "nope", toolName: "allowed" }),
			],
			[
				"mcp: resource",
				"use_mcp_server",
				JSON.stringify({ type: "access_mcp_resource", serverName: "srv", uri: "x://y" }),
			],
			["mcp: unknown type", "use_mcp_server", JSON.stringify({ type: "other", serverName: "srv" })],
			["mcp: not json", "use_mcp_server", "{not json"],
			["mcp: no text", "use_mcp_server", undefined],
			[
				"followup: with suggestion",
				"followup",
				JSON.stringify({ question: "q", suggest: [{ answer: "" }, { answer: "second" }] }),
			],
			["followup: no suggestion", "followup", JSON.stringify({ question: "q", suggest: [] })],
			["followup: not json", "followup", "{not json"],
			["followup: no text", "followup", undefined],
			["completion_result", "completion_result", ""],
			["api_req_failed", "api_req_failed", "err"],
			["resume_task", "resume_task", undefined],
			["resume_completed_task", "resume_completed_task", undefined],
			["mistake_limit_reached", "mistake_limit_reached", "x"],
			["auto_approval_max_req_reached", "auto_approval_max_req_reached", "{}"],
			["command_output", "command_output", ""],
		]

		const table: Record<string, string> = {}
		for (const [label, ask, text] of cases) {
			const tokens: string[] = []
			for (const tier of ["disabled", "default", "bypass", "autonomous"] as const) {
				for (let bits = 0; bits < 16; bits++) {
					const state: State = {
						...allOff,
						autoApprovalEnabled: tier !== "disabled",
						autoApprovalMode: tier === "disabled" ? "autonomous" : tier,
						alwaysAllowExecute: (bits & 1) !== 0,
						alwaysAllowMcp: (bits & 2) !== 0,
						alwaysAllowFollowupQuestions: (bits & 4) !== 0,
						followupAutoApproveTimeoutMs: (bits & 8) !== 0 ? 1500 : 0,
						allowedCommands: ["git", "echo"],
						deniedCommands: ["git push", "rm"],
						mcpServers,
					}
					tokens.push(await decide(ask, state, text))
				}
			}
			table[label] = runLength(tokens)
		}
		table["no state (tool ask)"] = await decide("tool", undefined, toolText("readFile"))
		table["no state (command_output)"] = await decide("command_output", undefined, "")
		expect(table).toMatchSnapshot()
	})

	it("isReadOnlyToolAction and isWriteToolAction (imported by subagentApproval and memorySandbox)", () => {
		const readOnly = TOOL_ACTIONS.filter((action) => isReadOnlyToolAction({ tool: action } as never))
		const write = TOOL_ACTIONS.filter((action) => isWriteToolAction({ tool: action } as never))
		expect({ readOnly, write }).toEqual({
			readOnly: [
				"codebaseSearch",
				"readFile",
				"listFilesTopLevel",
				"listFilesRecursive",
				"searchFiles",
				"runSlashCommand",
				"webSearch",
				"webFetch",
				"listFiles",
			],
			write: ["editedExistingFile", "appliedDiff", "newFileCreated", "generateImage"],
		})
		for (const malformed of [{}, { tool: 5 }, { tool: ["readFile"] }, { tool: undefined }]) {
			expect(isReadOnlyToolAction(malformed as never)).toBe(false)
			expect(isWriteToolAction(malformed as never)).toBe(false)
		}
	})
})
