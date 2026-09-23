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
