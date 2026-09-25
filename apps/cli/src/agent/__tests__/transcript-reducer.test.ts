import type { ExtensionMessage, McpServer, ProviderSettings, TodoItem, TokenUsage } from "@roo-code/types"

import type { PendingAsk, TUIMessage } from "../../ui/types.js"
import { getStaticCount } from "../../ui/transcript.js"
import {
	applyAddMessage,
	createTranscriptCursor,
	reduceExtensionMessage,
	resetTranscriptCursor,
	type TranscriptCursor,
	type TranscriptEffect,
} from "../transcript-reducer.js"

/**
 * The transcript as the TUI store holds it once its debounce has flushed,
 * built only from the reducer's effects. The store actions this mirrors are
 * in ui/store.ts; the store's own timing (the 150 ms debounce) is covered by
 * the useTranscriptSink spec.
 */
interface TranscriptModel {
	messages: TUIMessage[]
	pendingAsk: PendingAsk | null
	isLoading: boolean
	isComplete: boolean
	hasStartedTask: boolean
	isResumingTask: boolean
	stepStartedAt: number | null
	currentTodos: TodoItem[]
	previousTodos: TodoItem[]
	tokenUsage: TokenUsage | null
	mcpServers: McpServer[]
	currentMode: string | null
	apiConfiguration: ProviderSettings | null
	taskHistory: unknown[]
	fileSearchResults: unknown[]
	allSlashCommands: unknown[]
	availableModes: unknown[]
	routerModels: Record<string, unknown> | null
}

function emptyModel(): TranscriptModel {
	return {
		messages: [],
		pendingAsk: null,
		isLoading: false,
		isComplete: false,
		hasStartedTask: false,
		isResumingTask: false,
		stepStartedAt: null,
		currentTodos: [],
		previousTodos: [],
		tokenUsage: null,
		mcpServers: [],
		currentMode: null,
		apiConfiguration: null,
		taskHistory: [],
		fileSearchResults: [],
		allSlashCommands: [],
		availableModes: [],
		routerModels: null,
	}
}

function apply(model: TranscriptModel, effect: TranscriptEffect): void {
	switch (effect.type) {
		case "addMessage":
			model.messages = applyAddMessage(model.messages, effect.message)
			break
		case "setPendingAsk":
			model.pendingAsk = effect.ask
			break
		case "setComplete":
			model.isComplete = effect.complete
			break
		case "setLoading":
			model.isLoading = effect.loading
			break
		case "setHasStartedTask":
			model.hasStartedTask = effect.started
			break
		case "setIsResumingTask":
			model.isResumingTask = effect.resuming
			break
		case "markStepStarted":
			if (model.stepStartedAt === null || model.stepStartedAt < effect.ts) {
				model.stepStartedAt = effect.ts
			}
			break
		case "setTodos":
			model.previousTodos = model.currentTodos
			model.currentTodos = effect.todos
			break
		case "setTokenUsage":
			model.tokenUsage = effect.usage
			break
		case "setMcpServers":
			model.mcpServers = effect.servers
			break
		case "setCurrentMode":
			model.currentMode = effect.mode
			break
		case "setApiConfiguration":
			model.apiConfiguration = effect.config
			break
		case "setTaskHistory":
			model.taskHistory = effect.history
			break
		case "setFileSearchResults":
			model.fileSearchResults = effect.results
			break
		case "setAllSlashCommands":
			model.allSlashCommands = effect.commands
			break
		case "setAvailableModes":
			model.availableModes = effect.modes
			break
		case "setRouterModels":
			model.routerModels = effect.models
			break
	}
}

/**
 * Specs of the transcript reducer (moved from the old useMessageHandlers spec,
 * where they ran through the hook and the store).
 *
 * Regression background for the dedupe specs: the extension's streaming
 * pipeline can append two ClineMessage entries with IDENTICAL text but
 * DIFFERENT timestamps (a partial text say is finalized after reasoning or
 * grounding sources interleave, so the tail-partial update misses and a
 * ts-distinct duplicate is appended). The CLI deduped ONLY by ts, so a
 * same-text, ts-distinct pair rendered as two answer blocks. The reducer
 * collapses a COMPLETE answer whose content exactly matches the last answer
 * already rendered; distinct replies are never merged.
 */
