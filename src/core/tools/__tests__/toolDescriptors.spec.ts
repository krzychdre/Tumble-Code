// cd src && ./node_modules/.bin/vitest run core/tools/__tests__/toolDescriptors.spec.ts

import { describe, it, expect } from "vitest"

import { toolNames } from "@roo-code/types"

import { PROTOCOL_TOOL_NAMES } from "../../../shared/tools"
import { TOOL_DESCRIPTORS, describeToolUse, getToolDescriptor, toolNamesWhere } from "../toolDescriptors"

describe("tool descriptor table (CORE-R4)", () => {
	it("has a row for every tool name except the custom_tool usage bucket", () => {
		expect(Object.keys(TOOL_DESCRIPTORS).sort()).toEqual(toolNames.filter((n) => n !== "custom_tool").sort())
	})

	it("finds no row for names every JavaScript object has", () => {
		for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "custom_tool"]) {
			expect(getToolDescriptor(name), name).toBeUndefined()
		}
	})

	it("describes a name without a row as the bare name", () => {
		expect(describeToolUse({ name: "my_custom_tool", params: {} })).toBe("[my_custom_tool]")
		expect(describeToolUse({ name: "constructor", params: {} })).toBe("[constructor]")
	})

	it("keeps the policies consistent with each other", () => {
		const checkpointed = toolNamesWhere((tool) => tool.requiresCheckpoint)
		const readOnly = toolNamesWhere((tool) => tool.workspaceReadOnly)
		// A tool cannot both need a checkpoint and be safe to run before one.
		expect(checkpointed.filter((name) => readOnly.includes(name))).toEqual([])
		// Protocol results are never cleared.
		expect(toolNamesWhere((tool) => tool.compactable).filter((name) => PROTOCOL_TOOL_NAMES.includes(name))).toEqual(
			[],
		)
		// Every file-mutation tool is checkpointed, every file-read tool is read-only.
		expect(checkpointed).toEqual(expect.arrayContaining(toolNamesWhere((tool) => tool.ledger === "file-mutation")))
		expect(readOnly).toEqual(expect.arrayContaining(toolNamesWhere((tool) => tool.ledger === "file-read")))
	})
})
