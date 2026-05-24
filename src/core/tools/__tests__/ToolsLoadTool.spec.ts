// npx vitest run src/core/tools/__tests__/ToolsLoadTool.spec.ts
import type OpenAI from "openai"

import { ToolsLoadTool } from "../ToolsLoadTool"
import type { Task } from "../../task/Task"
import type { ToolCallbacks } from "../BaseTool"
import type { ToolUse } from "../../../shared/tools"

const mcpTool = (server: string, tool: string): OpenAI.Chat.ChatCompletionFunctionTool => ({
	type: "function",
	function: {
		name: `mcp--${server}--${tool}`,
		description: `MCP ${tool} on ${server}. Long description that spans many sentences.`,
		parameters: {
			type: "object",
			properties: { city: { type: "string" } },
			required: ["city"],
			additionalProperties: false,
		},
	},
})

interface MockTaskState {
	materialized: Set<string>
	mistakes: number
	errors: string[]
}

function makeTask(deferredCatalog: OpenAI.Chat.ChatCompletionFunctionTool[]): { task: Task; state: MockTaskState } {
	const state: MockTaskState = {
		materialized: new Set<string>(),
		mistakes: 0,
		errors: [],
	}
	const task = {
		materializedDeferredTools: state.materialized,
		deferredToolDirectory: new Map(deferredCatalog.map((t) => [t.function.name, t])),
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		recordToolError: (_name: string, msg?: string) => {
			if (msg) state.errors.push(msg)
		},
		askSay: { say: vi.fn(async () => undefined) },
	} as unknown as Task
	return { task, state }
}

function makeCallbacks(): { callbacks: ToolCallbacks; results: string[] } {
	const results: string[] = []
	const callbacks: ToolCallbacks = {
		askApproval: vi.fn(async () => true),
		handleError: vi.fn(async () => undefined),
		pushToolResult: (content) => {
			results.push(typeof content === "string" ? content : JSON.stringify(content))
		},
		toolCallId: "test-call-1",
	}
	return { callbacks, results }
}

describe("ToolsLoadTool", () => {
	it("returns an error and increments mistakes when names is empty", async () => {
		const { task, state } = makeTask([mcpTool("weather", "get_current")])
		const { callbacks, results } = makeCallbacks()
		const handler = new ToolsLoadTool()
		const block: ToolUse<"tools_load"> = {
			type: "tool_use",
			name: "tools_load",
			params: {},
			nativeArgs: { names: [] },
			partial: false,
			id: "block-1",
		}
		await handler.handle(task, block, callbacks)
		expect(state.materialized.size).toBe(0)
		expect(results).toHaveLength(1)
		expect(results[0]).toMatch(/at least one/i)
	})

	it("reports unknown names without mutating state", async () => {
		const { task, state } = makeTask([mcpTool("weather", "get_current")])
		const { callbacks, results } = makeCallbacks()
		const handler = new ToolsLoadTool()
		const block: ToolUse<"tools_load"> = {
			type: "tool_use",
			name: "tools_load",
			params: {},
			nativeArgs: { names: ["does_not_exist", "also_not_here"] },
			partial: false,
			id: "block-2",
		}
		await handler.handle(task, block, callbacks)
		expect(state.materialized.size).toBe(0)
		expect(results).toHaveLength(1)
		expect(results[0]).toContain("does_not_exist")
		expect(results[0]).toContain("also_not_here")
	})

	it("materializes a single known deferred MCP tool and returns its full schema", async () => {
		const tool = mcpTool("weather", "get_current")
		const { task, state } = makeTask([tool])
		const { callbacks, results } = makeCallbacks()
		const handler = new ToolsLoadTool()
		const block: ToolUse<"tools_load"> = {
			type: "tool_use",
			name: "tools_load",
			params: {},
			nativeArgs: { names: ["mcp--weather--get_current"] },
			partial: false,
			id: "block-3",
		}
		await handler.handle(task, block, callbacks)
		expect(state.materialized.has("mcp--weather--get_current")).toBe(true)
		expect(results).toHaveLength(1)
		const payload = results[0]
		expect(payload).toContain("mcp--weather--get_current")
		// The full schema (parameters) must be inlined so the model can call it next turn
		expect(payload).toContain('"city"')
		expect(payload).toContain('"parameters"')
	})

	it("partitions a mixed batch into materialized + unknown + already_active", async () => {
		const known = mcpTool("weather", "get_current")
		const { task, state } = makeTask([known])
		state.materialized.add("mcp--weather--get_current") // simulate already-loaded
		const { callbacks, results } = makeCallbacks()
		const handler = new ToolsLoadTool()
		const block: ToolUse<"tools_load"> = {
			type: "tool_use",
			name: "tools_load",
			params: {},
			nativeArgs: { names: ["mcp--weather--get_current", "ghost_tool"] },
			partial: false,
			id: "block-4",
		}
		await handler.handle(task, block, callbacks)
		expect(results).toHaveLength(1)
		const payload = results[0]
		// Already-materialized name appears under already_active, not loaded
		expect(payload).toContain("already_active")
		expect(payload).toContain("mcp--weather--get_current")
		expect(payload).toContain("unknown")
		expect(payload).toContain("ghost_tool")
	})
})
