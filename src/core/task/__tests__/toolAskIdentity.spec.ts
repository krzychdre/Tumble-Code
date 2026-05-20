import { getToolCallId, isSameToolInvocation, findToolAskIndexByCallId } from "../toolAskIdentity"

describe("getToolCallId", () => {
	it("returns the stamped toolCallId from a tool payload", () => {
		const text = JSON.stringify({ tool: "readFile", path: "src/a.ts", toolCallId: "call_1" })
		expect(getToolCallId(text)).toBe("call_1")
	})

	it("returns undefined when the payload has no toolCallId", () => {
		expect(getToolCallId(JSON.stringify({ tool: "readFile", path: "src/a.ts" }))).toBeUndefined()
	})

	it("returns undefined when toolCallId is an empty string", () => {
		expect(getToolCallId(JSON.stringify({ tool: "readFile", toolCallId: "" }))).toBeUndefined()
	})

	it("returns undefined for a payload without a string tool field", () => {
		expect(getToolCallId(JSON.stringify({ path: "src/a.ts", toolCallId: "call_1" }))).toBeUndefined()
	})

	it("returns undefined for unparseable or empty text", () => {
		expect(getToolCallId("{not json")).toBeUndefined()
		expect(getToolCallId("")).toBeUndefined()
		expect(getToolCallId(undefined)).toBeUndefined()
	})
})

describe("isSameToolInvocation", () => {
	it("is true when both payloads carry the same toolCallId", () => {
		const a = JSON.stringify({ tool: "readFile", path: "src/a.ts", toolCallId: "call_1" })
		const b = JSON.stringify({ tool: "readFile", path: "src/a.ts", content: "/abs", toolCallId: "call_1" })
		expect(isSameToolInvocation(a, b)).toBe(true)
	})

	it("is false when the toolCallIds differ", () => {
		const a = JSON.stringify({ tool: "readFile", path: "src/a.ts", toolCallId: "call_1" })
		const b = JSON.stringify({ tool: "readFile", path: "src/a.ts", toolCallId: "call_2" })
		expect(isSameToolInvocation(a, b)).toBe(false)
	})

	it("is false when either side lacks a toolCallId (so callers fall back to exact-text)", () => {
		const withId = JSON.stringify({ tool: "readFile", toolCallId: "call_1" })
		const noId = JSON.stringify({ tool: "readFile" })
		expect(isSameToolInvocation(withId, noId)).toBe(false)
		expect(isSameToolInvocation(noId, noId)).toBe(false)
	})
})

describe("findToolAskIndexByCallId", () => {
	const toolAsk = (id: string) => ({
		type: "ask" as const,
		ask: "tool",
		text: JSON.stringify({ tool: "readFile", path: "src/a.ts", toolCallId: id }),
	})
	const sayMsg = () => ({ type: "say" as const, text: "intervening" })

	it("finds an ask:tool message by tool-call id even when it is not the tail", () => {
		const messages = [toolAsk("call_1"), sayMsg(), sayMsg()]
		expect(findToolAskIndexByCallId(messages, "call_1")).toBe(0)
	})

	it("returns the most recent match when several share an id is impossible - distinct ids resolve distinctly", () => {
		const messages = [toolAsk("call_1"), sayMsg(), toolAsk("call_2")]
		expect(findToolAskIndexByCallId(messages, "call_1")).toBe(0)
		expect(findToolAskIndexByCallId(messages, "call_2")).toBe(2)
	})

	it("returns -1 when no ask:tool carries the id", () => {
		expect(findToolAskIndexByCallId([toolAsk("call_1"), sayMsg()], "call_x")).toBe(-1)
	})

	it("returns -1 for an empty or undefined id", () => {
		expect(findToolAskIndexByCallId([toolAsk("call_1")], "")).toBe(-1)
		expect(findToolAskIndexByCallId([toolAsk("call_1")], undefined)).toBe(-1)
	})

	it("ignores say messages and only matches ask:tool", () => {
		const sayWithToolText = {
			type: "say" as const,
			say: "tool",
			text: JSON.stringify({ tool: "readFile", toolCallId: "call_1" }),
		}
		expect(findToolAskIndexByCallId([sayWithToolText], "call_1")).toBe(-1)
	})

	it("only scans the bounded lookback window from the tail", () => {
		// Place the match beyond the 50-message lookback window; it must not be found.
		const messages = [toolAsk("call_old"), ...Array.from({ length: 60 }, () => sayMsg())]
		expect(findToolAskIndexByCallId(messages, "call_old")).toBe(-1)
	})
})
