// cd src && npx vitest run core/prompts/tools/__tests__/compact-toolset.spec.ts
//
// The compact toolset (ai_plans/2026-10-10_19-36_compact-small-model-profile.md):
// which tools a profile with `compactProfile` on may advertise, and how that
// interacts with the mode's groups, slim, MCP, the model and the feature gates.

import type OpenAI from "openai"

import type { ModeConfig } from "@tumble-code/types"

import { getNativeTools } from "../native-tools"
import { getCompactNativeTools } from "../native-tools/compact"
import {
	COMPACT_EDIT_TOOL,
	COMPACT_TOOLSET_ALLOWLIST,
	COMPACT_TOOLSET_ALLOWSET,
	applyCompactToolset,
	filterMcpToolsForMode,
	filterNativeToolsForMode,
	withCompactIncludedTools,
} from "../filter-tools-for-mode"

/** Code index stub that reports the feature as fully live, so codebase_search would survive. */
const liveCodeIndexManager = {
	isFeatureEnabled: true,
	isFeatureConfigured: true,
	isInitialized: true,
} as any

/** MCP hub stub with one server that exposes a resource (keeps access_mcp_resource alive). */
const mcpHubWithResources = {
	getServers: () => [{ name: "docs", resources: [{ uri: "res://x" }] }],
} as any

function names(tools: OpenAI.Chat.ChatCompletionTool[]): string[] {
	return tools.map((tool) => (tool as OpenAI.Chat.ChatCompletionFunctionTool).function.name)
}

/** Every experiment that unlocks an extra tool, so the compact intersection has work to do. */
const allExperiments = { runSlashCommand: true, imageGeneration: true }

function advertised(
	mode: string,
	settings: Record<string, any>,
	options: { catalog?: "compact" | "full"; customModes?: ModeConfig[] } = {},
): string[] {
	const catalog = options.catalog === "full" ? getNativeTools() : getCompactNativeTools()
	return names(
		filterNativeToolsForMode(
			catalog,
			mode,
			options.customModes,
			allExperiments,
			liveCodeIndexManager,
			settings,
			mcpHubWithResources,
		),
	)
}

const compact = { compactProfile: true }

const READ = ["read_file", "list_files", "search_files"]
const PROTOCOL = ["ask_followup_question", "attempt_completion", "switch_mode"]
const EDIT = ["edit", "write_to_file"]

describe("COMPACT_TOOLSET_ALLOWLIST", () => {
	it("is exactly the canonical compact list of the overview plan", () => {
		expect([...COMPACT_TOOLSET_ALLOWLIST].sort()).toEqual(
			[
				"read_file",
				"list_files",
				"search_files",
				"edit",
				"write_to_file",
				"execute_command",
				"ask_followup_question",
				"attempt_completion",
				"switch_mode",
				"web_search",
				"web_fetch",
			].sort(),
		)
	})

	it("folds in the aliases of its tools and nothing else", () => {
		expect(COMPACT_TOOLSET_ALLOWSET.has("write_file")).toBe(true)
		expect(COMPACT_TOOLSET_ALLOWSET.has("search_and_replace")).toBe(true)
		expect(COMPACT_TOOLSET_ALLOWSET.has("read_command_output")).toBe(false)
		expect(COMPACT_TOOLSET_ALLOWSET.size).toBe(COMPACT_TOOLSET_ALLOWLIST.length + 2)
	})

	it("has one compact definition per allowed tool", () => {
		expect(names(getCompactNativeTools()).sort()).toEqual([...COMPACT_TOOLSET_ALLOWLIST].sort())
	})
})

describe("applyCompactToolset", () => {
	const code = { slug: "code", name: "Code", roleDefinition: "", groups: ["read", "edit", "command"] } as ModeConfig

	it("is the identity function when the profile is not compact", () => {
		const tools = new Set(["read_file", "apply_diff", "new_task", "use_mcp_tool"])

		expect(applyCompactToolset(tools, code, undefined)).toBe(tools)
		expect(applyCompactToolset(tools, code, {})).toBe(tools)
		expect(applyCompactToolset(tools, code, { compactProfile: false })).toBe(tools)
	})

	it("drops every tool outside the compact list, MCP included", () => {
		const tools = new Set([
			"read_file",
			"apply_diff",
			"search_replace",
			"edit_file",
			"apply_patch",
			"new_task",
			"run_parallel_tasks",
			"update_todo_list",
			"read_artifact",
			"tools_load",
			"skill",
			"codebase_search",
			"generate_image",
			"run_slash_command",
			"search_task_history",
			"use_mcp_tool",
			"access_mcp_resource",
		])

		expect([...applyCompactToolset(tools, code, compact)].sort()).toEqual(["edit", "read_file"])
	})
})

