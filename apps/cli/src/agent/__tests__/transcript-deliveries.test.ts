// The deliveries stage (D11 step 2): how every consumer walks what the core
// posts, and which of those deliveries are news.

import type { ClineMessage, ExtensionMessage } from "@roo-code/types"

import { DeliveryReader, deliveriesOf } from "../transcript-deliveries.js"

const say = (ts: number, text: string, partial = false): ClineMessage =>
	({ ts, type: "say", say: "text", text, partial }) as ClineMessage

const ask = (ts: number, kind: ClineMessage["ask"], text = ""): ClineMessage =>
	({ ts, type: "ask", ask: kind, text, partial: false }) as ClineMessage

const push = (...messages: ClineMessage[]): ExtensionMessage =>
	({ type: "state", state: { clineMessages: messages.map((m) => ({ ...m })) } }) as unknown as ExtensionMessage

const update = (message: ClineMessage): ExtensionMessage =>
	({ type: "messageUpdated", clineMessage: { ...message } }) as ExtensionMessage

const summary = (deliveries: ReturnType<DeliveryReader["read"]>) =>
	deliveries.map((d) => ({
		ts: d.message.ts,
		text: d.message.text,
		isLast: d.isLast,
		update: d.update,
		history: d.history,
	}))

describe("deliveriesOf", () => {
	it("walks every message of a state push in order and marks the last one", () => {
		expect(deliveriesOf(push(say(1, "a"), say(2, "b"), say(3, "c"))).map((d) => [d.message.ts, d.isLast])).toEqual([
			[1, false],
			[2, false],
			[3, true],
		])
	})

	it("delivers a messageUpdated as the last message", () => {
		expect(deliveriesOf(update(say(7, "x"))).map((d) => [d.message.ts, d.isLast])).toEqual([[7, true]])
	})

	it("delivers nothing for other messages or a push without messages", () => {
		expect(deliveriesOf({ type: "modes", modes: [] } as unknown as ExtensionMessage)).toEqual([])
		expect(deliveriesOf({ type: "state", state: { mode: "code" } } as unknown as ExtensionMessage)).toEqual([])
	})
})

describe("DeliveryReader", () => {
	it("delivers every new message of a push, not only the last one", () => {
		const reader = new DeliveryReader()
		reader.read(push(say(1, "prompt")))

		expect(summary(reader.read(push(say(1, "prompt"), say(2, "first"), say(3, "second"))))).toEqual([
			{ ts: 2, text: "first", isLast: false, update: false, history: false },
			{ ts: 3, text: "second", isLast: true, update: false, history: false },
		])
	})

	it("drops a pure replay: same ts, same text, same partial flag", () => {
		const reader = new DeliveryReader()
		reader.read(push(say(1, "prompt"), say(2, "Dzi", true)))

		expect(reader.read(push(say(1, "prompt"), say(2, "Dzi", true)))).toEqual([])
	})

	it("delivers a changed text or a finalization under the same ts", () => {
		const reader = new DeliveryReader()
		reader.read(push(say(1, "Hel", true)))

		expect(summary(reader.read(update(say(1, "Hello", true))))).toEqual([
			{ ts: 1, text: "Hello", isLast: true, update: true, history: false },
		])
		expect(reader.read(update(say(1, "Hello", false))).map((d) => d.message.partial)).toEqual([false])
		// The push that follows carries what the update already delivered.
		expect(reader.read(push(say(1, "Hello", false)))).toEqual([])
	})

	it("delivers a price written into api_req_started in place", () => {
		const reader = new DeliveryReader()
		const started = { ts: 2, type: "say", say: "api_req_started", text: '{"request":"r"}' } as ClineMessage
		reader.read(push(started))

		const priced = { ...started, text: '{"request":"r","cost":0.5}' }
		expect(reader.read(push(priced)).map((d) => d.message.text)).toEqual([priced.text])
	})

	it("delivers a condensing cost written in place, which is not in the text", () => {
		const reader = new DeliveryReader()
		const condense = { ts: 3, type: "say", say: "condense_context", text: "" } as ClineMessage
		reader.read(push(condense))

		const priced = {
			...condense,
			contextCondense: { cost: 0.1, prevContextTokens: 10, newContextTokens: 5, summary: "" },
		}
		expect(reader.read(push(priced as ClineMessage))).toHaveLength(1)
	})

	it("marks a resumed task's history until the push that ends with the resume ask", () => {
		const reader = new DeliveryReader()
		reader.beginHistoryReplay()

		const history = [say(1, "Old prompt"), say(2, "Old answer.")]
		expect(summary(reader.read(push(...history))).map((d) => d.history)).toEqual([true, true])
		expect(summary(reader.read(push(...history, ask(3, "resume_task"))))).toEqual([
			{ ts: 3, text: "", isLast: true, update: false, history: true },
		])
		// From here on the task continues: news again.
		expect(summary(reader.read(push(...history, ask(3, "resume_task"), say(4, "New answer."))))).toEqual([
			{ ts: 4, text: "New answer.", isLast: true, update: false, history: false },
		])
	})

	it("ends the history at a resume ask that already closes the history push", () => {
		const reader = new DeliveryReader()
		reader.beginHistoryReplay()

		expect(
			summary(reader.read(push(say(1, "Old"), ask(2, "resume_completed_task")))).map((d) => d.history),
		).toEqual([true, true])
		expect(summary(reader.read(update(say(3, "New")))).map((d) => d.history)).toEqual([false])
	})

	it("forgets messages that left the transcript (a new task starts from scratch)", () => {
		const reader = new DeliveryReader()
		reader.read(push(say(1, "same text")))
		reader.read(push())

		expect(reader.read(push(say(1, "same text")))).toHaveLength(1)
	})

	it("reset forgets what was delivered and ends a history replay", () => {
		const reader = new DeliveryReader()
		reader.beginHistoryReplay()
		reader.read(push(say(1, "a")))
		reader.reset()

		expect(summary(reader.read(push(say(1, "a"))))).toEqual([
			{ ts: 1, text: "a", isLast: true, update: false, history: false },
		])
	})
})
