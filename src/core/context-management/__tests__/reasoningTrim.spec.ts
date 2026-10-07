// cd src && npx vitest run core/context-management/__tests__/reasoningTrim.spec.ts

import { ApiMessage } from "../../task-persistence/apiMessages"

import {
	REASONING_TRIM_HEAD_CHARS,
	REASONING_TRIM_KEEP_RECENT,
	REASONING_TRIM_MARKER,
	REASONING_TRIM_MIN_CHARS,
	applyReasoningTrims,
	reasoningTrimKey,
	selectReasoningTrims,
	shouldTrimOldReasoning,
	trimReasoningText,
} from "../reasoningTrim"

/** A plan paragraph of exactly `chars` characters with no finding word in it. */
function plan(label: string, chars = 300): string {
	return `${label}: ${"Let me check the next call site and read the helper again. ".repeat(60)}`
		.slice(0, chars)
		.trim()
}

/** A paragraph that states a finding. */
function finding(label: string): string {
	return `${label}: I found the root cause, the cache key ignores the model id.`
}

/**
 * Nine paragraphs, ~2.4k chars: two head paragraphs (the second one starts inside the head
 * budget), two plans, a finding, three plans and the closing paragraph.
 */
function longReasoning(): string {
	return [
		plan("P0", 250),
		plan("P1", 250),
		plan("P2"),
		plan("P3"),
		finding("P4"),
		plan("P5"),
		plan("P6"),
		plan("P7"),
		plan("P8"),
	].join("\n\n")
}

function assistant(ts: number | undefined, reasoning: string, extra: Record<string, unknown> = {}): ApiMessage {
	return {
		role: "assistant",
		content: [
			{ type: "reasoning", text: reasoning, summary: [], ...extra },
			{ type: "text", text: `answer ${ts}` },
		] as unknown as ApiMessage["content"],
		...(ts === undefined ? {} : { ts }),
	}
}

function user(ts: number): ApiMessage {
	return { role: "user", content: `user ${ts}`, ts }
}

function reasoningOf(message: ApiMessage): unknown {
	return (message.content as unknown as { text?: unknown }[])[0].text
}

/** user, then `count` assistant turns with long reasoning at ts 1..count, each followed by a user turn. */
function conversation(count: number): ApiMessage[] {
	const messages: ApiMessage[] = [user(0)]
	for (let ts = 1; ts <= count; ts++) {
		messages.push(assistant(ts, longReasoning()), user(ts * 100))
	}
	return messages
}

describe("trimReasoningText", () => {
	it("leaves text shorter than REASONING_TRIM_MIN_CHARS untouched", () => {
		const short = [plan("A"), plan("B"), plan("C")].join("\n\n")
		expect(short.length).toBeLessThan(REASONING_TRIM_MIN_CHARS)
		expect(trimReasoningText(short)).toBeUndefined()
	})

	it("keeps the head, the finding and the last paragraph, one marker per dropped run", () => {
		const trimmed = trimReasoningText(longReasoning())

		expect(trimmed).toBe(
			[
				plan("P0", 250),
				plan("P1", 250),
				REASONING_TRIM_MARKER(2),
				finding("P4"),
				REASONING_TRIM_MARKER(3),
				plan("P8"),
			].join("\n\n"),
		)
	})

	it("keeps head paragraphs whole: the one that starts inside the budget survives entire", () => {
		const head = plan("H0", REASONING_TRIM_HEAD_CHARS - 10)
		const straddling = plan("H1", 300)
		const text = [head, straddling, plan("X1"), plan("X2"), plan("X3"), plan("X4"), plan("X5"), plan("Z")].join(
			"\n\n",
		)

		const trimmed = trimReasoningText(text)!

		expect(trimmed.startsWith(`${head}\n\n${straddling}\n\n${REASONING_TRIM_MARKER(5)}`)).toBe(true)
	})

	it("matches findings case-insensitively at a word start, including Polish stems", () => {
		const paragraphs = [
			plan("P0", 450),
			"ROOT CAUSE: the loop never ends.",
			plan("P2"),
			"Wniosek: przyczyna jest w parserze.",
			plan("P4"),
			plan("P5"),
			plan("P6"),
			plan("P7"),
			plan("P8"),
		]

		const trimmed = trimReasoningText(paragraphs.join("\n\n"))!

		expect(trimmed.split("\n\n")).toEqual([
			plan("P0", 450),
			"ROOT CAUSE: the loop never ends.",
			REASONING_TRIM_MARKER(1),
			"Wniosek: przyczyna jest w parserze.",
			REASONING_TRIM_MARKER(4),
			plan("P8"),
		])
	})

	it("is deterministic and idempotent (prompt-cache stability)", () => {
		const first = trimReasoningText(longReasoning())

		expect(trimReasoningText(longReasoning())).toBe(first)
		expect(trimReasoningText(first!)).toBeUndefined()
	})

	it("returns undefined when every paragraph would be kept", () => {
		const allFindings = Array.from({ length: 40 }, (_, i) => finding(`F${i}`)).join("\n\n")
		expect(allFindings.length).toBeGreaterThanOrEqual(REASONING_TRIM_MIN_CHARS)

		expect(trimReasoningText(allFindings)).toBeUndefined()
	})

	it("leaves a single long paragraph untouched", () => {
		const single = plan("S", 2_500).repeat(2)
		expect(single.length).toBeGreaterThanOrEqual(REASONING_TRIM_MIN_CHARS)

		expect(trimReasoningText(single)).toBeUndefined()
	})
})

