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
	it("returns guidance (not an error) when names is empty", async () => {
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
		// New hardened copy explains the requirement and shows a worked example.
		expect(results[0]).toMatch(/non-empty array of strings/i)
		expect(results[0]).toContain(`tools_load({"names":`)
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

	describe("hardening — tolerance for weak models", () => {
		it("treats missing nativeArgs as a guidance request, not an error", async () => {
			const { task, state } = makeTask([mcpTool("weather", "get_current"), mcpTool("github", "get_issue")])
			const { callbacks, results } = makeCallbacks()
			const handler = new ToolsLoadTool()
			const block: ToolUse<"tools_load"> = {
				type: "tool_use",
				name: "tools_load",
				params: {},
				// No nativeArgs at all — the GLM-4.7-FP8 failure shape.
				partial: false,
				id: "block-missing",
			}
			await handler.handle(task, block, callbacks)
			expect(state.materialized.size).toBe(0)
			expect(results).toHaveLength(1)
			// Guidance must include: a clear "names is required" message, the
			// current deferred-tool list, and a literal JSON example.
			const payload = results[0]
			expect(payload).toMatch(/names/i)
			expect(payload).toContain("mcp--weather--get_current")
			expect(payload).toContain("mcp--github--get_issue")
			expect(payload).toContain(`tools_load({"names":`)
		})

		it("treats empty-object nativeArgs ({}) as a guidance request", async () => {
			const { task, state } = makeTask([mcpTool("weather", "get_current")])
			const { callbacks, results } = makeCallbacks()
			const handler = new ToolsLoadTool()
			const block: ToolUse<"tools_load"> = {
				type: "tool_use",
				name: "tools_load",
				params: {},
				nativeArgs: {} as { names: string[] }, // GLM-4.7-FP8 shape
				partial: false,
				id: "block-empty-obj",
			}
			await handler.handle(task, block, callbacks)
			expect(state.materialized.size).toBe(0)
			expect(results).toHaveLength(1)
			const payload = results[0]
			expect(payload).toMatch(/names/i)
			expect(payload).toContain("mcp--weather--get_current")
		})

		it("coerces { names: 'single_string' } into a one-element array", async () => {
			const tool = mcpTool("weather", "get_current")
			const { task, state } = makeTask([tool])
			const { callbacks, results } = makeCallbacks()
			const handler = new ToolsLoadTool()
			const block: ToolUse<"tools_load"> = {
				type: "tool_use",
				name: "tools_load",
				params: {},
				// Some models pass a bare string instead of an array.
				nativeArgs: { names: "mcp--weather--get_current" as unknown as string[] },
				partial: false,
				id: "block-string",
			}
			await handler.handle(task, block, callbacks)
			expect(state.materialized.has("mcp--weather--get_current")).toBe(true)
			expect(results).toHaveLength(1)
			expect(results[0]).toContain('"parameters"')
		})

		it("coerces singular { name: 'foo' } into { names: ['foo'] }", async () => {
			const tool = mcpTool("github", "get_issue")
			const { task, state } = makeTask([tool])
			const { callbacks, results } = makeCallbacks()
			const handler = new ToolsLoadTool()
			const block: ToolUse<"tools_load"> = {
				type: "tool_use",
				name: "tools_load",
				params: {},
				// Singular `name` — another common weak-model shape.
				nativeArgs: { name: "mcp--github--get_issue" } as unknown as { names: string[] },
				partial: false,
				id: "block-singular",
			}
			await handler.handle(task, block, callbacks)
			expect(state.materialized.has("mcp--github--get_issue")).toBe(true)
			expect(results).toHaveLength(1)
		})

		it("guidance message does not increment consecutiveMistakeCount", async () => {
			const { task } = makeTask([mcpTool("weather", "get_current")])
			;(task as unknown as { consecutiveMistakeCount: number }).consecutiveMistakeCount = 7
			const { callbacks } = makeCallbacks()
			const handler = new ToolsLoadTool()
			const block: ToolUse<"tools_load"> = {
				type: "tool_use",
				name: "tools_load",
				params: {},
				nativeArgs: {} as { names: string[] },
				partial: false,
				id: "block-counter",
			}
			await handler.handle(task, block, callbacks)
			// Guidance is not a mistake — model can recover next turn.
			expect((task as unknown as { consecutiveMistakeCount: number }).consecutiveMistakeCount).toBe(7)
		})
	})
})
