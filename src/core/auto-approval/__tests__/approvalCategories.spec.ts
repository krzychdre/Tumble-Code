// cd src && ./node_modules/.bin/vitest run core/auto-approval/__tests__/approvalCategories.spec.ts

// The approval category of every tool is declared once, on its descriptor (CORE-R4 d), and
// auto-approval derives its action lists from those declarations. This spec pins each
// declaration and the derived action map; approvalMatrix.spec.ts pins the decisions.

import { describe, it, expect } from "vitest"

import { TOOL_DESCRIPTORS } from "../../tools/toolDescriptors"
import { TOOL_ACTION_APPROVAL_CATEGORIES, getToolActionApprovalCategory } from "../tools"

/** Categories answered from the action a "tool" ask carries. */
const TOOL_ASK_CATEGORIES = ["readOnly", "write", "modeSwitch", "subtask", "subtaskFinish", "alwaysAllowed"]

describe("tool approval categories (CORE-R4 d)", () => {
	it("declares a category, and the tool-ask actions it raises, for every tool", () => {
		const declared = Object.fromEntries(
			Object.entries(TOOL_DESCRIPTORS).map(([name, descriptor]) => [
				name,
				[descriptor.approvalCategory, ...(descriptor.approvalActions ?? [])].join(" "),
			]),
		)
		expect(declared).toEqual({
			read_file: "readOnly readFile",
			list_files: "readOnly listFilesTopLevel listFilesRecursive",
			search_files: "readOnly searchFiles",
			codebase_search: "readOnly codebaseSearch",
			read_artifact: "none",
			read_command_output: "none",
			search_task_history: "none",
			write_to_file: "write editedExistingFile newFileCreated",
			apply_diff: "write appliedDiff",
			edit: "write appliedDiff",
			search_and_replace: "write appliedDiff",
			search_replace: "write appliedDiff",
			edit_file: "write appliedDiff newFileCreated",
			apply_patch: "write appliedDiff",
			generate_image: "write generateImage",
			execute_command: "execute",
			use_mcp_tool: "mcp",
			access_mcp_resource: "mcp",
			web_search: "readOnly webSearch",
			web_fetch: "readOnly webFetch",
			ask_followup_question: "followup",
			attempt_completion: "subtaskFinish finishTask",
			switch_mode: "modeSwitch switchMode",
			new_task: "subtask newTask",
			run_parallel_tasks: "manual",
			update_todo_list: "alwaysAllowed updateTodoList",
			run_slash_command: "readOnly runSlashCommand",
			skill: "alwaysAllowed skill",
			tools_load: "none",
		})
	})

	it("lists actions exactly for the categories answered from a tool ask", () => {
		for (const [name, descriptor] of Object.entries(TOOL_DESCRIPTORS)) {
			const hasActions = (descriptor.approvalActions ?? []).length > 0
			expect(hasActions, name).toBe(TOOL_ASK_CATEGORIES.includes(descriptor.approvalCategory))
		}
	})

	it("never gives one action two categories", () => {
		const seen = new Map<string, string>()
		for (const [name, descriptor] of Object.entries(TOOL_DESCRIPTORS)) {
			for (const action of descriptor.approvalActions ?? []) {
				const earlier = seen.get(action)
				expect(earlier === undefined || earlier === descriptor.approvalCategory, `${name}: ${action}`).toBe(
					true,
				)
				seen.set(action, descriptor.approvalCategory)
			}
		}
	})

	it("derives the action map auto-approval reads", () => {
		expect(Object.fromEntries([...TOOL_ACTION_APPROVAL_CATEGORIES].sort())).toEqual({
			appliedDiff: "write",
			codebaseSearch: "readOnly",
			editedExistingFile: "write",
			finishTask: "subtaskFinish",
			generateImage: "write",
			listFiles: "readOnly",
			listFilesRecursive: "readOnly",
			listFilesTopLevel: "readOnly",
			newFileCreated: "write",
			newTask: "subtask",
			readFile: "readOnly",
			reviewPlan: "planReview",
			runSlashCommand: "readOnly",
			searchFiles: "readOnly",
			skill: "alwaysAllowed",
			switchMode: "modeSwitch",
			updateTodoList: "alwaysAllowed",
			webFetch: "readOnly",
			webSearch: "readOnly",
		})
	})

	it("finds no category for malformed actions or names every JavaScript object has", () => {
		for (const tool of [
			undefined,
			{},
			{ tool: 5 },
			{ tool: ["readFile"] },
			{ tool: "constructor" },
			{ tool: "__proto__" },
			{ tool: "toString" },
			{ tool: "runParallelTasks" },
		]) {
			expect(getToolActionApprovalCategory(tool as never), JSON.stringify(tool)).toBeUndefined()
		}
	})
})
