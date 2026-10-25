// npx vitest run packages/core/src/message-utils/__tests__/consolidateApiRequests.spec.ts

import type { ClineMessage } from "@tumble-code/types"

import { consolidateApiRequests } from "../consolidateApiRequests.js"

const payload = (data: object | string | undefined) => (typeof data === "object" ? JSON.stringify(data) : data)
const started = (ts: number, data: object | string | undefined = {}): ClineMessage => ({
	ts,
	type: "say",
	say: "api_req_started",
	text: payload(data),
})
const finished = (ts: number, data: object | string | undefined = {}): ClineMessage => ({
	ts,
	type: "say",
	say: "api_req_finished",
	text: payload(data),
})
const text = (ts: number, body: string): ClineMessage => ({ ts, type: "say", say: "text", text: body })

describe("consolidateApiRequests", () => {
	it.each<[string, ClineMessage[]]>([
		["an empty list", []],
		["a single message", [started(1, { request: "r" })]],
		["no API request messages", [text(1, "Hello"), text(2, "World")]],
	])("returns %s unchanged", (_name, messages) => {
		expect(consolidateApiRequests(messages)).toEqual(messages)
	})

	it.each<[string, ClineMessage[], ClineMessage[]]>([
		[
			"merges the finish payload into its start, keeping the start's ts and other fields",
			[{ ...started(1000, { request: "GET", cost: 0.001 }), partial: false }, finished(1001, { cost: 0.005 })],
			[{ ...started(1000, { request: "GET", cost: 0.005 }), partial: false }],
		],
		[
			"keeps other messages in place between consecutive pairs",
			[
				text(1, "Before"),
				started(2, { request: "a" }),
				finished(3, { cost: 1 }),
				text(4, "Mid"),
				started(5, { request: "b" }),
				finished(6, { cost: 2 }),
			],
			[
				text(1, "Before"),
				started(2, { request: "a", cost: 1 }),
				text(4, "Mid"),
				started(5, { request: "b", cost: 2 }),
			],
		],
		[
			"pairs a finish with the latest open start",
			[
				started(1, { request: "outer" }),
				started(2, { request: "inner" }),
				finished(3, { cost: 1 }),
				finished(4, { cost: 2 }),
			],
			[started(1, { request: "outer", cost: 2 }), started(2, { request: "inner", cost: 1 })],
		],
		[
			"keeps a start without a finish",
			[started(1, { request: "a" }), finished(2, { cost: 1 }), started(3, { request: "orphan" })],
			[started(1, { request: "a", cost: 1 }), started(3, { request: "orphan" })],
		],
		[
			"drops a finish without an open start, including one before any start",
			[
				finished(0, { cost: 9 }),
				started(1, { request: "a" }),
				finished(2, { cost: 1 }),
				finished(3, { duration: 150 }),
			],
			[started(1, { request: "a", cost: 1 })],
		],
		[
			"merges nested and array values as they are",
			[started(1, { request: "a", tags: ["x"] }), finished(2, { results: { count: 2, rows: [1, 2] } })],
			[started(1, { request: "a", tags: ["x"], results: { count: 2, rows: [1, 2] } })],
		],
	])("%s", (_name, messages, expected) => {
		expect(consolidateApiRequests(messages)).toEqual(expected)
	})

	it.each(["{broken", "null", "", undefined, "42"])(
		"merges an unreadable or non-object payload (%j) as empty, on either side, without logging",
		(raw) => {
			const error = vi.spyOn(console, "error").mockImplementation(() => {})

			expect(consolidateApiRequests([started(1, { request: "r" }), finished(2, raw)])).toEqual([
				started(1, { request: "r" }),
			])
			expect(consolidateApiRequests([started(1, raw), finished(2, { cost: 1 })])).toEqual([
				started(1, { cost: 1 }),
			])
			expect(error).not.toHaveBeenCalled()
			error.mockRestore()
		},
	)
})
