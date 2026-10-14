import { NativeToolCallParser } from "../NativeToolCallParser"
import { decodeProseToolArgs } from "../decodeProseToolArgs"

// The wire text of the attempt_completion call in task 01a134d6: the model escaped
// the backslash, so JSON parsing leaves the literal ł in the argument.
const ESCAPED_WIRE = '{"result":"Dok\\\\u0142adnie tak, w kt\\\\u00f3rym `\\\\u0142` zostaje"}'

describe("decodeProseToolArgs", () => {
	it("decodes nested prose strings of ask_followup_question", () => {
		const args = { question: "Kt\\u00f3ry?", follow_up: [{ text: "Tw\\u00f3j", mode: null }] }
		expect(decodeProseToolArgs("ask_followup_question", args)).toEqual({
			question: "Który?",
			follow_up: [{ text: "Twój", mode: null }],
		})
	})

	it("returns the same object when nothing changed", () => {
		const args = { result: "Gotowe, wszystko działa" }
		expect(decodeProseToolArgs("attempt_completion", args)).toBe(args)
	})

	it("leaves file content and commands verbatim", () => {
		const write = { path: "a.js", content: 'const l = "\\u0142"' }
		const command = { command: "printf '\\u0142'" }
		expect(decodeProseToolArgs("write_to_file", write)).toBe(write)
		expect(decodeProseToolArgs("execute_command", command)).toBe(command)
	})
})

describe("NativeToolCallParser with escaped prose", () => {
	it("decodes the final attempt_completion result outside code", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_1",
			name: "attempt_completion",
			arguments: ESCAPED_WIRE,
		})
		expect(toolUse?.type).toBe("tool_use")
		const expected = "Dokładnie tak, w którym `\\u0142` zostaje"
		expect((toolUse as any).nativeArgs).toEqual({ result: expected })
		expect((toolUse as any).params.result).toBe(expected)
	})

	it("decodes the streamed partial result as well", () => {
		const parser = new NativeToolCallParser()
		parser.startStreamingToolCall("call_2", "attempt_completion")
		const partial = parser.processStreamingChunk("call_2", ESCAPED_WIRE.slice(0, 30))
		expect(partial?.params.result).toBe("Dokładnie tak")
	})

	it("keeps a write_to_file payload verbatim", () => {
		const toolUse = NativeToolCallParser.parseToolCall({
			id: "call_3",
			name: "write_to_file",
			arguments: '{"path":"a.js","content":"const l = \\"\\\\u0142\\""}',
		})
		expect((toolUse as any).nativeArgs.content).toBe('const l = "\\u0142"')
	})
})
