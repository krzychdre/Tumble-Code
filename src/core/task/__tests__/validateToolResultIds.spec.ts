import { Anthropic } from "@anthropic-ai/sdk"
import type { ConversationMessage } from "../../../api/transform/conversation-message"
import { TelemetryService } from "@tumble-code/telemetry"
import {
	validateAndFixToolResultIds,
	ToolResultIdMismatchError,
	MissingToolResultError,
} from "../validateToolResultIds"

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		hasInstance: vi.fn(() => true),
		instance: {
			captureException: vi.fn(),
		},
	},
}))

const INTERRUPTED = "Tool execution was interrupted before completion."

type Block = Anthropic.ToolResultBlockParam | Anthropic.TextBlockParam

const toolUse = (id: string): Anthropic.ToolUseBlockParam => ({
	type: "tool_use",
	id,
	name: "read_file",
	input: { path: `${id}.txt` },
})
const result = (id: string, content = `content of ${id}`): Anthropic.ToolResultBlockParam => ({
	type: "tool_result",
	tool_use_id: id,
	content,
})
const text = (value: string): Anthropic.TextBlockParam => ({ type: "text", text: value })

const assistant = (...ids: string[]): ConversationMessage => ({ role: "assistant", content: ids.map(toolUse) })
const user = (...content: Block[]): ConversationMessage => ({ role: "user", content })

function fix(userMessage: ConversationMessage, history: ConversationMessage[], onRepair?: (e: Error) => void) {
	return validateAndFixToolResultIds(userMessage, history, onRepair).content as Block[]
}

/** Compact view of the content: tool_result blocks as `id:content`, text blocks as `text:value`. */
function shape(content: Block[]): string[] {
	return content.map((b) => (b.type === "tool_result" ? `${b.tool_use_id}:${b.content}` : `text:${b.text}`))
}

describe("validateAndFixToolResultIds", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(TelemetryService.hasInstance).mockReturnValue(true)
	})

	it.each<[string, ConversationMessage, ConversationMessage[]]>([
		["there is no assistant message", user(result("t1")), []],
		["the assistant content is a string", user(result("t1")), [{ role: "assistant", content: "no tools" }]],
		["the assistant made no tool calls", user(result("t1")), [{ role: "assistant", content: [text("hi")] }]],
		["the user content is a string", { role: "user", content: "plain" }, [assistant("t1")]],
		["the message is not a user message", { role: "assistant", content: [toolUse("x")] }, [assistant("t1")]],
		["every tool call has its result", user(result("t1"), text("ctx"), result("t2")), [assistant("t1", "t2")]],
	])("returns the message unchanged when %s", (_label, message, history) => {
		const onRepair = vi.fn()

		expect(validateAndFixToolResultIds(message, history, onRepair)).toEqual(message)
		expect(onRepair).not.toHaveBeenCalled()
		expect(TelemetryService.instance.captureException).not.toHaveBeenCalled()
	})

	it("matches against the LAST assistant message in history", () => {
		const history = [assistant("old"), user(result("old")), assistant("new")]

		expect(shape(fix(user(result("wrong")), history))).toEqual(["new:content of wrong"])
	})

	it.each<[string, ConversationMessage, string[], string[]]>([
		["one wrong id", user(result("wrong")), ["t1"], ["t1:content of wrong"]],
		[
			"several wrong ids, fixed by position",
			user(result("w1"), result("w2")),
			["t1", "t2"],
			["t1:content of w1", "t2:content of w2"],
		],
		[
			"one right and one wrong id",
			user(result("t1"), result("wrong")),
			["t1", "t2"],
			["t1:content of t1", "t2:content of wrong"],
		],
		[
			"a wrong id next to a text block",
			user(result("wrong"), text("ctx")),
			["t1"],
			["t1:content of wrong", "text:ctx"],
		],
		[
			"more results than calls (the extra one is dropped)",
			user(result("w1"), text("ctx"), result("extra")),
			["t1"],
			["t1:content of w1", "text:ctx"],
		],
		[
			// PostHog incident: 2 tool_results (call_08230257, call_55577629), 1 tool_use (call_55577629).
			"an invalid id before the valid one (the valid one becomes the duplicate)",
			user(result("call_08230257", "first"), result("call_55577629", "second")),
			["call_55577629"],
			["call_55577629:first"],
		],
		[
			// GitHub #10465: the terminal fallback race produced two results with the same valid id.
			"two results with the same valid id",
			user(result("t1", "first"), text("env"), result("t1", "approved")),
			["t1"],
			["t1:first", "text:env"],
		],
		[
			"fewer results than calls (the missing one is prepended)",
			user(result("wrong")),
			["t1", "t2"],
			[`t2:${INTERRUPTED}`, "t1:content of wrong"],
		],
		[
			"an existing result for only some calls",
			user(result("t1")),
			["t1", "t2"],
			[`t2:${INTERRUPTED}`, "t1:content of t1"],
		],
		["no results at all", user(text("msg")), ["t1", "t2"], [`t1:${INTERRUPTED}`, `t2:${INTERRUPTED}`, "text:msg"]],
		["empty content", user(), ["t1"], [`t1:${INTERRUPTED}`]],
	])("repairs %s", (_label, message, toolUseIds, expected) => {
		expect(shape(fix(message, [assistant(...toolUseIds)]))).toEqual(expected)
	})

	it("reports a wrong id as both a missing result and a mismatch, to onRepair and telemetry", () => {
		const onRepair = vi.fn()

		fix(user(result("wrong")), [assistant("t1", "t2")], onRepair)

		const errors = onRepair.mock.calls.map(([e]) => e)
		expect(errors.map((e) => e.constructor)).toEqual([MissingToolResultError, ToolResultIdMismatchError])
		expect(errors[0]).toMatchObject({ missingToolUseIds: ["t1", "t2"], existingToolResultIds: ["wrong"] })
		expect(errors[1]).toMatchObject({ toolResultIds: ["wrong"], toolUseIds: ["t1", "t2"] })

		const capture = vi.mocked(TelemetryService.instance.captureException)
		expect(capture.mock.calls).toEqual([
			[
				errors[0],
				{
					missingToolUseIds: ["t1", "t2"],
					existingToolResultIds: ["wrong"],
					toolUseCount: 2,
					toolResultCount: 1,
				},
			],
			[errors[1], { toolResultIds: ["wrong"], toolUseIds: ["t1", "t2"], toolResultCount: 1, toolUseCount: 2 }],
		])
	})

	it("reports only a missing result when no id is wrong", () => {
		const onRepair = vi.fn()

		fix(user(text("msg")), [assistant("t1")], onRepair)

		expect(onRepair).toHaveBeenCalledTimes(1)
		expect(onRepair.mock.calls[0][0]).toBeInstanceOf(MissingToolResultError)
		expect(TelemetryService.instance.captureException).toHaveBeenCalledTimes(1)
	})

	it("still repairs and calls onRepair without a telemetry instance", () => {
		vi.mocked(TelemetryService.hasInstance).mockReturnValue(false)
		const onRepair = vi.fn()

		expect(shape(fix(user(result("wrong")), [assistant("t1")], onRepair))).toEqual(["t1:content of wrong"])
		expect(onRepair).toHaveBeenCalledTimes(2)
		expect(TelemetryService.instance.captureException).not.toHaveBeenCalled()
	})
})
