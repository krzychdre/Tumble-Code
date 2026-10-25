// When manageContext keeps, truncates or condenses the conversation, and the token estimate it
// decides with. The summarizer (condense module) and the API handler are stand-ins; the
// thresholds, truncation and the ledger run for real. truncateConversation itself is
// pinned in truncation.spec.ts, microcompaction and pruning in their own specs.

import type { Anthropic } from "@anthropic-ai/sdk"

import type { ModelInfo } from "@tumble-code/types"
import { TelemetryService } from "@tumble-code/telemetry"

import { BaseProvider } from "../../../api/providers/base-provider"
import { ApiMessage } from "../../task-persistence/apiMessages"
import * as condenseModule from "../../condense"
import type { RooIgnoreController } from "../../ignore/RooIgnoreController"

import {
	TOKEN_BUFFER_PERCENTAGE,
	estimateTokenCount,
	manageContext,
	willManageContext,
	resolveCondenseThreshold,
	type ContextManagementOptions,
} from "../index"
import { logger } from "../../../utils/logging"

class FakeApiHandler extends BaseProvider {
	createMessage(): any {
		throw new Error("the summarizer is replaced in these tests")
	}

	getModel(): { id: string; info: ModelInfo } {
		return { id: "test-model", info: { contextWindow: 100000, maxTokens: 50000, supportsPromptCache: true } }
	}
}

const apiHandler = new FakeApiHandler()
const taskId = "test-task-id"

// The last message is empty, so the totals below are exactly what the cases name.
const MESSAGES: ApiMessage[] = [
	{ role: "user", content: "First message" },
	{ role: "assistant", content: "Second message" },
	{ role: "user", content: "Third message" },
	{ role: "assistant", content: "Fourth message" },
	{ role: "user", content: "" },
]

const run = (overrides: Partial<ContextManagementOptions>) =>
	manageContext({
		messages: MESSAGES,
		totalTokens: 0,
		contextWindow: 100000,
		maxTokens: 30000,
		apiHandler,
		autoCondenseContext: false,
		autoCondenseContextPercent: 100,
		systemPrompt: "System prompt",
		taskId,
		profileThresholds: {},
		currentProfileId: "default",
		...overrides,
	})

const SUMMARY: condenseModule.SummarizeResponse = {
	messages: [
		{ role: "user", content: "First message" },
		{ role: "user", content: "the summary", isSummary: true },
		{ role: "assistant", content: "Last message" },
	],
	summary: "the summary",
	cost: 0.05,
	newContextTokens: 100,
}

let summarize: ReturnType<typeof vi.spyOn>

beforeEach(() => {
	if (!TelemetryService.hasInstance()) {
		TelemetryService.createInstance([])
	}
	summarize = vi.spyOn(condenseModule, "summarizeConversation").mockResolvedValue(SUMMARY)
})

afterEach(() => {
	vi.restoreAllMocks()
})

const kept = (totalTokens: number) => ({ messages: MESSAGES, summary: "", cost: 0, prevContextTokens: totalTokens })

function expectTruncated(result: Awaited<ReturnType<typeof run>>, totalTokens: number) {
	// Non-destructive: the 5 messages stay, 2 of the 4 after the first are hidden behind a marker.
	expect(result).toMatchObject({ summary: "", cost: 0, prevContextTokens: totalTokens, messagesRemoved: 2 })
	expect(result.truncationId).toBeDefined()
	expect(result.messages).toHaveLength(6)
}

