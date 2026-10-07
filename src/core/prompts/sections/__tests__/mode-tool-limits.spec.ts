// cd src && ./node_modules/.bin/vitest run core/prompts/sections/__tests__/mode-tool-limits.spec.ts

import type { GroupEntry } from "@tumble-code/types"

import { getModeBySlug } from "../../../../shared/modes"
import { getModeToolLimitsSection } from "../mode-tool-limits"

const codeMode = getModeBySlug("code")!

describe("getModeToolLimitsSection", () => {
	it("reports all three missing capabilities for the orchestrator (groups: [])", () => {
		const orchestrator = getModeBySlug("orchestrator")!
		expect(orchestrator.groups).toEqual([])

		const result = getModeToolLimitsSection(orchestrator.groups, { exampleMode: codeMode })

		expect(result).toBe(`====

TOOLS IN THIS MODE

This mode cannot run shell commands (there is no execute_command tool), cannot read or search files (there is no read_file, list_files or search_files tool) and cannot edit files (there is no write_to_file or apply_diff tool). Do not call those tools: a call to a tool that is not in your tool list is rejected and you get no result. When the work needs commands or files, delegate it with new_task to a mode that has those tools (for example code), or switch with switch_mode.`)
	})

	it("is omitted entirely for code, which has command, read and edit", () => {
		expect(getModeToolLimitsSection(codeMode.groups, { exampleMode: codeMode })).toBe("")
	})

	it("names only the missing groups for an architect-like custom mode", () => {
		const groups: GroupEntry[] = ["read", ["edit", { fileRegex: "\\.md$" }], "mcp"]

		const result = getModeToolLimitsSection(groups, { exampleMode: codeMode })

		expect(result).toContain("This mode cannot run shell commands (there is no execute_command tool).")
		expect(result).not.toContain("read_file")
		expect(result).not.toContain("write_to_file")
		expect(result).toContain("When the work needs commands, delegate it with new_task")
	})

	it("reports read and edit but not commands for a command-only mode", () => {
		const result = getModeToolLimitsSection(["command"], { exampleMode: codeMode })

		expect(result).not.toContain("execute_command")
		expect(result).toContain("cannot read or search files")
		expect(result).toContain("cannot edit files")
		expect(result).toContain("When the work needs files,")
	})

	it("does not mention new_task when the request removes it", () => {
		const result = getModeToolLimitsSection([], { removedTools: ["new_task"], exampleMode: codeMode })

		expect(result).not.toContain("new_task")
		expect(result).toContain("switch with switch_mode to a mode that has those tools (for example code).")
	})

	it("does not mention switch_mode when the request removes it", () => {
		const result = getModeToolLimitsSection([], { removedTools: ["switch_mode"], exampleMode: codeMode })

		expect(result).not.toContain("switch_mode")
		expect(result).toContain("delegate it with new_task to a mode that has those tools (for example code).")
	})

	it("mentions neither when both are removed", () => {
		const result = getModeToolLimitsSection([], {
			removedTools: ["new_task", "switch_mode"],
			exampleMode: codeMode,
		})

		expect(result).not.toContain("new_task")
		expect(result).not.toContain("switch_mode")
		expect(result).toContain("say in your result that this mode cannot do it.")
	})

	it("names no example mode when the example lacks a missing group", () => {
		const result = getModeToolLimitsSection([], {
			exampleMode: { slug: "code", groups: ["read", "edit"] },
		})

		expect(result).not.toContain("for example")
		expect(result).toContain(
			"delegate it with new_task to a mode that has those tools, or switch with switch_mode.",
		)
	})
})