describe("selectReasoningTrims", () => {
	const reclaimOne = longReasoning().length - trimReasoningText(longReasoning())!.length

	it(`selects every eligible block oldest first and spares the newest ${REASONING_TRIM_KEEP_RECENT} assistant turns`, () => {
		const selection = selectReasoningTrims(conversation(6))

		expect(selection.keys).toEqual([reasoningTrimKey(1), reasoningTrimKey(2), reasoningTrimKey(3)])
		expect(selection.reclaimedChars).toBe(3 * reclaimOne)
	})

	it("stops as soon as the target is met", () => {
		expect(selectReasoningTrims(conversation(6), { targetChars: 1 }).keys).toEqual([reasoningTrimKey(1)])
		expect(selectReasoningTrims(conversation(6), { targetChars: reclaimOne + 1 }).keys).toEqual([
			reasoningTrimKey(1),
			reasoningTrimKey(2),
		])
	})

	it("carries over earlier decisions first, even when the target is 0", () => {
		const alreadyTrimmed = new Set([reasoningTrimKey(3), "call_tool_1"])

		expect(selectReasoningTrims(conversation(6), { targetChars: 0, alreadyTrimmed })).toEqual({
			keys: [reasoningTrimKey(3)],
			reclaimedChars: reclaimOne,
		})
		expect(selectReasoningTrims(conversation(6), { targetChars: reclaimOne + 1, alreadyTrimmed }).keys).toEqual([
			reasoningTrimKey(3),
			reasoningTrimKey(1),
		])
	})

	it("skips encrypted reasoning, messages without ts and short blocks", () => {
		const messages: ApiMessage[] = [
			user(0),
			assistant(1, longReasoning(), { encrypted_content: "opaque" }),
			assistant(undefined, longReasoning()),
			assistant(3, plan("short")),
			assistant(4, longReasoning()),
			assistant(10, longReasoning()),
			assistant(11, longReasoning()),
			assistant(12, longReasoning()),
		]

		expect(selectReasoningTrims(messages).keys).toEqual([reasoningTrimKey(4)])
	})

	it("ignores messages condensed away and counts the kept turns in the effective history", () => {
		const condensed = assistant(50, longReasoning())
		condensed.condenseParent = "c1"
		const messages: ApiMessage[] = [
			user(0),
			condensed,
			{ role: "user", content: "summary", ts: 60, isSummary: true, condenseId: "c1" },
			assistant(70, longReasoning()),
			assistant(80, longReasoning()),
			assistant(90, longReasoning()),
			assistant(95, longReasoning()),
		]

		expect(selectReasoningTrims(messages).keys).toEqual([reasoningTrimKey(70)])
	})
})

describe("applyReasoningTrims", () => {
	it("returns the same reference when nothing applies", () => {
		const messages = conversation(4)

		expect(applyReasoningTrims(messages, new Set())).toBe(messages)
		expect(applyReasoningTrims(messages, new Set(["call_tool_1", "toolu_2"]))).toBe(messages)
		expect(applyReasoningTrims(messages, new Set([reasoningTrimKey(999)]))).toBe(messages)
	})

	it("trims only the selected messages and never mutates the input", () => {
		const messages = conversation(4)
		const before = JSON.parse(JSON.stringify(messages))

		const result = applyReasoningTrims(messages, new Set([reasoningTrimKey(2), "call_tool_1"]))

		expect(messages).toEqual(before)
		expect(result).not.toBe(messages)
		result.forEach((message, index) => {
			if (message.ts !== 2) {
				expect(message).toBe(messages[index])
			}
		})
		const trimmed = result.find((message) => message.ts === 2)!
		expect(reasoningOf(trimmed)).toBe(trimReasoningText(longReasoning()))
		expect(trimmed.content).toEqual([
			{ type: "reasoning", text: trimReasoningText(longReasoning()), summary: [] },
			{ type: "text", text: "answer 2" },
		])
	})

	it("never touches encrypted reasoning, even when its key is listed", () => {
		const messages = [user(0), assistant(1, longReasoning(), { encrypted_content: "opaque" })]

		expect(applyReasoningTrims(messages, new Set([reasoningTrimKey(1)]))).toBe(messages)
	})
})

describe("shouldTrimOldReasoning", () => {
	it.each([
		[true, true, true],
		[true, false, false],
		[true, undefined, false],
		[false, true, false],
		[undefined, true, false],
		[undefined, undefined, false],
	])("openAiTrimOldReasoning=%s, preserveReasoning=%s -> %s", (trim, preserve, expected) => {
		expect(
			shouldTrimOldReasoning(
				{ apiProvider: "openai", openAiTrimOldReasoning: trim },
				{ preserveReasoning: preserve },
			),
		).toBe(expected)
	})

	// The flat profile keeps an OpenAI Compatible value after a switch to a provider whose own
	// models declare preserveReasoning (Z.ai GLM); no checkbox there could turn it off.
	it.each(["zai", "deepseek", undefined] as const)(
		"stays off for apiProvider=%s even with a stale openAiTrimOldReasoning",
		(apiProvider) => {
			expect(
				shouldTrimOldReasoning({ apiProvider, openAiTrimOldReasoning: true }, { preserveReasoning: true }),
			).toBe(false)
		},
	)
})
