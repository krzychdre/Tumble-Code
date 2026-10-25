import type { ToolName } from "@tumble-code/types"

import type { ToolUse } from "../../../shared/tools"

import { ToolRepetitionDetector } from "../ToolRepetitionDetector"

vitest.mock("../../../i18n", () => ({
	t: (key: string, options?: { toolName?: string }) => `${key} (${options?.toolName})`,
}))

function createToolUse(
	name: string,
	params: Record<string, string> = {},
	nativeArgs?: Record<string, unknown>,
): ToolUse {
	return {
		type: "tool_use",
		name: name as ToolName,
		params,
		partial: false,
		...(nativeArgs ? { nativeArgs } : {}),
	} as ToolUse
}

/** Whether each call in turn was allowed. */
const allowed = (detector: ToolRepetitionDetector, calls: ToolUse[]) =>
	calls.map((call) => detector.check(call).allowExecution)

const repeat = (call: ToolUse, times: number) => Array.from({ length: times }, () => call)

describe("ToolRepetitionDetector", () => {
	const read = createToolUse("read_file", { path: "a.ts" })

	it.each([
		[1, [true, false]],
		[2, [true, true, false]],
		[undefined, [true, true, true, false]],
		[0, [true, true, true, true, true, true]],
		[-1, [true, true, true, true, true, true]],
	])("with limit %s stops the identical call at %j", (limit, expected) => {
		expect(allowed(new ToolRepetitionDetector(limit), repeat(read, expected.length))).toEqual(expected)
	})

	it("asks the user, naming the tool, when it stops a call", () => {
		const detector = new ToolRepetitionDetector(1)
		detector.check(read)

		expect(detector.check(read)).toEqual({
			allowExecution: false,
			askUser: {
				messageKey: "mistake_limit_reached",
				messageDetail: "tools:toolRepetitionLimitReached (read_file)",
			},
			repeatedTrip: false,
		})
	})

	it("starts counting again after a stop", () => {
		expect(allowed(new ToolRepetitionDetector(2), repeat(read, 6))).toEqual([true, true, false, true, true, false])
	})

	it("starts counting again after a different call", () => {
		const other = createToolUse("read_file", { path: "b.ts" })

		expect(allowed(new ToolRepetitionDetector(2), [read, read, other, read, read])).toEqual([
			true,
			true,
			true,
			true,
			true,
		])
	})

	it.each([
		[
			"the same params in another key order",
			createToolUse("x", { a: "1", b: "2" }),
			createToolUse("x", { b: "2", a: "1" }),
			true,
		],
		["empty nativeArgs and none", createToolUse("x", {}, {}), createToolUse("x"), true],
		[
			"the same nativeArgs",
			createToolUse("x", {}, { files: [{ path: "a" }] }),
			createToolUse("x", {}, { files: [{ path: "a" }] }),
			true,
		],
		[
			"different nativeArgs",
			createToolUse("x", {}, { files: [{ path: "a" }] }),
			createToolUse("x", {}, { files: [{ path: "b" }] }),
			false,
		],
		["different tool names", createToolUse("x", { a: "1" }), createToolUse("y", { a: "1" }), false],
	])("treats calls with %s as identical: %s", (_, first, second, identical) => {
		expect(allowed(new ToolRepetitionDetector(1), [first, second])).toEqual([true, !identical])
	})

	describe("repeatedTrip", () => {
		const tripOnce = (detector: ToolRepetitionDetector, call: ToolUse) => {
			for (;;) {
				const result = detector.check(call)
				if (!result.allowExecution) return result
			}
		}

		it("is false on the first trip and true when the same call trips again", () => {
			const detector = new ToolRepetitionDetector(3)
			const call = createToolUse("read_file", { path: "a.ts" })

			expect(tripOnce(detector, call).repeatedTrip).toBe(false)
			expect(tripOnce(detector, call).repeatedTrip).toBe(true)
		})

		it("a different call between the trips starts over", () => {
			const detector = new ToolRepetitionDetector(3)
			const call = createToolUse("read_file", { path: "a.ts" })

			tripOnce(detector, call)
			detector.check(createToolUse("read_file", { path: "b.ts" }))

			expect(tripOnce(detector, call).repeatedTrip).toBe(false)
		})
	})

	// Every wait_for_subagents call has the same (empty) arguments but a
	// different result: repeating it is its normal use.
	describe("wait_for_subagents", () => {
		it("never trips on repeated calls, and does not count toward another tool's run", () => {
			const detector = new ToolRepetitionDetector(2)
			for (let i = 0; i < 5; i++) {
				expect(detector.check(createToolUse("wait_for_subagents")).allowExecution).toBe(true)
			}
			expect(detector.check(createToolUse("read_file")).allowExecution).toBe(true)
			expect(detector.check(createToolUse("wait_for_subagents")).allowExecution).toBe(true)
			expect(detector.check(createToolUse("read_file")).allowExecution).toBe(true)
			expect(detector.check(createToolUse("read_file")).allowExecution).toBe(true)
			expect(detector.check(createToolUse("read_file")).allowExecution).toBe(false)
		})
	})
})
