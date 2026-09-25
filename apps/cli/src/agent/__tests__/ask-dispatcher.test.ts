import type { ClineMessage, WebviewMessage } from "@roo-code/types"

import { AskDispatcher } from "../ask-dispatcher.js"
import type { OutputManager } from "../output-manager.js"
import type { PromptManager } from "../prompt-manager.js"

function createDispatcher({ approve }: { approve: boolean }) {
	const output: string[] = []
	const sent: WebviewMessage[] = []

	const outputManager = {
		output: (line: string) => output.push(line),
		markDisplayed: () => {},
	} as unknown as OutputManager

	const promptManager = {
		promptForYesNo: async () => approve,
	} as unknown as PromptManager

	const dispatcher = new AskDispatcher({
		outputManager,
		promptManager,
		sendMessage: (message) => sent.push(message),
		nonInteractive: false,
	})

	return { dispatcher, output, sent }
}

function mcpAsk(text: Record<string, unknown>): ClineMessage {
	return { ts: 1, type: "ask", ask: "use_mcp_server", text: JSON.stringify(text), partial: false }
}

describe("AskDispatcher MCP approval (print mode with --require-approval)", () => {
	it("names the server, the tool and the arguments the core sends", async () => {
		const { dispatcher, output, sent } = createDispatcher({ approve: true })

		await dispatcher.handleAsk(
			mcpAsk({
				type: "use_mcp_tool",
				serverName: "searxNcrawl",
				toolName: "search",
				arguments: JSON.stringify({ query: "tumble" }),
			}),
		)

		expect(output).toContain("  Server: searxNcrawl")
		expect(output).toContain("  Tool: search")
		expect(output).toContain('      "query": "tumble"')
		expect(sent).toEqual([{ type: "askResponse", askResponse: "yesButtonClicked" }])
	})

	it("names the resource URI", async () => {
		const { dispatcher, output, sent } = createDispatcher({ approve: false })

		await dispatcher.handleAsk(mcpAsk({ type: "access_mcp_resource", serverName: "docs", uri: "docs://readme" }))

		expect(output).toContain("  Server: docs")
		expect(output).toContain("  Resource: docs://readme")
		expect(sent).toEqual([{ type: "askResponse", askResponse: "noButtonClicked" }])
	})
})

describe("AskDispatcher follow-up questions (print mode)", () => {
	// DEF-C28: the timeout default was suggestions[0].answer, so a blank first
	// suggestion sent an empty reply although "Yes" was offered.
	it("defaults to the first suggestion with a usable answer when the prompt times out", async () => {
		const sent: WebviewMessage[] = []
		const promptManager = {
			promptWithTimeout: async (_prompt: string, _timeoutMs: number, defaultValue: string) => ({
				value: defaultValue,
				timedOut: true,
				cancelled: false,
			}),
		} as unknown as PromptManager
		const dispatcher = new AskDispatcher({
			outputManager: { output: () => {}, markDisplayed: () => {} } as unknown as OutputManager,
			promptManager,
			sendMessage: (message) => sent.push(message),
			nonInteractive: true,
		})

		await dispatcher.handleAsk({
			ts: 1,
			type: "ask",
			ask: "followup",
			text: JSON.stringify({ question: "Proceed?", suggest: [{ answer: " " }, { answer: "Yes" }] }),
			partial: false,
		})

		expect(sent).toEqual([{ type: "askResponse", askResponse: "messageResponse", text: "Yes" }])
	})
})

describe("AskDispatcher api_req_failed in non-interactive print mode", () => {
	// Non-interactive print mode always runs with auto-approval on (permission
	// mode "allow"), where the core retries every transient error itself and
	// asks api_req_failed only for errors a retry cannot fix (401, 403, 404).
	// The dispatcher used to print "[retrying api request]" and send nothing,
	// so the task waited on the ask forever.
	it("declines the retry and says why, instead of leaving the ask unanswered", async () => {
		const output: string[] = []
		const sent: WebviewMessage[] = []
		const promptForYesNo = vi.fn()
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
		const dispatcher = new AskDispatcher({
			outputManager: {
				output: (...parts: string[]) => output.push(parts.join(" ")),
				markDisplayed: () => {},
			} as unknown as OutputManager,
			promptManager: { promptForYesNo } as unknown as PromptManager,
			sendMessage: (message) => sent.push(message),
			nonInteractive: true,
		})

		const result = await dispatcher.handleAsk({
			ts: 7,
			type: "ask",
			ask: "api_req_failed",
			text: "OpenAI completion error: 401 Incorrect API key provided",
			partial: false,
		})

		expect(sent).toEqual([{ type: "askResponse", askResponse: "noButtonClicked" }])
		expect(result).toMatchObject({ handled: true, response: "noButtonClicked" })
		expect(promptForYesNo).not.toHaveBeenCalled()
		expect(output.join("\n")).toContain("401 Incorrect API key provided")
		expect(output.join("\n")).not.toContain("[retrying api request]")
		expect(output.join("\n")).toContain("not retrying")
		// The exit itself belongs to the host (run.ts shuts down cleanly with code 1).
		expect(exit).not.toHaveBeenCalled()
		exit.mockRestore()
	})
})
