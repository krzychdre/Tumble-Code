// npx vitest run core/webview/__tests__/subagentActivity.spec.ts

import type { ClineMessage } from "@tumble-code/types"

import { subagentActivity } from "../subagentActivity"

const ask = (ask: string, text: string, partial = false) => ({ ts: 1, type: "ask", ask, text, partial }) as ClineMessage

describe("subagentActivity", () => {
	it("a command: its first line after a $", () => {
		expect(subagentActivity(ask("command", "npm test -- --run\ncd x"))).toBe("$ npm test -- --run")
	})

	it("a tool: its name and path", () => {
		expect(subagentActivity(ask("tool", JSON.stringify({ tool: "appliedDiff", path: "src/game/glass.js" })))).toBe(
			"appliedDiff src/game/glass.js",
		)
		expect(subagentActivity(ask("tool", JSON.stringify({ tool: "listFilesTopLevel" })))).toBe("listFilesTopLevel")
	})

	it("an MCP call: server and tool", () => {
		expect(subagentActivity(ask("use_mcp_server", JSON.stringify({ serverName: "web", toolName: "search" })))).toBe(
			"MCP web/search",
		)
	})

	it("clips a long line", () => {
		const activity = subagentActivity(ask("command", "x".repeat(300))) ?? ""
		expect(activity.length).toBeLessThanOrEqual(123)
		expect(activity.endsWith("…")).toBe(true)
	})

	it("nothing for partial asks, says, other asks or broken payloads", () => {
		expect(subagentActivity(ask("command", "npm", true))).toBeUndefined()
		expect(subagentActivity({ ts: 1, type: "say", say: "text", text: "hi" } as ClineMessage)).toBeUndefined()
		expect(subagentActivity(ask("followup", "?"))).toBeUndefined()
		expect(subagentActivity(ask("tool", "not json"))).toBeUndefined()
	})
})
