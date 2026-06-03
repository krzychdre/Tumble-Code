// npx vitest run src/core/task/__tests__/deferred-tools-resolver.spec.ts
import type OpenAI from "openai"

import { tryAutoMaterializeDirectCall } from "../deferred-tools-resolver"
import type { Task } from "../Task"

const mcpTool = (server: string, tool: string): OpenAI.Chat.ChatCompletionFunctionTool => ({
	type: "function",
	function: {
		name: `mcp--${server}--${tool}`,
		description: `MCP ${tool} on ${server}.`,
		parameters: {
			type: "object",
			properties: { city: { type: "string" } },
			required: ["city"],
			additionalProperties: false,
		},
	},
})

function makeTask(deferred: OpenAI.Chat.ChatCompletionFunctionTool[]): Task {
	return {
		materializedDeferredTools: new Set<string>(),
		deferredToolDirectory: new Map(deferred.map((t) => [t.function.name, t])),
	} as unknown as Task
}

describe("tryAutoMaterializeDirectCall", () => {
	it("returns null when the deferredTools experiment is OFF", () => {
		const task = makeTask([mcpTool("weather", "get_current")])
		const result = tryAutoMaterializeDirectCall({
			task,
			blockName: "mcp--weather--get_current",
			nativeArgs: { city: "Warsaw" },
			experiments: { deferredTools: false },
		})
		expect(result).toBeNull()
		// Must not mutate state when experiment is off — byte-identical behaviour.
		expect(task.materializedDeferredTools.size).toBe(0)
	})

	it("returns null when the experiments object is missing entirely", () => {
		const task = makeTask([mcpTool("weather", "get_current")])
		const result = tryAutoMaterializeDirectCall({
			task,
			blockName: "mcp--weather--get_current",
			nativeArgs: { city: "Warsaw" },
			experiments: undefined,
		})
		expect(result).toBeNull()
		expect(task.materializedDeferredTools.size).toBe(0)
	})

	it("returns null when the block name is NOT in the deferred directory (typo fallthrough)", () => {
		const task = makeTask([mcpTool("weather", "get_current")])
		const result = tryAutoMaterializeDirectCall({
			task,
			blockName: "mcp--weather--get_currrent", // typo
			nativeArgs: { city: "Warsaw" },
			experiments: { deferredTools: true },
		})
		expect(result).toBeNull()
		// Must NOT add a typo to the materialized set.
		expect(task.materializedDeferredTools.size).toBe(0)
	})

	it("materializes a deferred tool and signals 'ready' when args are valid", () => {
		const task = makeTask([mcpTool("weather", "get_current")])
		const result = tryAutoMaterializeDirectCall({
			task,
			blockName: "mcp--weather--get_current",
			nativeArgs: { city: "Warsaw" },
			experiments: { deferredTools: true },
		})
		expect(result).not.toBeNull()
		expect(result!.kind).toBe("ready")
		// Side effect: the name is now in the materialized set so subsequent
		// turns include the schema in the active tools array.
		expect(task.materializedDeferredTools.has("mcp--weather--get_current")).toBe(true)
	})

	it("materializes the tool and returns 'guidance' when nativeArgs is missing", () => {
		const task = makeTask([mcpTool("weather", "get_current")])
		const result = tryAutoMaterializeDirectCall({
			task,
			blockName: "mcp--weather--get_current",
			nativeArgs: undefined,
			experiments: { deferredTools: true },
		})
		expect(result).not.toBeNull()
		expect(result!.kind).toBe("guidance")
		expect(task.materializedDeferredTools.has("mcp--weather--get_current")).toBe(true)
		const guidance = result!.kind === "guidance" ? result!.payload : ""
		// Guidance must inline the schema so the model can retry next turn.
		expect(guidance).toContain("mcp--weather--get_current")
		expect(guidance).toContain("city") // schema property name
		expect(guidance).toMatch(/parameters|schema/i)
	})

	it("returns 'guidance' when required args are absent from nativeArgs", () => {
		const task = makeTask([mcpTool("weather", "get_current")])
		const result = tryAutoMaterializeDirectCall({
			task,
			blockName: "mcp--weather--get_current",
			nativeArgs: {}, // empty object — required `city` missing
			experiments: { deferredTools: true },
		})
		expect(result).not.toBeNull()
		expect(result!.kind).toBe("guidance")
		expect(task.materializedDeferredTools.has("mcp--weather--get_current")).toBe(true)
	})

	it("returns 'ready' (idempotent) when the tool was already materialized", () => {
		const task = makeTask([mcpTool("weather", "get_current")])
		task.materializedDeferredTools.add("mcp--weather--get_current")
		const result = tryAutoMaterializeDirectCall({
			task,
			blockName: "mcp--weather--get_current",
			nativeArgs: { city: "Warsaw" },
			experiments: { deferredTools: true },
		})
		expect(result).not.toBeNull()
		expect(result!.kind).toBe("ready")
	})
})