describe("estimateTokenCount", () => {
	const image = (data: string): Anthropic.Messages.ContentBlockParam => ({
		type: "image",
		source: { type: "base64", media_type: "image/png", data },
	})
	const text = (t: string): Anthropic.Messages.ContentBlockParam => ({ type: "text", text: t })

	it("counts nothing for no content or empty text", async () => {
		expect(await estimateTokenCount([], apiHandler)).toBe(0)
		expect(await estimateTokenCount([text("")], apiHandler)).toBe(0)
	})

	it("counts an image by the size of its data, with the fudge factor", async () => {
		expect(await estimateTokenCount([image("X".repeat(1000))], apiHandler)).toBe(48)
		expect(await estimateTokenCount([image("small")], apiHandler)).toBeLessThan(48)
	})

	it("counts more for longer text and adds every block", async () => {
		const short = await estimateTokenCount([text("A text block")], apiHandler)
		const long = await estimateTokenCount([text("A much longer text block with many more words in it")], apiHandler)
		const imageOnly = await estimateTokenCount([image("dummy_data")], apiHandler)

		expect(long).toBeGreaterThan(short)
		expect(await estimateTokenCount([text("A text block"), image("dummy_data")], apiHandler)).toBe(
			short + imageOnly,
		)
	})
})

describe("manageContext without auto-condense", () => {
	// allowedTokens = contextWindow * (1 - TOKEN_BUFFER_PERCENTAGE) - reserved output tokens
	it.each([
		["below the allowance", 100000, 30000, 59999, false],
		["just over the allowance (within the buffer of the window)", 100000, 30000, 60001, true],
		["over the allowance with a larger output reserve", 100000, 50000, 40001, true],
		["below the allowance with a larger output reserve", 100000, 50000, 39999, false],
		["below the allowance with the default reserve (8192)", 100000, undefined, 81807, false],
		["over the allowance with the default reserve (8192)", 100000, undefined, 81809, true],
		["over the allowance of a small window", 50000, 10000, 35001, true],
		["below the allowance of a large window", 200000, 30000, 149999, false],
	])(
		"%s (window %i, output %s, %i tokens) truncates: %s",
		async (_, contextWindow, maxTokens, totalTokens, truncates) => {
			const result = await run({ contextWindow, maxTokens, totalTokens })

			if (truncates) expectTruncated(result, totalTokens)
			else expect(result).toEqual(kept(totalTokens))
			expect(summarize).not.toHaveBeenCalled()
		},
	)

	it("adds the tokens of the incoming last message to the total", async () => {
		const incoming = [{ type: "text" as const, text: "X".repeat(1000) }]
		const incomingTokens = await estimateTokenCount(incoming, apiHandler)
		const messages: ApiMessage[] = [...MESSAGES.slice(0, -1), { role: "user", content: incoming }]
		const allowed = 100000 * (1 - TOKEN_BUFFER_PERCENTAGE) - 30000

		const under = await run({ messages, totalTokens: allowed - incomingTokens })
		const over = await run({ messages, totalTokens: allowed - incomingTokens + 1 })

		expect(under.messages).toEqual(messages)
		expect(under.prevContextTokens).toBe(allowed)
		expect(over.truncationId).toBeDefined()
	})

	it("counts the system prompt in the size after truncation", async () => {
		const systemPrompt = "You are a helpful assistant. Follow these rules carefully."
		const systemPromptTokens = await estimateTokenCount([{ type: "text", text: systemPrompt }], apiHandler)

		const result = await run({ totalTokens: 70001, systemPrompt })

		expect(result.newContextTokensAfterTruncation).toBeGreaterThanOrEqual(systemPromptTokens)
		expect(result.newContextTokensAfterTruncation).toBeLessThan(result.prevContextTokens)
	})
})

