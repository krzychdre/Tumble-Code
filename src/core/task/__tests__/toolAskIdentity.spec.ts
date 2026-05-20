import { getToolCallId, isSameToolInvocation } from "../toolAskIdentity"

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
