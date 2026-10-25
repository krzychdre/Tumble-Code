// npx vitest run packages/core/src/message-utils/__tests__/consolidateCommands.spec.ts

import type { ClineMessage } from "@tumble-code/types"

import { consolidateCommands } from "../consolidateCommands.js"

let ts = 0
const ask = (kind: "command" | "command_output" | "use_mcp_server", text?: string): ClineMessage => ({
	type: "ask",
	ask: kind,
	text,
	ts: ++ts,
})
const say = (kind: "command_output" | "mcp_server_response" | "text", text?: string): ClineMessage => ({
	type: "say",
	say: kind,
	text,
	ts: ++ts,
})
const withText = (message: ClineMessage, text: string): ClineMessage => ({ ...message, text })

describe("consolidateCommands", () => {
	it("returns an empty list unchanged", () => {
		expect(consolidateCommands([])).toEqual([])
	})

	describe("commands", () => {
		it("appends every output after an Output: marker, keeping messages around it", () => {
			const before = say("text", "before")
			const command = ask("command", "ls")
			const after = say("text", "after")

			expect(
				consolidateCommands([
					before,
					command,
					ask("command_output", "a.txt"),
					say("command_output", "b.txt"),
					after,
				]),
			).toEqual([before, withText(command, "ls\nOutput:a.txt\nb.txt"), after])
		})

		it("keeps the outputs of consecutive commands apart", () => {
			const ls = ask("command", "ls")
			const pwd = ask("command", "pwd")

			expect(consolidateCommands([ls, ask("command_output", "one"), pwd, ask("command_output", "two")])).toEqual([
				withText(ls, "ls\nOutput:one"),
				withText(pwd, "pwd\nOutput:two"),
			])
		})

		it.each<[string, () => ClineMessage[], string]>([
			["a command without output", () => [ask("command", "ls")], "ls"],
			["a command without text", () => [ask("command"), ask("command_output", "out")], "\nOutput:out"],
			["an empty output", () => [ask("command", "ls"), ask("command_output", "")], "ls\nOutput:"],
			[
				"the same output streamed as ask and as say",
				() => [ask("command", "ls"), ask("command_output", "same"), say("command_output", "same")],
				"ls\nOutput:same",
			],
			[
				"a repeated output of one kind",
				() => [ask("command", "ls"), say("command_output", "x"), say("command_output", "x")],
				"ls\nOutput:x\nx",
			],
		])("builds the text for %s", (_name, build, expected) => {
			const [command, ...rest] = build()

			expect(consolidateCommands([command!, ...rest])).toEqual([withText(command!, expected)])
		})

		it("drops an output that follows no command", () => {
			const note = say("text", "note")

			expect(consolidateCommands([say("command_output", "stray"), note])).toEqual([note])
		})
	})

	describe("MCP requests", () => {
		it("adds every response to the request's JSON, skipping messages in between", () => {
			const request = ask("use_mcp_server", JSON.stringify({ serverName: "s", toolName: "t" }))
			const note = say("text", "note")

			expect(
				consolidateCommands([
					request,
					say("mcp_server_response", "one"),
					note,
					say("mcp_server_response", "two"),
				]),
			).toEqual([
				withText(request, JSON.stringify({ serverName: "s", toolName: "t", response: "one\ntwo" })),
				note,
			])
		})

		it("stops collecting at the next request", () => {
			const first = ask("use_mcp_server", JSON.stringify({ serverName: "a" }))
			const second = ask("use_mcp_server", JSON.stringify({ serverName: "b" }))

			expect(
				consolidateCommands([first, say("mcp_server_response", "1"), second, say("mcp_server_response", "2")]),
			).toEqual([
				withText(first, JSON.stringify({ serverName: "a", response: "1" })),
				withText(second, JSON.stringify({ serverName: "b", response: "2" })),
			])
		})

		it.each<[string, string | undefined, string | undefined, string]>([
			["an unreadable request", "{broken", "r", JSON.stringify({ response: "r" })],
			["a request without text", undefined, "r", JSON.stringify({ response: "r" })],
			[
				"a response without text",
				JSON.stringify({ serverName: "s" }),
				undefined,
				JSON.stringify({ serverName: "s", response: "" }),
			],
		])("handles %s", (_name, requestText, responseText, expected) => {
			vi.spyOn(console, "error").mockImplementation(() => {})
			const request = ask("use_mcp_server", requestText)

			expect(consolidateCommands([request, say("mcp_server_response", responseText)])).toEqual([
				withText(request, expected),
			])
			vi.restoreAllMocks()
		})

		it("keeps a request without a response as it is", () => {
			const request = ask("use_mcp_server", JSON.stringify({ serverName: "s" }))

			expect(consolidateCommands([request])).toEqual([request])
		})
	})

	it("handles a command next to an MCP request", () => {
		const command = ask("command", "ls")
		const request = ask("use_mcp_server", JSON.stringify({ serverName: "s" }))

		expect(
			consolidateCommands([command, ask("command_output", "f"), request, say("mcp_server_response", "r")]),
		).toEqual([
			withText(command, "ls\nOutput:f"),
			withText(request, JSON.stringify({ serverName: "s", response: "r" })),
		])
	})
})