describe("filterNativeToolsForMode - compact profile", () => {
	it("advertises the compact set in code mode, in the compact order", () => {
		expect(advertised("code", compact)).toEqual([...READ, ...PROTOCOL, ...EDIT, "execute_command"])
	})

	it("substitutes edit for apply_diff and the other edit verbs, also from the full catalog", () => {
		// Every opt-in edit verb is asked for through the model, so only the
		// compact rules can be what removes them.
		const modelInfo = { includedTools: ["search_replace", "edit_file", "apply_patch"] }
		const full = advertised("code", { modelInfo }, { catalog: "full" })
		const compactFromFull = advertised("code", { ...compact, modelInfo }, { catalog: "full" })

		for (const verb of ["apply_diff", "search_replace", "edit_file", "apply_patch"]) {
			expect(full).toContain(verb)
			expect(compactFromFull).not.toContain(verb)
		}
		expect(full).not.toContain("edit")
		expect(compactFromFull).toContain("edit")
		expect(compactFromFull).toContain("write_to_file")
	})

	it("supersedes slim: compact plus slim gives exactly the compact set", () => {
		const both = { compactProfile: true, slimToolset: true, slimHidesMcp: false }

		expect(advertised("code", both)).toEqual(advertised("code", compact))
		expect(advertised("code", both, { catalog: "full" })).toEqual(advertised("code", compact, { catalog: "full" }))
		// Slim alone keeps apply_diff and hides edit, so the comparison above is not vacuous.
		const slimOnly = advertised("code", { slimToolset: true }, { catalog: "full" })
		expect(slimOnly).toContain("apply_diff")
		expect(slimOnly).not.toContain("edit")
	})

	it("gives ask mode no edit tool and no command tool", () => {
		expect(advertised("ask", compact)).toEqual([...READ, ...PROTOCOL])
		expect(advertised("ask", compact, { catalog: "full" })).not.toContain("edit")
	})

	it("offers edit in architect mode, whose edit group is restricted to markdown", () => {
		expect(advertised("architect", compact)).toEqual([...READ, ...PROTOCOL, ...EDIT])
	})

	it("leaves orchestrator mode with the protocol tools only", () => {
		expect(advertised("orchestrator", compact)).toEqual(PROTOCOL)
	})

	it("never gives edit to a custom mode without the edit group", () => {
		const reader: ModeConfig = { slug: "reader", name: "Reader", roleDefinition: "r", groups: ["read", "command"] }
		const result = advertised(
			"reader",
			{ ...compact, modelInfo: { includedTools: ["edit"] } },
			{ customModes: [reader] },
		)

		expect(result).not.toContain("edit")
		expect(result).not.toContain("write_to_file")
		expect(result).toContain("execute_command")
	})

	it("keeps the ask, architect and code arrays prefixes of each other", () => {
		const ask = advertised("ask", compact)
		const architect = advertised("architect", compact)
		const code = advertised("code", compact)

		expect(architect.slice(0, ask.length)).toEqual(ask)
		expect(code.slice(0, architect.length)).toEqual(architect)
	})

	it("still applies disabledTools, aliases included", () => {
		expect(advertised("code", { ...compact, disabledTools: ["execute_command"] })).not.toContain("execute_command")
		expect(advertised("code", { ...compact, disabledTools: ["edit"] })).not.toContain("edit")
		expect(advertised("code", { ...compact, disabledTools: ["search_and_replace"] })).not.toContain("edit")
		expect(advertised("code", { ...compact, disabledTools: ["write_file"] })).not.toContain("write_to_file")
	})

	it("respects a model that excludes edit", () => {
		expect(advertised("code", { ...compact, modelInfo: { excludedTools: ["edit"] } })).not.toContain("edit")
		expect(advertised("code", { ...compact, modelInfo: { excludedTools: ["search_and_replace"] } })).not.toContain(
			"edit",
		)
		expect(advertised("code", { ...compact, modelInfo: { excludedTools: ["apply_diff"] } })).toContain("edit")
	})

	it("keeps the web tools behind webToolsEnabled", () => {
		expect(advertised("code", compact)).not.toContain("web_search")
		expect(advertised("code", { ...compact, webToolsEnabled: true })).toEqual([
			...READ,
			...PROTOCOL,
			"web_search",
			"web_fetch",
			...EDIT,
			"execute_command",
		])
	})

	it("hides access_mcp_resource even when a server has resources", () => {
		expect(advertised("code", {}, { catalog: "full" })).toContain("access_mcp_resource")
		expect(advertised("code", compact, { catalog: "full" })).not.toContain("access_mcp_resource")
	})
})

describe("filterMcpToolsForMode - compact profile", () => {
	const mcpTool = {
		type: "function",
		function: { name: "mcp--docs--lookup", description: "d", parameters: { type: "object", properties: {} } },
	} as OpenAI.Chat.ChatCompletionTool

	it("advertises no MCP tool under compact, whatever the slim MCP flag says", () => {
		expect(filterMcpToolsForMode([mcpTool], "code", undefined, {}, {})).toHaveLength(1)
		expect(filterMcpToolsForMode([mcpTool], "code", undefined, {}, compact)).toEqual([])
		expect(
			filterMcpToolsForMode(
				[mcpTool],
				"code",
				undefined,
				{},
				{ ...compact, slimToolset: true, slimHidesMcp: false },
			),
		).toEqual([])
	})
})

describe("withCompactIncludedTools", () => {
	it("returns the input untouched when the profile is not compact", () => {
		const included = ["apply_patch"]

		expect(withCompactIncludedTools(included, {})).toBe(included)
		expect(withCompactIncludedTools(included, { compactProfile: false })).toBe(included)
		expect(withCompactIncludedTools(undefined, undefined)).toBeUndefined()
		expect(withCompactIncludedTools(undefined, null)).toBeUndefined()
	})

	it("adds the compact edit verb once under compact", () => {
		expect(withCompactIncludedTools(undefined, compact)).toEqual([COMPACT_EDIT_TOOL])
		expect(withCompactIncludedTools(["apply_patch", "edit"], compact)).toEqual(["apply_patch", "edit"])
	})
})