describe("transcript reducer", () => {
	let cursor: TranscriptCursor
	let model: TranscriptModel
	let nonInteractive: boolean

	function handle(message: ExtensionMessage): void {
		const result = reduceExtensionMessage(
			cursor,
			{
				messages: model.messages,
				isLoading: model.isLoading,
				isResumingTask: model.isResumingTask,
				currentTodos: model.currentTodos,
			},
			message,
			{ nonInteractive },
		)

		cursor = result.cursor

		for (const effect of result.effects) {
			apply(model, effect)
		}

		// The view the reducer hands back is the transcript its effects produce.
		expect(result.view.messages).toEqual(model.messages)
		expect(result.view.isLoading).toBe(model.isLoading)
		expect(result.view.isResumingTask).toBe(model.isResumingTask)
	}

	beforeEach(() => {
		cursor = createTranscriptCursor()
		model = emptyModel()
		model.hasStartedTask = true
		nonInteractive = false
	})

	interface ClineMessageLike {
		ts: number
		type: string
		say?: string
		ask?: string
		text: string
		partial: boolean
	}

	// Minimal ExtensionState shape; the handler only reads clineMessages/type.
	function stateMessage(msg: ClineMessageLike[]): void {
		handle({
			type: "state",
			state: {
				clineMessages: msg as never,
				mode: "code",
				version: "0.0.0-test",
				apiConfiguration: { apiProvider: "openai" },
				taskHistory: [],
				mcpEnabled: false,
				writeDelayMs: 1000,
				experiments: {},
				telemetrySetting: "off",
				renderContext: "sidebar",
				customModes: [],
				cloudUserInfo: null,
				shouldShowAnnouncement: false,
				enableCheckpoints: false,
				checkpointTimeout: 15,
				maxOpenTabsContext: 0,
				maxWorkspaceFiles: 0,
				showRooIgnoredFiles: false,
				enableSubfolderRules: false,
				maxImageFileSize: 1,
				maxTotalImageSize: 1,
			} as never,
		})
	}

	// Single `messageUpdated` delivery, which is how the core pushes every
	// streaming chunk and every finalization.
	function sayUpdate(ts: number, say: string, text: string, partial: boolean): void {
		handle({
			type: "messageUpdated",
			clineMessage: { ts, type: "say", say, text, partial } as never,
		})
	}

	// Characterization (CLI-9 step 3): the branches below had no spec before the
	// interpreter moved out of this hook. They pin what the hook does today.
	describe("characterization of the remaining branches", () => {
		function askUpdate(ts: number, ask: string, text: string, partial = false): void {
			handle({
				type: "messageUpdated",
				clineMessage: { ts, type: "ask", ask, text, partial } as never,
			})
		}

		it("turns a completion_result ask into a completion row and ends the turn", () => {
			model.isLoading = true
			askUpdate(900, "completion_result", JSON.stringify({ result: "All done." }))

			const state = model
			expect(state.isComplete).toBe(true)
			expect(state.isLoading).toBe(false)
			expect(state.pendingAsk).toBeNull()
			expect(state.messages).toEqual([
				{
					id: "900",
					role: "tool",
					content: JSON.stringify({ result: "All done." }),
					toolName: "attempt_completion",
					originalType: "completion_result",
					toolData: { tool: "attempt_completion", result: "All done.", content: "All done." },
				},
			])
		})

		it("keeps a completion_result ask whose text is not JSON as a plain completion row", () => {
			askUpdate(901, "completion_result", "")

			expect(model.messages).toEqual([
				{
					id: "901",
					role: "tool",
					content: "Task completed",
					toolName: "attempt_completion",
					originalType: "completion_result",
					toolData: { tool: "attempt_completion", content: "" },
				},
			])
		})

		it.each(["resume_task", "resume_completed_task"])(
			"answers a %s ask with the normal input, not a dialog",
			(kind) => {
				model.hasStartedTask = false
				model.isLoading = true
				model.isResumingTask = true
				askUpdate(902, kind, "")

				const state = model
				expect(state.pendingAsk).toBeNull()
				expect(state.isLoading).toBe(false)
				expect(state.hasStartedTask).toBe(true)
				expect(state.isResumingTask).toBe(false)
				expect(state.isComplete).toBe(false)
				expect(state.messages).toEqual([])
			},
		)

		it("ignores partial asks, command_output asks and a repeated ask", () => {
			askUpdate(903, "followup", '{"question":"Q?"}', true)
			askUpdate(904, "command_output", "")
			expect(model.pendingAsk).toBeNull()

			askUpdate(905, "command", "ls")
			model.pendingAsk = null
			askUpdate(905, "command", "ls")
			expect(model.pendingAsk).toBeNull()
		})

		it("prints an auto-approved tool ask as a tool row, and other auto-approved asks as prose", () => {
			nonInteractive = true

			askUpdate(906, "tool", JSON.stringify({ tool: "readFile", path: "a.ts" }))
			askUpdate(907, "tool", "not json")
			askUpdate(908, "browser_action_launch", "https://example.com")

			const messages = model.messages
			expect(messages.map((m) => [m.id, m.role, m.toolName, m.originalType])).toEqual([
				["906", "tool", "readFile", "tool"],
				["907", "tool", undefined, "tool"],
				["908", "assistant", undefined, "browser_action_launch"],
			])
			expect(messages[1]?.content).toBe("not json")
			expect(messages[2]?.content).toBe("https://example.com")
			expect(model.pendingAsk).toBeNull()
		})

		it("keeps the todo list of an auto-approved update_todo_list ask, with the view's todos as previous", () => {
			nonInteractive = true

			const todos = (one: string, two: string) =>
				JSON.stringify({
					tool: "updateTodoList",
					todos: [
						{ id: "1", content: "one", status: one },
						{ id: "2", content: "two", status: two },
					],
				})

			askUpdate(910, "tool", todos("pending", "pending"))
			expect(model.currentTodos.map((t) => t.content)).toEqual(["one", "two"])
			expect(model.messages[0]?.previousTodos).toEqual([])

			askUpdate(911, "tool", todos("completed", "pending"))
			expect(model.messages[1]?.previousTodos?.map((t) => t.status)).toEqual(["pending", "pending"])
			expect(model.previousTodos.map((t) => t.status)).toEqual(["pending", "pending"])
			expect(model.currentTodos.map((t) => t.status)).toEqual(["completed", "pending"])
		})

		it("folds a state push into mode, provider settings, history and token usage", () => {
			model.isResumingTask = true
			stateMessage([
				{ ts: 1, type: "say", say: "text", text: "echo", partial: false },
				{
					ts: 2,
					type: "say",
					say: "api_req_started",
					text: JSON.stringify({ tokensIn: 10, tokensOut: 5, cost: 0.5 }),
					partial: false,
				},
			])

			const state = model
			expect(state.currentMode).toBe("code")
			expect(state.taskHistory).toEqual([])
			expect(state.tokenUsage).toMatchObject({ totalTokensIn: 10, totalTokensOut: 5, totalCost: 0.5 })
			expect(state.isResumingTask).toBe(false)
			// While resuming the first text is history, not the prompt echo.
			expect(state.messages.map((m) => m.content)).toEqual(["echo"])
		})

		it("routes file search results, commands, modes and provider models to the store", () => {
			handle({ type: "fileSearchResults", results: [{ path: "a.ts" }] } as never)
			handle({ type: "commands", commands: [{ name: "deploy" }] } as never)
			handle({ type: "modes", modes: [{ slug: "code", name: "Code" }] } as never)
			handle({
				type: "providerModels",
				modelSourceResult: { sourceId: "openrouter", models: { m: { contextWindow: 1000 } } },
			} as never)
			handle({ type: "providerModels", modelSourceResult: { sourceId: "x" } } as never)

			const state = model
			expect(state.fileSearchResults).toEqual([{ path: "a.ts" }])
			expect(state.allSlashCommands).toEqual([{ name: "deploy" }])
			expect(state.availableModes).toEqual([{ slug: "code", name: "Code" }])
			expect(state.routerModels).toEqual({ openrouter: { m: { contextWindow: 1000 } } })
		})

		it("draws nothing for checkpoint_saved and api_req_started says", () => {
			sayUpdate(920, "checkpoint_saved", "abc", false)
			sayUpdate(921, "api_req_started", "{}", false)

			expect(model.messages).toEqual([])
		})

		// The /new and /clear reset (useTaskSubmit.resetConversation): the new
		// task starts with nothing remembered from the old one, including the
		// marker of the last rendered answer.
		it("after a conversation reset, shows a first answer identical to the previous task's last answer", () => {
			stateMessage([
				{ ts: 1, type: "say", say: "text", text: "Say hi", partial: false },
				{ ts: 2, type: "say", say: "text", text: "Hi!", partial: false },
			])
			expect(model.messages.map((m) => m.content)).toEqual(["Hi!"])

			model = emptyModel()
			cursor = resetTranscriptCursor()

			stateMessage([
				{ ts: 10, type: "say", say: "text", text: "Say hi", partial: false },
				{ ts: 11, type: "say", say: "text", text: "Hi!", partial: false },
				{ ts: 12, type: "say", say: "text", text: "Anything else?", partial: false },
			])
			expect(model.messages.map((m) => m.content)).toEqual(["Hi!", "Anything else?"])
		})

		it("after a conversation reset, opens a new row for command output instead of the old task's row", () => {
			model.isLoading = true
			askUpdate(30, "command", "ls")
			sayUpdate(31, "command_output", "a\n", true)

			model = emptyModel()
			model.isLoading = true
			cursor = resetTranscriptCursor()

			sayUpdate(40, "command_output", "b\n", false)

			const rows = model.messages
			expect(rows.map((m) => [m.id, m.toolData?.command, m.toolData?.output])).toEqual([
				["40", undefined, "b\n"],
			])
		})
	})

	it("keeps the extension's current provider settings in the store", () => {
		stateMessage([])
		expect(model.apiConfiguration).toEqual({ apiProvider: "openai" })

		handle({
			type: "state",
			state: {
				...model,
				mode: "architect",
				apiConfiguration: { apiProvider: "openai", openAiModelId: "GLM-5.3-NVFP4" },
			} as never,
		})
		expect(model.apiConfiguration).toEqual({
			apiProvider: "openai",
			openAiModelId: "GLM-5.3-NVFP4",
		})
	})

	it("keeps the MCP server list from mcpServers and full state pushes, not from partial ones", () => {
		const servers = [{ name: "s", config: "{}", status: "connected" }]

		handle({ type: "mcpServers", mcpServers: servers } as never)
		expect(model.mcpServers).toBe(servers)

		// The core pushes single-field state updates (storageErrorMessage).
		handle({ type: "state", state: { storageErrorMessage: "x" } } as never)
		expect(model.mcpServers).toBe(servers)

		const reconnected = [{ ...servers[0], status: "disconnected", error: "gone" }]
		handle({ type: "state", state: { mcpServers: reconnected } } as never)
		expect(model.mcpServers).toBe(reconnected)

			})

	it("preserves structured tool details for interactive approval dialogs", () => {
		const payload = JSON.stringify({
			tool: "readFile",
			path: "src/config.ts",
			toolCallId: "call-read-config",
		})

		handle({
			type: "messageUpdated",
			clineMessage: {
				ts: 500,
				type: "ask",
				ask: "tool",
				text: payload,
				partial: false,
			},
		})

		expect(model.pendingAsk).toEqual({
			id: "500",
			type: "tool",
			content: payload,
			suggestions: undefined,
		})
	})

	it("keeps an approved command out of the transcript except as its Bash row", () => {
		nonInteractive = true

		handle({
			type: "messageUpdated",
			clineMessage: {
				ts: 501,
				type: "ask",
				ask: "command",
				text: "git status",
				partial: false,
			},
		})

		// Auto-approved: no approval dialog.
		expect(model.pendingAsk).toBeNull()

		// And the command is not announced as prose either: it reaches the
		// transcript only as the Bash row built from its output.
		model.isLoading = true
		handle({
			type: "messageUpdated",
			clineMessage: { ts: 502, type: "say", say: "command_output", text: "M src/app.ts\n", partial: false },
		})

		expect(model.messages.filter((m) => m.role === "assistant")).toEqual([])
		expect(model.messages.at(-1)?.toolData).toMatchObject({
			tool: "execute_command",
			command: "git status",
			output: "M src/app.ts\n",
		})
	})

	// With auto-approval on the core asks api_req_failed only for errors a
	// retry cannot fix (401, 403, 404). "allow" mode used to print the ask as
	// prose and answer nothing, so the task sat on the ask with no way to
	// retry. It now gets the Yes/No dialog, like in "ask" mode.
	it("offers the retry dialog for api_req_failed even when actions are auto-approved", () => {
		nonInteractive = true

		handle({
			type: "messageUpdated",
			clineMessage: {
				ts: 601,
				type: "ask",
				ask: "api_req_failed",
				text: "OpenAI completion error: 401 Incorrect API key provided",
				partial: false,
			} as never,
		})

		expect(model.pendingAsk).toMatchObject({
			type: "api_req_failed",
			content: "OpenAI completion error: 401 Incorrect API key provided",
		})
	})

	// CLI-5: the follow-up is parsed by the rule shared with the webview. A
	// question that is not a string used to become the dialog title as is
	// (an object crashes the Ink render), and a non-string mode was kept.
	it("reads a follow-up's question and suggestions by the shared rule", () => {
		const text = JSON.stringify({
			question: { text: "Next?" },
			suggest: [{ answer: "Build it", mode: 7 }, { answer: " " }, { answer: "Plan", mode: "architect" }],
		})

		handle({
			type: "messageUpdated",
			clineMessage: { ts: 602, type: "ask", ask: "followup", text, partial: false } as never,
		})

		const pendingAsk = model.pendingAsk
		expect(typeof pendingAsk?.content).toBe("string")
		expect(pendingAsk?.suggestions).toEqual([{ answer: "Build it" }, { answer: "Plan", mode: "architect" }])
	})

	// A command that contains a pipe used to render as a bare bullet: the ask was
	// added as assistant prose, and the markdown renderer mistook any line with a
	// pipe for a table separator row and blanked it out (plan: 2026-09-22 empty
	// bullets in the CLI transcript).
	it("leaves no bullet-only row behind an auto-approved piped command", () => {
		nonInteractive = true
		model.isLoading = true

		const command = 'grep -n -E "available|curtail" v29.txt | head -30'

		handle({
			type: "messageUpdated",
			clineMessage: { ts: 600, type: "ask", ask: "command", text: command, partial: false },
		})
		handle({
			type: "messageUpdated",
			clineMessage: { ts: 1642, type: "say", say: "command_output", text: "704:25\n", partial: false },
		})

		const messages = model.messages

		expect(messages).toHaveLength(1)
		expect(messages[0]).toMatchObject({ role: "tool", toolName: "execute_command" })
		expect(messages[0]?.toolData?.command).toBe(command)
	})

	it("starts a step on every api_req_started, and a replay never moves it back", () => {
		sayUpdate(2_000, "api_req_started", '{"apiProtocol":"openai"}', false)
		expect(model.stepStartedAt).toBe(2_000)

		// The core rewrites the same message with the request's cost.
		sayUpdate(2_000, "api_req_started", '{"apiProtocol":"openai","tokensIn":85977}', false)
		expect(model.stepStartedAt).toBe(2_000)

		sayUpdate(3_000, "api_req_started", '{"apiProtocol":"openai"}', false)
		stateMessage([
			{ ts: 1_000, type: "say", say: "api_req_started", text: "{}", partial: false },
			{ ts: 2_000, type: "say", say: "api_req_started", text: "{}", partial: false },
		])
		expect(model.stepStartedAt).toBe(3_000)
		expect(model.messages).toHaveLength(0)
	})

	describe("MCP calls", () => {
		const mcpAsk = JSON.stringify({
			type: "use_mcp_tool",
			serverName: "projsrv",
			toolName: "list_handoffs",
			arguments: "{}",
		})

		function runMcpCall(): void {
			handle({
				type: "messageUpdated",
				clineMessage: { ts: 700, type: "ask", ask: "use_mcp_server", text: mcpAsk, partial: false },
			})
			handle({
				type: "messageUpdated",
				clineMessage: {
					ts: 701,
					type: "say",
					say: "mcp_server_response",
					text: "No handoffs.",
					partial: false,
				},
			})
		}

		it("renders an auto-approved call as one MCP row, not as the ask's JSON", () => {
			nonInteractive = true
			model.isLoading = true

			runMcpCall()

			const messages = model.messages
			expect(messages).toHaveLength(1)
			expect(messages[0]).toMatchObject({ role: "tool", toolName: "use_mcp_server" })
			expect(messages[0]?.toolData).toEqual({
				tool: "use_mcp_server",
				path: "projsrv › list_handoffs",
				content: "No handoffs.",
			})
		})

		it("names the server and tool of an approved call in the response row", () => {
			handle({
				type: "messageUpdated",
				clineMessage: { ts: 700, type: "ask", ask: "use_mcp_server", text: mcpAsk, partial: false },
			})
			expect(model.pendingAsk?.type).toBe("use_mcp_server")

			handle({
				type: "messageUpdated",
				clineMessage: {
					ts: 701,
					type: "say",
					say: "mcp_server_response",
					text: "No handoffs.",
					partial: false,
				},
			})

			expect(model.messages.at(-1)?.toolData?.path).toBe("projsrv › list_handoffs")
		})
	})

	// ReadArtifactTool and SearchTaskHistoryTool report what they did with a
	// `say: "tool"` message whose text is a tool payload; old task histories
	// also carry `runSlashCommand` says. The webview draws them as tool rows
	// (SayToolRows.tsx); the CLI printed the payload JSON as the answer.
	describe("say tool messages", () => {
		const readArtifact = JSON.stringify({ tool: "readArtifact", readStart: 0, readEnd: 1024, totalBytes: 4096 })
		const searchHistory = JSON.stringify({ tool: "searchTaskHistory", query: "retry budget", totalBytes: 812 })
		const slashCommand = JSON.stringify({ tool: "runSlashCommand", command: "deploy", args: "prod" })

		it.each([
			["readArtifact", readArtifact, "0 B - 1.0 KB of 4.0 KB"],
			["searchTaskHistory", searchHistory, "retry budget"],
			["runSlashCommand", slashCommand, "/deploy"],
		])("renders a %s say as a tool row read by the shared payload reader", (tool, text, subject) => {
			sayUpdate(800, "tool", text, false)

			const messages = model.messages
			expect(messages).toHaveLength(1)
			expect(messages[0]).toMatchObject({ role: "tool", toolName: tool, originalType: "tool" })
			expect(messages[0]?.toolData).toMatchObject({ tool, kind: tool, subject })
		})

		it("prints nothing for a say tool whose text is not a payload yet", () => {
			sayUpdate(801, "tool", '{"tool":"readArt', true)

			expect(model.messages).toEqual([])
		})
	})

	it("renders a single block for two ts-distinct identical assistant text messages", () => {
		// Real flow: the first text say is the user-prompt echo (skipped by
		// firstTextMessageSkipped), then the model's partial reply, then its
		// ts-distinct same-text complete duplicate (the bug scenario).
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "text", text: "Hello there", partial: true },
			{ ts: 1001, type: "say", say: "text", text: "Hello there", partial: false },
		])

		const assistantMessages = model.messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(1)
		expect(assistantMessages[0]?.content).toBe("Hello there")
	})

	it("collapses a same-text duplicate delivered via messageUpdated after the full-array loop", () => {
		// State push renders the echo (skipped) + one assistant message.
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "text", text: "Hello there", partial: false },
		])

		// The duplicate re-presented in isolation with a NEW ts.
		handle({
			type: "messageUpdated",
			clineMessage: { ts: 2000, type: "say", say: "text", text: "Hello there", partial: false },
		})

		const assistantMessages = model.messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(1)
		expect(assistantMessages[0]?.content).toBe("Hello there")
	})

	it("does not dedupe two DISTINCT assistant replies with different text", () => {
		// Echo first, then two genuinely distinct replies - both must render.
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "text", text: "First reply", partial: false },
			{ ts: 2000, type: "say", say: "text", text: "Second reply", partial: false },
		])

		const assistantMessages = model.messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(2)
		expect(assistantMessages.map((m) => m.content)).toEqual(["First reply", "Second reply"])
	})

	it("collapses say:completion_result repeating the streamed say:text answer", () => {
		// Proven real-world sequence (task 019fddd6, 2026-08-07): the model
		// repeats its full answer inside attempt_completion's result, so core
		// emits say:text and say:completion_result with byte-identical text.
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "text", text: "Hi. What do you need help with?", partial: false },
			{
				ts: 1001,
				type: "say",
				say: "completion_result",
				text: "Hi. What do you need help with?",
				partial: false,
			},
		])

		const assistantMessages = model.messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(1)
		expect(assistantMessages[0]?.content).toBe("Hi. What do you need help with?")
	})

	it("collapses say:text repeating an earlier say:completion_result (reverse order)", () => {
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "completion_result", text: "Done: see src/app.ts", partial: false },
			{ ts: 1001, type: "say", say: "text", text: "Done: see src/app.ts", partial: false },
		])

		const assistantMessages = model.messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(1)
	})

	it("does not dedupe a completion_result that differs from the streamed text", () => {
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "text", text: "Working on it…", partial: false },
			{ ts: 1001, type: "say", say: "completion_result", text: "All done.", partial: false },
		])

		const assistantMessages = model.messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(2)
		expect(assistantMessages.map((m) => m.content)).toEqual(["Working on it…", "All done."])
	})

	it("renders BOTH byte-identical replies across turns (user_feedback resets the dedupe)", () => {
		// Turn 1: prompt echo (skipped) + the model's reply.
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "text", text: "Same answer", partial: false },
		])

		expect(model.messages.filter((m) => m.role === "assistant")).toHaveLength(1)

		// Turn 2: the user asks the SAME question again. A new user turn begins
		// with a `user_feedback` say; the dedupe marker must be reset there so
		// the byte-identical second answer is NOT treated as an in-turn
		// duplicate of the first turn's reply.
		stateMessage([
			{ ts: 2000, type: "say", say: "user_feedback", text: "Same question", partial: false },
			{ ts: 2001, type: "say", say: "text", text: "Same answer", partial: false },
		])

		const assistantMessages = model.messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(2)
		expect(assistantMessages.map((m) => m.content)).toEqual(["Same answer", "Same answer"])
	})

	/**
	 * Finalization of a streamed message (same ts, partial false).
	 *
	 * The core streams an answer as many updates sharing ONE ts and
	 * `partial: true`, then finalizes it in place with the SAME ts and
	 * `partial: false`. The ts-based seen guard used to swallow that last
	 * delivery, so the store copy stayed partial forever, `getStaticCount`
	 * refused to promote it into <Static>, and the answer was only ever visible
	 * through the height-clamped dynamic tail (the "… +38 lines" report).
	 */
	it("applies the same-ts finalization of a streamed say:text", () => {
		sayUpdate(1, "text", "prompt echo", false) // first say:text is swallowed as the prompt echo

		sayUpdate(2, "text", "Conf", true)
		sayUpdate(2, "text", "Confirmed correct", true)
		sayUpdate(2, "text", "Confirmed correct: the full answer", true)
		sayUpdate(2, "text", "Confirmed correct: the full answer", false)

		// The store debounces partial updates for 150 ms; wait past that so a late
		// flush cannot silently put `partial: true` back.

		const messages = model.messages
		expect(messages).toHaveLength(1)
		expect(messages[0]?.partial).toBe(false)
		expect(messages[0]?.content).toBe("Confirmed correct: the full answer")
		// Promotion into <Static> is what prints the answer in full; while idle
		// every message must be promotable.
		expect(getStaticCount(messages, false, false)).toBe(messages.length)
	})

	it("applies the same-ts finalization of say:reasoning", () => {
		// Reasoning is finalized out of band by the stream processor (it finds the
		// last reasoning message and clears its partial flag), so it hits exactly
		// the same guard and used to block promotion of everything after it.
		sayUpdate(10, "reasoning", "Let me", true)
		sayUpdate(10, "reasoning", "Let me check the config", true)
		sayUpdate(10, "reasoning", "Let me check the config first.", false)


		const thinking = model.messages.filter((m) => m.role === "thinking")
		expect(thinking).toHaveLength(1)
		expect(thinking[0]?.partial).toBe(false)
		expect(thinking[0]?.content).toBe("Let me check the config first.")
	})

	it("still suppresses a ts-distinct identical-text duplicate and finalizes the earlier partial in place", () => {
		// Same sequence as the dedupe regression above, but now we also assert
		// what happens to the partial: the duplicate IS the finalization the core
		// could not apply in place, so the surviving message must end complete.
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "text", text: "Hello there", partial: true },
			{ ts: 1001, type: "say", say: "text", text: "Hello there", partial: false },
		])

		const assistantMessages = model.messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(1)
		expect(assistantMessages[0]?.content).toBe("Hello there")
		expect(assistantMessages[0]?.partial).toBe(false)
	})

	it("keeps a state re-push of a finalized message a no-op", () => {
		// Every state push replays the whole clineMessages array, so "apply any
		// final delivery" would rewrite each message on each push. Only a delivery
		// that finds a still-partial store copy may be applied.
		const push = () =>
			stateMessage([
				{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
				{ ts: 1000, type: "say", say: "text", text: "Hello there", partial: false },
			])

		push()
		const first = model.messages
		push()
		const second = model.messages

		expect(second).toHaveLength(1)
		expect(second[0]).toBe(first[0]) // identical object: nothing was replaced
		expect(second[0]?.partial).toBe(false)
	})

	it("does not finalize across say kinds with different text", () => {
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "text", text: "Working on it", partial: true },
			{ ts: 1001, type: "say", say: "completion_result", text: "All done.", partial: false },
		])


		const assistantMessages = model.messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(2)
		expect(assistantMessages[0]?.partial).toBe(true)
		expect(assistantMessages[1]?.partial).toBe(false)

		// The streamed message stays partial until its OWN finalization arrives.
		sayUpdate(1000, "text", "Working on it, nearly there.", false)

		const finalized = model.messages[0]
		expect(finalized?.partial).toBe(false)
		expect(finalized?.content).toBe("Working on it, nearly there.")
	})

	/**
	 * Interleaved reasoning: the answer rendered twice (real task 01a0c588).
	 *
	 * `Task.say()` only finalizes a partial in place when that partial is still
	 * the LAST message (src/core/task/TaskAskSay.ts:551-554). GLM interleaves
	 * reasoning and text, so the core appended a complete reasoning message
	 * after the text partial, and both the reasoning partial and the text
	 * partial were orphaned: they keep `partial: true` in `clineMessages`
	 * forever, and the complete versions arrived with NEW timestamps.
	 *
	 * Every new core message posts the whole state
	 * (TaskHistory.addToClineMessages -> postStateToWebviewWithoutTaskHistory),
	 * and each state push replays the entire array through `handleSayMessage`.
	 * The orphan text partial therefore re-ran on every push and reset the
	 * dedupe marker to its stale text, while the already-seen complete answer
	 * returned early without restoring it. The next identical
	 * `say:completion_result` then failed the identical-text test and rendered
	 * as a second bullet: the reported "result repeated twice".
	 */
	describe("interleaved reasoning orphans (real task 01a0c588, 2026-09-21)", () => {
		// Texts copied from that task's ui_messages.json (em dash replaced by a
		// hyphen per the repo writing rule; the dedupe is byte-based either way).
		const THOUGHT = "The user is asking whether it is evening."
		const THOUGHT_FINAL = `${THOUGHT} Polish.`
		const ANSWER = "Tak, to wieczor - w Polsce jest teraz **21:54**, czyli prawie 22:00."

		// Mirror the core: a NEW message is appended and the whole state is
		// pushed; an in-place update of a partial rides `messageUpdated` alone.
		function replayTurn(): void {
			const core: ClineMessageLike[] = [
				{ ts: 1, type: "say", say: "text", text: "jaki mamy dzisiaj dzien?", partial: false },
				{ ts: 2, type: "say", say: "user_feedback", text: "to wieczor?", partial: false },
			]
			const append = (message: ClineMessageLike) => {
				core.push(message)
				stateMessage(core)
			}

			// An in-place update rides `messageUpdated` alone, but the core array
			// carries the new text from then on, so keep both in sync.
			const update = (message: ClineMessageLike, text: string, partial: boolean) => {
				message.text = text
				message.partial = partial
				sayUpdate(message.ts, message.say as string, text, partial)
			}

			// Submitting a turn puts the store in the loading state; the handler
			// clears it again on the trailing `ask completion_result`.
			model.isLoading = true

			const reasoning: ClineMessageLike = {
				ts: 3,
				type: "say",
				say: "reasoning",
				text: "The user is",
				partial: true,
			}
			append(reasoning)
			update(reasoning, THOUGHT, true)

			// The text stream starts, which makes the reasoning partial no longer
			// the last message.
			append({ ts: 4, type: "say", say: "text", text: "Tak", partial: true })

			// More reasoning arrives: the core cannot continue the abandoned
			// reasoning partial in place, so it appends a new stream that repeats
			// the accumulated block and finalizes THAT one.
			const reasoningRestart: ClineMessageLike = {
				ts: 5,
				type: "say",
				say: "reasoning",
				text: `${THOUGHT} Pol`,
				partial: true,
			}
			append(reasoningRestart)
			update(reasoningRestart, THOUGHT_FINAL, false)

			// Same story for the answer: the abandoned "Tak" partial is no longer
			// last, so the rest of the answer streams under a new ts.
			const textRestart: ClineMessageLike = {
				ts: 6,
				type: "say",
				say: "text",
				text: "Tak, to wieczor",
				partial: true,
			}
			append(textRestart)
			update(textRestart, ANSWER, true)
			update(textRestart, ANSWER, false)

			// The model repeats the answer inside attempt_completion's result.
			append({ ts: 7, type: "say", say: "completion_result", text: ANSWER, partial: false })
			append({ ts: 8, type: "ask", ask: "completion_result", text: "", partial: false })
		}

		it("renders the answer once, not once per orphaned copy", () => {
			replayTurn()

			const assistantMessages = model.messages.filter((m) => m.role === "assistant")
			expect(assistantMessages.map((m) => m.content)).toEqual([ANSWER])
			expect(assistantMessages[0]?.partial).toBe(false)
		})

		it("renders one thinking row, not one per orphaned reasoning copy", () => {
			replayTurn()

			const thinking = model.messages.filter((m) => m.role === "thinking")
			expect(thinking).toHaveLength(1)
			expect(thinking[0]?.content).toBe(THOUGHT_FINAL)
			expect(thinking[0]?.partial).toBe(false)
		})

		it("leaves nothing partial, so the whole turn can be promoted into scrollback", () => {
			replayTurn()

			const messages = model.messages
			expect(messages.filter((m) => m.partial)).toEqual([])
			expect(getStaticCount(messages, false, false)).toBe(messages.length)
		})
	})

	it("keeps deduping the completion_result after a state push replays an unrelated orphan partial", () => {
		// Same replay mechanism, but the orphan text is NOT a prefix of the final
		// answer (two separate text blocks), so it stays its own message. The
		// dedupe marker must still point at the answer after the replay,
		// otherwise the identical completion_result renders a second time.
		const core: ClineMessageLike[] = [
			{ ts: 1, type: "say", say: "text", text: "prompt echo", partial: false },
			{ ts: 2, type: "say", say: "text", text: "Working on it", partial: true },
			{ ts: 3, type: "say", say: "text", text: "All done.", partial: false },
		]
		stateMessage(core)

		core.push({ ts: 4, type: "say", say: "completion_result", text: "All done.", partial: false })
		stateMessage(core)


		const assistantMessages = model.messages.filter((m) => m.role === "assistant")
		expect(assistantMessages.map((m) => m.content)).toEqual(["Working on it", "All done."])
	})

	describe("command output (real task 01a0c926, 2026-09-22)", () => {
		// The recorded shape of ONE command execution. The two say:command_output
		// entries carry DIFFERENT timestamps because the non-blocking
		// ask:command_output lands between them, which stops `Task.say()` from
		// continuing the partial in place.
		const COMMAND = 'curl -s "https://raw.githubusercontent.com/KellerJordan/modded-nanogpt/master/train_gpt.py"'
		const FIRST_CHUNK = '85:dist.init_process_group(backend="cuda:nccl,cpu:gloo", device_id=device)\n'
		const FULL_OUTPUT = `${FIRST_CHUNK}86:dist.barrier()\n87:master_process = (rank == 0)\n`

		function askUpdate(ts: number, ask: string, text: string): void {
			handle({
				type: "messageUpdated",
				clineMessage: { ts, type: "ask", ask, text, partial: false } as never,
			})
		}

		function runOneCommand(commandTs: number, command: string, chunk: string, full: string): void {
			askUpdate(commandTs, "command", command)
			sayUpdate(commandTs + 1042, "command_output", chunk, true)
			askUpdate(commandTs + 1042, "command_output", "")
			sayUpdate(commandTs + 1074, "command_output", full, false)
		}

		beforeEach(() => {
			// The turn is running, which is when the core delivers command output.
			model.isLoading = true
		})

		it("renders ONE Bash row per command, carrying the command and the complete output", () => {
			runOneCommand(1790082143805, COMMAND, FIRST_CHUNK, FULL_OUTPUT)

			const tools = model.messages.filter((m) => m.toolName === "execute_command")

			expect(tools).toHaveLength(1)
			expect(tools[0]?.toolData).toMatchObject({
				tool: "execute_command",
				command: COMMAND,
				output: FULL_OUTPUT,
			})
		})

		it("leaves nothing partial, so the turn can still be promoted into scrollback", () => {
			runOneCommand(1790082143805, COMMAND, FIRST_CHUNK, FULL_OUTPUT)

			const messages = model.messages
			expect(messages.filter((m) => m.partial)).toEqual([])
			expect(getStaticCount(messages, true, false)).toBe(messages.length - 1)
		})

		it("opens a new row for the next command instead of appending to the previous one", () => {
			runOneCommand(1790082143805, COMMAND, FIRST_CHUNK, FULL_OUTPUT)
			runOneCommand(1790082149611, "ls -la", "a\n", "a\nb\n")

			const tools = model.messages.filter((m) => m.toolName === "execute_command")

			expect(tools.map((m) => m.toolData?.command)).toEqual([COMMAND, "ls -la"])
			expect(tools.map((m) => m.toolData?.output)).toEqual([FULL_OUTPUT, "a\nb\n"])
		})

		it("does not write into a row that is already printed, once the agent is idle", () => {
			askUpdate(1790082143805, "command", COMMAND)
			sayUpdate(1790082144847, "command_output", FIRST_CHUNK, true)
			// Escape cancelled the task: the row may already be in scrollback, where
			// nothing can rewrite it, so a late finalization renders on its own.
			model.isLoading = false
			sayUpdate(1790082144879, "command_output", FULL_OUTPUT, false)

			const outputs = model.messages
				.filter((m) => m.toolName === "execute_command")
				.map((m) => m.toolData?.output)

			expect(outputs).toEqual([FIRST_CHUNK, FULL_OUTPUT])
		})

		it("keeps the command on a row replayed from a resumed task's history", () => {
			model.isLoading = false
			model.isResumingTask = true

			stateMessage([
				{ ts: 1, type: "say", say: "text", text: "prompt echo", partial: false },
				{ ts: 1790082143805, type: "ask", ask: "command", text: COMMAND, partial: false },
				{ ts: 1790082144847, type: "say", say: "command_output", text: FIRST_CHUNK, partial: true },
				{ ts: 1790082144847, type: "ask", ask: "command_output", text: "", partial: false },
				{ ts: 1790082144879, type: "say", say: "command_output", text: FULL_OUTPUT, partial: false },
			])

			const tools = model.messages.filter((m) => m.toolName === "execute_command")

			expect(tools).toHaveLength(1)
			expect(tools[0]?.toolData?.command).toBe(COMMAND)
			expect(tools[0]?.partial).toBeFalsy()
		})
	})

	describe("purity", () => {
		it("never changes the cursor or the view it is given", () => {
			const before = createTranscriptCursor()
			const view = { messages: [], isLoading: true, isResumingTask: false, currentTodos: [] }
			const message = {
				type: "messageUpdated",
				clineMessage: { ts: 5, type: "say", say: "text", text: "Hi", partial: false },
			} as ExtensionMessage

			const first = reduceExtensionMessage(before, view, message, { nonInteractive: false })
			const second = reduceExtensionMessage(first.cursor, first.view, message, { nonInteractive: false })

			expect(before.seenMessageIds.size).toBe(0)
			expect(before.firstTextMessageSkipped).toBe(false)
			expect(view.messages).toEqual([])
			expect(first.cursor.seenMessageIds.has("5")).toBe(true)
			// The prompt echo was skipped, so the second delivery is already seen.
			expect(second.effects).toEqual([])
		})

		it("returns the same cursor contents for the same input", () => {
			const view = { messages: [], isLoading: false, isResumingTask: true, currentTodos: [] }
			const message = {
				type: "messageUpdated",
				clineMessage: { ts: 6, type: "say", say: "text", text: "Hello", partial: false },
			} as ExtensionMessage

			const a = reduceExtensionMessage(createTranscriptCursor(), view, message, { nonInteractive: false })
			const b = reduceExtensionMessage(createTranscriptCursor(), view, message, { nonInteractive: false })

			expect(a).toEqual(b)
		})
	})

	it("resetTranscriptCursor forgets everything the old task left behind", () => {
		nonInteractive = true
		model.isLoading = true
		handle({
			type: "messageUpdated",
			clineMessage: { ts: 50, type: "ask", ask: "command", text: "ls", partial: false },
		} as ExtensionMessage)
		handle({
			type: "messageUpdated",
			clineMessage: {
				ts: 51,
				type: "ask",
				ask: "use_mcp_server",
				text: JSON.stringify({ type: "use_mcp_tool", serverName: "s", toolName: "t" }),
				partial: false,
			},
		} as ExtensionMessage)
		sayUpdate(52, "text", "echo", false)
		sayUpdate(53, "text", "Answer", false)

		const reset = resetTranscriptCursor()

		expect(cursor.lastStreamed.answer).toEqual({ id: "53", text: "Answer" })
		expect(cursor.pendingMcp).toMatchObject({ serverName: "s", toolName: "t" })
		expect(reset).toEqual(createTranscriptCursor())
	})
})
