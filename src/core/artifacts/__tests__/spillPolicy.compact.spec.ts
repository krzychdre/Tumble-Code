// npx vitest run core/artifacts/__tests__/spillPolicy.compact.spec.ts

import type { Anthropic } from "@anthropic-ai/sdk"

import { Task } from "../../task/Task"
import { COMPACT_TOOL_RESULT_MAX_CHARS, applyCompactToolResultCap, truncateToolResultInPlace } from "../spillPolicy"

/** 400 numbered lines of 80 characters: about 32 KB, over every budget used here. */
const huge = Array.from({ length: 400 }, (_, index) => `line-${index + 1}`.padEnd(80, "x")).join("\n")

describe("applyCompactToolResultCap", () => {
	it.each(["execute_command", "search_files", "list_files"])("leaves a short %s result alone", (tool) => {
		expect(applyCompactToolResultCap("a\nb\nc", tool, 24 * 1024)).toBe("a\nb\nc")
	})

	it("cuts command output to 6,000 characters, keeping start and end at line boundaries", () => {
		const capped = applyCompactToolResultCap(huge, "execute_command", 24 * 1024)

		expect(COMPACT_TOOL_RESULT_MAX_CHARS).toBe(6_000)
		expect(capped.length).toBeLessThanOrEqual(6_000)
		expect(capped.startsWith("line-1x")).toBe(true)
		expect(capped.endsWith(huge.split("\n").at(-1)!)).toBe(true)
		expect(capped).toMatch(
			/\n\[Output cut: \d+ of 400 lines \(\d+ of 32399 characters\) left out from the middle\. Narrow the command, for example filter it through grep or head\/tail, or run a more specific command\.\]\n/,
		)
		// Every kept line is a whole original line.
		const original = new Set(huge.split("\n"))
		for (const line of capped.split("\n").filter((l) => !l.startsWith("[Output cut"))) {
			expect(original.has(line)).toBe(true)
		}
		expect(capped).not.toContain("read_artifact")
	})

	it.each([
		["search_files", "Narrow the search with a more specific regex, a deeper path or a file pattern."],
		["list_files", "List a more specific subdirectory, or list without recursion."],
	])("cuts a %s result to its first lines, with a note on how to narrow it", (tool, hint) => {
		const capped = applyCompactToolResultCap(huge, tool, 24 * 1024)

		expect(capped.length).toBeLessThanOrEqual(6_000)
		expect(capped.startsWith("line-1x")).toBe(true)
		expect(capped.endsWith(`left out. ${hint}]`)).toBe(true)
		const lines = capped.split("\n")
		expect(lines.slice(0, -1)).toEqual(huge.split("\n").slice(0, lines.length - 1))
	})

	it("cuts a single enormous line by characters", () => {
		const oneLine = "x".repeat(20_000)
		const capped = applyCompactToolResultCap(oneLine, "search_files", 24 * 1024)
		expect(capped.length).toBeLessThanOrEqual(6_000)
		expect(capped).toMatch(/^x+\n\[Output cut: /)
	})

	it("leaves read_file and protocol tools alone, whatever their size", () => {
		expect(applyCompactToolResultCap(huge, "read_file", 1024)).toBe(huge)
		expect(applyCompactToolResultCap(huge, "attempt_completion", 1024)).toBe(huge)
	})

	it("cuts any other result over the inline budget in place instead of spilling it", () => {
		const capped = applyCompactToolResultCap(huge, "web_fetch", 8 * 1024)
		expect(capped.length).toBeLessThanOrEqual(8 * 1024)
		expect(capped).toContain("left out from the middle. Ask for a narrower result if you need the rest.]")
		expect(capped).not.toContain("artifact")

		expect(applyCompactToolResultCap("small", "web_fetch", 8 * 1024)).toBe("small")
	})

	it("truncateToolResultInPlace never exceeds its budget", () => {
		for (const max of [500, 4096, 6000]) {
			expect(truncateToolResultInPlace(huge, max, "head", "hint").length).toBeLessThanOrEqual(max)
			expect(truncateToolResultInPlace(huge, max, "headAndTail", "hint").length).toBeLessThanOrEqual(max)
		}
	})
})

describe("Task#pushToolResultToUserContent under the compact profile", () => {
	/** Just the state the push reads, with a spill policy that would spill anything over 1 KB. */
	function fakeTask(apiConfiguration: Record<string, unknown>) {
		const save = vi.fn().mockResolvedValue({ id: "tool-1.txt" })
		const task = {
			apiConfiguration,
			userMessageContent: [] as Anthropic.Messages.ContentBlockParam[],
			toolResultSpill: { store: { save, getTaskDir: () => "/tmp/none" }, maxInlineBytes: 24 * 1024 },
			pendingToolResultSpills: new Set<Promise<void>>(),
			spillToolResultInBackground: vi.fn(),
			taskId: "t",
		}
		return { task, save }
	}

	const push = (task: object, content: string, toolName: string) =>
		Task.prototype.pushToolResultToUserContent.call(
			task as unknown as Task,
			{ type: "tool_result", tool_use_id: "id-1", content },
			{ toolName },
		)

	it("cuts the result in place and never starts a spill", () => {
		const { task } = fakeTask({ compactProfile: true })

		expect(push(task, huge, "search_files")).toBe(true)

		const pushed = task.userMessageContent[0] as Anthropic.ToolResultBlockParam
		expect((pushed.content as string).length).toBeLessThanOrEqual(6_000)
		expect(pushed.tool_use_id).toBe("id-1")
		expect(task.spillToolResultInBackground).not.toHaveBeenCalled()
	})

	it.each([
		["absent", {}],
		["false", { compactProfile: false }],
	])("flag %s: pushes the full result and hands it to the spill policy as today", (_label, flag) => {
		const { task } = fakeTask(flag)

		push(task, huge, "search_files")

		expect((task.userMessageContent[0] as Anthropic.ToolResultBlockParam).content).toBe(huge)
		expect(task.spillToolResultInBackground).toHaveBeenCalledTimes(1)
	})
})