describe("manageContext with auto-condense", () => {
	it.each([
		["over the allowance", 70001, 100, {}, "default", true],
		["over the percent threshold, under the allowance", 60000, 50, {}, "default", true],
		["under the percent threshold", 40000, 50, {}, "default", false],
		["over the profile's own threshold", 65000, 100, { p: 60 }, "p", true],
		["under the global threshold when the profile inherits it (-1)", 55000, 80, { p: -1 }, "p", false],
		["under the global threshold when the profile has none", 55000, 80, { other: 50 }, "p", false],
	])("%s condenses: %s", async (_, totalTokens, percent, profileThresholds, currentProfileId, condenses) => {
		const result = await run({
			totalTokens,
			autoCondenseContext: true,
			autoCondenseContextPercent: percent,
			profileThresholds,
			currentProfileId,
		})

		if (condenses) {
			expect(summarize).toHaveBeenCalledWith({
				messages: MESSAGES,
				apiHandler,
				systemPrompt: "System prompt",
				taskId,
				isAutomaticTrigger: true,
				// The typed state ledger the summary is validated against.
				ledger: expect.objectContaining({ facts: expect.any(Array) }),
			})
			expect(result).toMatchObject({
				messages: SUMMARY.messages,
				summary: "the summary",
				cost: 0.05,
				prevContextTokens: totalTokens,
			})
		} else {
			expect(summarize).not.toHaveBeenCalled()
			expect(result).toEqual(kept(totalTokens))
		}
	})

	it("hands the files read, the cwd and the ignore controller to the summary", async () => {
		const rooIgnoreController = { filterPaths: vi.fn() } as unknown as RooIgnoreController

		await run({
			totalTokens: 70001,
			autoCondenseContext: true,
			filesReadByRoo: ["src/test.ts", "src/utils.ts"],
			cwd: "/test/project",
			rooIgnoreController,
		})

		expect(summarize).toHaveBeenCalledWith(
			expect.objectContaining({
				filesReadByRoo: ["src/test.ts", "src/utils.ts"],
				cwd: "/test/project",
				rooIgnoreController,
			}),
		)
	})

	it("falls back to truncation when the summary fails", async () => {
		summarize.mockResolvedValue({ messages: MESSAGES, summary: "", cost: 0.01, error: "Summarization failed" })

		const result = await run({ totalTokens: 70001, autoCondenseContext: true })

		expect(summarize).toHaveBeenCalled()
		expect(result.truncationId).toBeDefined()
		expect(result).toMatchObject({ summary: "", messagesRemoved: 2, prevContextTokens: 70001 })
	})
})

describe("resolveCondenseThreshold", () => {
	it.each([
		[{ p: 60 }, 60],
		[{}, 75],
		[{ p: -1 }, 75],
		[{ p: 150 }, 75],
	])("resolves profile thresholds %j to %i", (thresholds, expected) => {
		expect(resolveCondenseThreshold(thresholds, "p", 75)).toBe(expected)
	})

	it("warns about an out-of-range value only when asked to", () => {
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => {})

		resolveCondenseThreshold({ p: 150 }, "p", 75)
		resolveCondenseThreshold({ p: -1 }, "p", 75, true)
		expect(warn).not.toHaveBeenCalled()

		resolveCondenseThreshold({ p: 150 }, "p", 75, true)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('Invalid profile threshold 150 for profile "p"'))
	})
})

describe("willManageContext", () => {
	const base = {
		contextWindow: 100000,
		maxTokens: 30000,
		autoCondenseContext: true,
		autoCondenseContextPercent: 50,
		profileThresholds: {} as Record<string, number>,
		currentProfileId: "default",
		lastMessageTokens: 0,
	}

	it.each([
		["over the percent threshold", { totalTokens: 60000 }, true],
		["under the percent threshold", { totalTokens: 40000 }, false],
		["over the allowance without auto-condense", { totalTokens: 60001, autoCondenseContext: false }, true],
		["under the allowance without auto-condense", { totalTokens: 59999, autoCondenseContext: false }, false],
		[
			"over the profile's own threshold",
			{ totalTokens: 55000, autoCondenseContextPercent: 80, profileThresholds: { p: 50 }, currentProfileId: "p" },
			true,
		],
		[
			"under the global threshold the profile inherits",
			{ totalTokens: 55000, autoCondenseContextPercent: 80, profileThresholds: { p: -1 }, currentProfileId: "p" },
			false,
		],
		["under the threshold before the last message", { totalTokens: 49000 }, false],
		["over the threshold with the last message", { totalTokens: 49000, lastMessageTokens: 2000 }, true],
	])("%s: %s", (_, overrides, expected) => {
		expect(willManageContext({ ...base, ...overrides })).toBe(expected)
	})
})
