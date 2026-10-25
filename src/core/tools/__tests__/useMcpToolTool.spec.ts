// UseMcpToolTool with the real response formatting and abort wiring; the task, its provider and
// the MCP hub (the server boundary) are replaced. The per-mode server allowlist itself is tested
// in mcpServerRestriction.spec.ts.

import { EventEmitter } from "events"
import type { Mock } from "vitest"

import { TumbleCodeEventName } from "@tumble-code/types"

import { useMcpToolTool } from "../UseMcpToolTool"
import { formatResponse } from "../../prompts/responses"
import { Task } from "../../task/Task"
import { logger } from "../../../utils/logging"

vi.mock("../../../i18n", () => ({
	t: (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}))

type Server = { name: string; tools?: Array<{ name: string; enabledForPrompt?: boolean }> }

const SERVERS: Server[] = [
	{ name: "test_server", tools: [{ name: "test-tool" }, { name: "off", enabledForPrompt: false }] },
	{ name: "empty_server", tools: [] },
]

describe("useMcpToolTool", () => {
	let mockTask: Partial<Task>
	let mockAskApproval: Mock
	let mockHandleError: Mock
	let mockPushToolResult: Mock
	let mockProviderRef: any
	let callTool: Mock
	let postMessageToWebview: Mock
	let getAllServers: Mock

	beforeEach(() => {
		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn()
		mockPushToolResult = vi.fn()
		callTool = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "done" }] })
		postMessageToWebview = vi.fn()
		getAllServers = vi.fn().mockReturnValue(SERVERS)

		mockProviderRef = {
			deref: vi.fn().mockReturnValue({
				getMcpHub: () => ({ callTool, getAllServers }),
				getState: async () => ({}),
				postMessageToWebview,
			}),
		}

		// A real emitter, like Task: the tool listens for TaskAborted to cancel its call.
		mockTask = Object.assign(new EventEmitter(), {
			consecutiveMistakeCount: 2,
			didToolFailInCurrentTurn: false,
			recordToolError: vi.fn(),
			sayAndCreateMissingParamError: vi.fn(async (_tool: string, param: string) => `missing ${param}`),
			say: vi.fn(),
			ask: vi.fn().mockResolvedValue({}),
			getTaskMode: vi.fn().mockResolvedValue("code"),
			lastMessageTs: 123456789,
			providerRef: mockProviderRef,
		}) as unknown as Partial<Task>
		vi.spyOn(logger, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	const run = (params: Record<string, unknown>, partial = false) =>
		useMcpToolTool.handle(
			mockTask as Task,
			{ type: "tool_use", name: "use_mcp_tool", params, nativeArgs: params, partial } as any,
			{ askApproval: mockAskApproval, handleError: mockHandleError, pushToolResult: mockPushToolResult },
		)
	const call = (extra: Record<string, unknown> = {}) =>
		run({ server_name: "test_server", tool_name: "test-tool", ...extra })
	const statuses = () => postMessageToWebview.mock.calls.map(([m]) => JSON.parse(m.text))

	it.each([
		[{ tool_name: "t" }, "server_name"],
		[{ server_name: "s" }, "tool_name"],
	])("reports %j as missing its %s", async (params, param) => {
		await run(params)

		expect(mockPushToolResult).toHaveBeenCalledWith(`missing ${param}`)
		expect(mockTask.consecutiveMistakeCount).toBe(3)
		expect(callTool).not.toHaveBeenCalled()
	})

	it.each([
		[{ a: 1 }, { a: 1 }],
		// Weak models send the arguments as a JSON string.
		['{"headless": true}', { headless: true }],
		[undefined, undefined],
	])("passes the arguments %j to the server as %j", async (args, passed) => {
		await call({ arguments: args })

		expect(callTool).toHaveBeenCalledWith("test_server", "test-tool", passed, undefined, expect.anything())
		expect(JSON.parse(mockAskApproval.mock.calls[0][1]).arguments).toBe(passed ? JSON.stringify(passed) : undefined)
	})

	it.each([["not json"], [[1, 2]], [5], [null]])("refuses the arguments %j", async (args) => {
		await call({ arguments: args })

		expect(mockTask.say).toHaveBeenCalledWith("error", expect.stringContaining("mcp:errors.invalidJsonArgument"))
		expect(mockPushToolResult).toHaveBeenCalledWith(
			formatResponse.toolError(formatResponse.invalidMcpToolArgumentError("test_server", "test-tool")),
		)
		expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		expect(callTool).not.toHaveBeenCalled()
	})

	it.each([
		[
			"an unknown server",
			{ server_name: "nope" },
			SERVERS,
			formatResponse.unknownMcpServerError("nope", ["test_server", "empty_server"]),
		],
		[
			"an unknown server with none configured",
			{ server_name: "nope" },
			[],
			formatResponse.unknownMcpServerError("nope", []),
		],
		[
			"a server without tools",
			{ server_name: "empty_server" },
			SERVERS,
			formatResponse.unknownMcpToolError("empty_server", "test-tool", []),
		],
		[
			"an unknown tool",
			{ tool_name: "nope" },
			SERVERS,
			formatResponse.unknownMcpToolError("test_server", "nope", ["test-tool", "off"]),
		],
		[
			"a disabled tool",
			{ tool_name: "off" },
			SERVERS,
			formatResponse.unknownMcpToolError("test_server", "off", ["test-tool"]),
		],
	])("refuses %s, listing what is there", async (_, params, servers, result) => {
		getAllServers.mockReturnValue(servers)

		await call(params)

		expect(mockPushToolResult).toHaveBeenCalledWith(result)
		expect(mockTask.say).toHaveBeenCalledWith("error", expect.stringContaining("mcp:errors."))
		expect(mockTask.didToolFailInCurrentTurn).toBe(true)
		expect(mockAskApproval).not.toHaveBeenCalled()
	})

	it("refuses a server the mode does not allow, before asking", async () => {
		mockProviderRef.deref().getState = async () => ({
			customModePrompts: { code: { allowedMcpServers: ["other"] } },
		})

		await call()

		expect(mockAskApproval).not.toHaveBeenCalled()
		expect(callTool).not.toHaveBeenCalled()
	})

	it("calls the server's own spelling of a tool name the model mangled", async () => {
		await call({ tool_name: "test_tool" })

		expect(JSON.parse(mockAskApproval.mock.calls[0][1])).toMatchObject({
			type: "use_mcp_tool",
			toolName: "test-tool",
		})
		expect(callTool).toHaveBeenCalledWith("test_server", "test-tool", undefined, undefined, expect.anything())
	})

	it("calls through when the server list cannot be read", async () => {
		getAllServers.mockImplementation(() => {
			throw new Error("hub not ready")
		})

		await call()

		expect(callTool).toHaveBeenCalled()
	})

	it("runs the call after approval and reports each step", async () => {
		await call()

		expect(mockTask.consecutiveMistakeCount).toBe(0)
		expect(mockTask.say).toHaveBeenCalledWith("mcp_server_request_started")
		expect(statuses()).toEqual([
			{ executionId: "123456789", status: "started", serverName: "test_server", toolName: "test-tool" },
			{ executionId: "123456789", status: "output", response: "done" },
			{ executionId: "123456789", status: "completed", response: "done" },
		])
		expect(mockTask.say).toHaveBeenCalledWith("mcp_server_response", "done", [])
		expect(mockPushToolResult).toHaveBeenCalledWith(formatResponse.toolResult("done", []))
	})

	it("does not call the server when the user rejects", async () => {
		mockAskApproval.mockResolvedValue(false)

		await call()

		expect(callTool).not.toHaveBeenCalled()
		expect(mockPushToolResult).not.toHaveBeenCalled()
	})

	const PNG = "data:image/png;base64,AAAA"
	it.each([
		[
			"text",
			[
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			],
			"a\n\nb",
			[],
		],
		[
			"a resource without its blob",
			[{ type: "resource", resource: { uri: "u", blob: "zzz" } }],
			'{\n  "uri": "u"\n}',
			[],
		],
		["a base64 image", [{ type: "image", mimeType: "image/png", data: "AAAA" }], "[1 image(s) received]", [PNG]],
		[
			"an image already as a data URL",
			[
				{ type: "image", mimeType: "image/png", data: PNG },
				{ type: "text", text: "t" },
			],
			"t",
			[PNG],
		],
		[
			"an image without data, and an unknown block",
			[{ type: "image", mimeType: "image/png" }, { type: "audio" }],
			"(No response)",
			[],
		],
		[
			"a resource link",
			[{ type: "resource_link", name: "doc", uri: "file:///d", description: "the doc" }],
			"[doc](file:///d) \u2014 the doc",
			[],
		],
		[
			"a resource link without description",
			[{ type: "resource_link", name: "doc", uri: "file:///d" }],
			"[doc](file:///d)",
			[],
		],
		["no content", [], "(No response)", []],
	])("turns %s into the result", async (_, content, text, images) => {
		callTool.mockResolvedValue({ content })

		await call()

		expect(mockTask.say).toHaveBeenCalledWith("mcp_server_response", text, images)
		expect(statuses().at(-1)).toMatchObject({ status: "completed", response: text })
	})

	it("marks an error result", async () => {
		callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "bad input" }] })

		await call()

		expect(mockPushToolResult).toHaveBeenCalledWith(formatResponse.toolResult("Error:\nbad input", []))
		expect(statuses().at(-1)).toEqual({
			executionId: "123456789",
			status: "error",
			response: "Error:\nbad input",
			error: "Error executing MCP tool",
		})
	})

	it("reports a call without any answer", async () => {
		callTool.mockResolvedValue(undefined)

		await call()

		expect(statuses().at(-1)).toEqual({
			executionId: "123456789",
			status: "error",
			error: "No response from MCP server",
		})
		expect(mockPushToolResult).toHaveBeenCalledWith(formatResponse.toolResult("(No response)", []))
	})

	it("shows the call while it streams", async () => {
		await run({ server_name: "test_server", tool_name: "test-tool", arguments: '{"a"' }, true)

		expect(mockTask.ask).toHaveBeenCalledWith(
			"use_mcp_server",
			JSON.stringify({
				type: "use_mcp_tool",
				serverName: "test_server",
				toolName: "test-tool",
				arguments: '{"a"',
			}),
			true,
		)
	})

	describe("cancellation (Stop)", () => {
		const block = {
			type: "tool_use",
			name: "use_mcp_tool",
			params: { server_name: "test_server", tool_name: "slow_tool", arguments: "{}" },
			nativeArgs: { server_name: "test_server", tool_name: "slow_tool", arguments: {} },
			partial: false,
		}

		// Behaves like the MCP SDK's client.request: pending until answered, and
		// rejected at once when the request's signal aborts.
		function pendingUntilAborted(): Mock {
			return vi.fn(
				(
					_server: string,
					_tool: string,
					_args: unknown,
					_source: unknown,
					options?: { signal?: AbortSignal },
				) =>
					new Promise((_resolve, reject) => {
						options?.signal?.addEventListener("abort", () =>
							reject(new Error("MCP error -32001: cancelled")),
						)
					}),
			)
		}

		function stubHub(callTool: Mock, postMessageToWebview: Mock) {
			mockProviderRef.deref.mockReturnValue({
				getMcpHub: () => ({
					callTool,
					getAllServers: () => [{ name: "test_server", tools: [{ name: "slow_tool" }] }],
				}),
				getState: async () => ({}),
				postMessageToWebview,
			})
		}

		function abortTask() {
			// What TaskLifecycle.prepareAbort does: set the flag, then emit.
			;(mockTask as any).abort = true
			;(mockTask as unknown as EventEmitter).emit(TumbleCodeEventName.TaskAborted)
		}

		it("cancels the in-flight call when the task aborts and returns without a result", async () => {
			const callTool = pendingUntilAborted()
			const postMessageToWebview = vi.fn()
			stubHub(callTool, postMessageToWebview)
			mockAskApproval.mockResolvedValue(true)

			const run = useMcpToolTool.handle(mockTask as Task, block as any, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})
			await vi.waitFor(() => expect(callTool).toHaveBeenCalled())

			const signal: AbortSignal = callTool.mock.calls[0][4]?.signal
			expect(signal).toBeInstanceOf(AbortSignal)
			expect(signal.aborted).toBe(false)

			abortTask()
			await run

			expect(signal.aborted).toBe(true)
			// No late result reaches the conversation; the rejection goes to
			// handleError, which stays silent for an aborting task.
			expect(mockPushToolResult).not.toHaveBeenCalled()
			expect(mockTask.say).not.toHaveBeenCalledWith("mcp_server_response", expect.anything(), expect.anything())
			expect(mockHandleError).toHaveBeenCalledWith("executing MCP tool", expect.any(Error), "use_mcp_tool")
			// The "running" execution row is ended instead of spinning on.
			const statuses = postMessageToWebview.mock.calls.map(([m]) => JSON.parse(m.text))
			expect(statuses.at(-1)).toMatchObject({ status: "error", error: "Cancelled" })
			expect((mockTask as unknown as EventEmitter).listenerCount(TumbleCodeEventName.TaskAborted)).toBe(0)
		})

		it("hands an already aborted signal to a call that starts after the abort", async () => {
			const callTool = pendingUntilAborted()
			stubHub(callTool, vi.fn())
			mockAskApproval.mockImplementation(async () => {
				abortTask()
				return true
			})
			callTool.mockImplementation(async (...args: any[]) => {
				const signal: AbortSignal = args[4].signal
				signal.throwIfAborted()
				return { content: [] }
			})

			await useMcpToolTool.handle(mockTask as Task, block as any, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(callTool.mock.calls[0][4].signal.aborted).toBe(true)
			expect(mockPushToolResult).not.toHaveBeenCalled()
		})

		it("removes its abort listener after a normal result", async () => {
			const callTool = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "done" }] })
			stubHub(callTool, vi.fn())
			mockAskApproval.mockResolvedValue(true)

			await useMcpToolTool.handle(mockTask as Task, block as any, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
			})

			expect(mockPushToolResult).toHaveBeenCalledWith(formatResponse.toolResult("done", []))
			expect(callTool.mock.calls[0][4].signal.aborted).toBe(false)
			expect((mockTask as unknown as EventEmitter).listenerCount(TumbleCodeEventName.TaskAborted)).toBe(0)
		})
	})
})
