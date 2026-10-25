// npx vitest run packages/core/src/message-utils/__tests__/consolidateTokenUsage.spec.ts

import type { ClineMessage, TokenUsage, ToolUsage } from "@tumble-code/types"

import { consolidateTokenUsage, hasTokenUsageChanged, hasToolUsageChanged } from "../consolidateTokenUsage.js"

const request = (data: object | string | undefined): ClineMessage => ({
	ts: 1,
	type: "say",
	say: "api_req_started",
	text: typeof data === "object" ? JSON.stringify(data) : data,
})
const condense = (contextCondense?: { newContextTokens?: number; cost?: number }): ClineMessage =>
	({ ts: 1, type: "say", say: "condense_context", contextCondense }) as ClineMessage
const text: ClineMessage = { ts: 1, type: "say", say: "text", text: '{"tokensIn":999}' }

const usage = (overrides: Partial<TokenUsage> = {}): TokenUsage => ({
	totalTokensIn: 0,
	totalTokensOut: 0,
	totalCacheWrites: undefined,
	totalCacheReads: undefined,
	totalCost: 0,
	contextTokens: 0,
	...overrides,
})

describe("consolidateTokenUsage", () => {
	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it.each<[string, ClineMessage[], TokenUsage]>([
		["nothing for no messages", [], usage()],
		["nothing from other messages", [text], usage()],
		[
			"sums every request, and takes the context from the last one",
			[
				request({ tokensIn: 100, tokensOut: 50, cacheWrites: 5, cacheReads: 10, cost: 0.25 }),
				request({ tokensIn: 200, tokensOut: 100, cacheWrites: 1, cost: 0.5 }),
			],
			usage({
				totalTokensIn: 300,
				totalTokensOut: 150,
				totalCacheWrites: 6,
				totalCacheReads: 10,
				totalCost: 0.75,
				contextTokens: 300,
			}),
		],
		[
			"ignores missing and non-number figures",
			[request({ tokensIn: "100", tokensOut: null, cost: 0.5 }), request({ tokensOut: 7 })],
			usage({ totalTokensOut: 7, totalCost: 0.5, contextTokens: 7 }),
		],
		[
			"adds a condense's cost and takes its context when it is last",
			[request({ tokensIn: 100, tokensOut: 50, cost: 0.5 }), condense({ newContextTokens: 5000, cost: 0.25 })],
			usage({ totalTokensIn: 100, totalTokensOut: 50, totalCost: 0.75, contextTokens: 5000 }),
		],
		[
			"takes the context from a request after a condense",
			[condense({ newContextTokens: 5000, cost: 0.25 }), request({ tokensIn: 700, tokensOut: 30 })],
			usage({ totalTokensIn: 700, totalTokensOut: 30, totalCost: 0.25, contextTokens: 730 }),
		],
		[
			"scans back past a condense without figures, a request without text and unreadable payloads",
			[
				request({ tokensIn: 300, tokensOut: 20, cost: 0.5 }),
				request("null"),
				request("42"),
				request("{broken"),
				request(undefined),
				condense(),
			],
			usage({ totalTokensIn: 300, totalTokensOut: 20, totalCost: 0.5, contextTokens: 320 }),
		],
	])("counts %s", (_name, messages, expected) => {
		expect(consolidateTokenUsage(messages)).toEqual(expected)
	})

	it("logs an unparseable request once, from the totals pass only", () => {
		consolidateTokenUsage([request("{broken")])

		expect(console.error).toHaveBeenCalledTimes(1)
		expect(vi.mocked(console.error).mock.calls[0]![0]).toBe("Error parsing JSON:")
	})
})

describe("hasTokenUsageChanged", () => {
	const base = usage({ totalTokensIn: 100, totalTokensOut: 50, totalCost: 0.01, contextTokens: 150 })

	it.each<[string, TokenUsage | undefined, boolean]>([
		["no snapshot", undefined, true],
		["an equal snapshot", { ...base }, false],
		...(
			[
				"totalTokensIn",
				"totalTokensOut",
				"totalCacheWrites",
				"totalCacheReads",
				"totalCost",
				"contextTokens",
			] as const
		).map((key): [string, TokenUsage, boolean] => [`a different ${key}`, { ...base, [key]: 1 }, true]),
	])("is %s for %s", (_name, snapshot, changed) => {
		expect(hasTokenUsageChanged(base, snapshot)).toBe(changed)
	})
})

describe("hasToolUsageChanged", () => {
	const current: ToolUsage = { read_file: { attempts: 1, failures: 0 } }

	it.each<[string, ToolUsage | undefined, boolean]>([
		["no snapshot", undefined, true],
		["an equal snapshot", { read_file: { attempts: 1, failures: 0 } }, false],
		["one tool fewer", {}, true],
		["a different tool", { write_to_file: { attempts: 1, failures: 0 } }, true],
		["other attempts", { read_file: { attempts: 2, failures: 0 } }, true],
		["other failures", { read_file: { attempts: 1, failures: 1 } }, true],
	])("for %s", (_name, snapshot, changed) => {
		expect(hasToolUsageChanged(current, snapshot)).toBe(changed)
	})
})
