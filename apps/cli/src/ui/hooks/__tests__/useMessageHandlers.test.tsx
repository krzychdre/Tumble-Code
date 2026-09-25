import { Text } from "ink"
import { render } from "ink-testing-library"

import { useCLIStore } from "../../store.js"
import { getStaticCount } from "../../transcript.js"
import { useMessageHandlers, type UseMessageHandlersReturn } from "../useMessageHandlers.js"

/**
 * Regression tests for duplicated assistant "Tumble said:" blocks in the CLI.
 *
 * Root cause: the extension's streaming pipeline can append two ClineMessage
 * entries with IDENTICAL text but DIFFERENT timestamps (a partial text say is
 * finalized after reasoning/grounding sources interleave, so the tail-partial
 * update misses and a ts-distinct duplicate is appended). The CLI render path
 * deducededuped ONLY by ts, so a same-text, ts-distinct pair rendered as two
 * "Tumble said:" blocks.
 *
 * The fix lives in handleSayMessage: it collapses a COMPLETE assistant text
 * message whose content exactly matches the last assistant text already
 * rendered. Distinct replies are never merged.
 */
describe("useMessageHandlers", () => {
	let api: UseMessageHandlersReturn
	let nonInteractive = false

	function Harness() {
		api = useMessageHandlers({ nonInteractive })
		return <Text>harness</Text>
	}

	beforeEach(() => {
		useCLIStore.getState().reset()
		useCLIStore.getState().setHasStartedTask(true)
		nonInteractive = false
		render(<Harness />)
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
		api.handleExtensionMessage({
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
		api.handleExtensionMessage({
			type: "messageUpdated",
			clineMessage: { ts, type: "say", say, text, partial } as never,
		})
	}

	// Characterization (CLI-9 step 3): the branches below had no spec before the
	// interpreter moved out of this hook. They pin what the hook does today.
	describe("characterization of the remaining branches", () => {
		function askUpdate(ts: number, ask: string, text: string, partial = false): void {
			api.handleExtensionMessage({
				type: "messageUpdated",
				clineMessage: { ts, type: "ask", ask, text, partial } as never,
			})
		}

		it("turns a completion_result ask into a completion row and ends the turn", () => {
			useCLIStore.getState().setLoading(true)
			askUpdate(900, "completion_result", JSON.stringify({ result: "All done." }))

			const state = useCLIStore.getState()
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

			expect(useCLIStore.getState().messages).toEqual([
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
				useCLIStore.getState().setHasStartedTask(false)
				useCLIStore.getState().setLoading(true)
				useCLIStore.getState().setIsResumingTask(true)
				askUpdate(902, kind, "")

				const state = useCLIStore.getState()
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
			expect(useCLIStore.getState().pendingAsk).toBeNull()

			askUpdate(905, "command", "ls")
			useCLIStore.getState().setPendingAsk(null)
			askUpdate(905, "command", "ls")
			expect(useCLIStore.getState().pendingAsk).toBeNull()
		})

		it("prints an auto-approved tool ask as a tool row, and other auto-approved asks as prose", () => {
			const view = render(<Harness />)
			nonInteractive = true
			view.rerender(<Harness />)

			askUpdate(906, "tool", JSON.stringify({ tool: "readFile", path: "a.ts" }))
			askUpdate(907, "tool", "not json")
			askUpdate(908, "browser_action_launch", "https://example.com")

			const messages = useCLIStore.getState().messages
			expect(messages.map((m) => [m.id, m.role, m.toolName, m.originalType])).toEqual([
				["906", "tool", "readFile", "tool"],
				["907", "tool", undefined, "tool"],
				["908", "assistant", undefined, "browser_action_launch"],
			])
			expect(messages[1]?.content).toBe("not json")
			expect(messages[2]?.content).toBe("https://example.com")
			expect(useCLIStore.getState().pendingAsk).toBeNull()
		})

		it("keeps the todo list of an auto-approved update_todo_list ask, with the todos of the rendering closure as previous", () => {
			const view = render(<Harness />)
			nonInteractive = true
			view.rerender(<Harness />)

			const todos = (one: string, two: string) =>
				JSON.stringify({
					tool: "updateTodoList",
					todos: [
						{ id: "1", content: "one", status: one },
						{ id: "2", content: "two", status: two },
					],
				})

			askUpdate(910, "tool", todos("pending", "pending"))
			expect(useCLIStore.getState().currentTodos.map((t) => t.content)).toEqual(["one", "two"])
			expect(useCLIStore.getState().messages[0]?.previousTodos).toEqual([])

			// The hook reads the todos of the render that created the callback, so a
			// caller holding an older callback (the extension host subscribes once,
			// on mount) keeps seeing the todos of that render.
			const stale = api.handleExtensionMessage
			view.rerender(<Harness />)
			stale({
				type: "messageUpdated",
				clineMessage: { ts: 911, type: "ask", ask: "tool", text: todos("completed", "pending"), partial: false },
			} as never)
			expect(useCLIStore.getState().messages[1]?.previousTodos).toEqual([])

			api.handleExtensionMessage({
				type: "messageUpdated",
				clineMessage: { ts: 912, type: "ask", ask: "tool", text: todos("completed", "completed"), partial: false },
			} as never)
			// The current callback belongs to the render after the first list, so
			// the list of the second ask, applied since, is not what it reports.
			expect(useCLIStore.getState().messages[2]?.previousTodos?.map((t) => t.status)).toEqual([
				"pending",
				"pending",
			])
		})

		it("folds a state push into mode, provider settings, history and token usage", () => {
			useCLIStore.getState().setIsResumingTask(true)
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

			const state = useCLIStore.getState()
			expect(state.currentMode).toBe("code")
			expect(state.taskHistory).toEqual([])
			expect(state.tokenUsage).toMatchObject({ totalTokensIn: 10, totalTokensOut: 5, totalCost: 0.5 })
			expect(state.isResumingTask).toBe(false)
			// While resuming the first text is history, not the prompt echo.
			expect(state.messages.map((m) => m.content)).toEqual(["echo"])
		})

		it("routes file search results, commands, modes and provider models to the store", () => {
			api.handleExtensionMessage({ type: "fileSearchResults", results: [{ path: "a.ts" }] } as never)
			api.handleExtensionMessage({ type: "commands", commands: [{ name: "deploy" }] } as never)
			api.handleExtensionMessage({ type: "modes", modes: [{ slug: "code", name: "Code" }] } as never)
			api.handleExtensionMessage({
				type: "providerModels",
				modelSourceResult: { sourceId: "openrouter", models: { m: { contextWindow: 1000 } } },
			} as never)
			api.handleExtensionMessage({ type: "providerModels", modelSourceResult: { sourceId: "x" } } as never)

			const state = useCLIStore.getState()
			expect(state.fileSearchResults).toEqual([{ path: "a.ts" }])
			expect(state.allSlashCommands).toEqual([{ name: "deploy" }])
			expect(state.availableModes).toEqual([{ slug: "code", name: "Code" }])
			expect(state.routerModels).toEqual({ openrouter: { m: { contextWindow: 1000 } } })
		})

		it("draws nothing for checkpoint_saved and api_req_started says", () => {
			sayUpdate(920, "checkpoint_saved", "abc", false)
			sayUpdate(921, "api_req_started", "{}", false)

			expect(useCLIStore.getState().messages).toEqual([])
		})

		// The /new and /clear reset (useTaskSubmit.resetConversation) as it is
		// today: the store is reset and the seen ids and the prompt-echo marker
		// are forgotten, but the marker of the last rendered answer survives.
		it("after a conversation reset, drops a first answer identical to the previous task's last answer", () => {
			stateMessage([
				{ ts: 1, type: "say", say: "text", text: "Say hi", partial: false },
				{ ts: 2, type: "say", say: "text", text: "Hi!", partial: false },
			])
			expect(useCLIStore.getState().messages.map((m) => m.content)).toEqual(["Hi!"])

			useCLIStore.getState().reset()
			api.seenMessageIds.current.clear()
			api.firstTextMessageSkipped.current = false

			stateMessage([
				{ ts: 10, type: "say", say: "text", text: "Say hi", partial: false },
				{ ts: 11, type: "say", say: "text", text: "Hi!", partial: false },
				{ ts: 12, type: "say", say: "text", text: "Anything else?", partial: false },
			])
			expect(useCLIStore.getState().messages.map((m) => m.content)).toEqual(["Anything else?"])
		})

		it("after a conversation reset, opens a new row for command output instead of the old task's row", () => {
			useCLIStore.getState().setLoading(true)
			askUpdate(30, "command", "ls")
			sayUpdate(31, "command_output", "a\n", true)

			useCLIStore.getState().reset()
			useCLIStore.getState().setLoading(true)
			api.seenMessageIds.current.clear()
			api.firstTextMessageSkipped.current = false

			sayUpdate(40, "command_output", "b\n", false)

			const rows = useCLIStore.getState().messages
			expect(rows.map((m) => [m.id, m.toolData?.command, m.toolData?.output])).toEqual([
				["40", undefined, "b\n"],
			])
		})
	})

	it("keeps the extension's current provider settings in the store", () => {
		stateMessage([])
		expect(useCLIStore.getState().apiConfiguration).toEqual({ apiProvider: "openai" })

		api.handleExtensionMessage({
			type: "state",
			state: {
				...useCLIStore.getState(),
				mode: "architect",
				apiConfiguration: { apiProvider: "openai", openAiModelId: "GLM-5.3-NVFP4" },
			} as never,
		})
		expect(useCLIStore.getState().apiConfiguration).toEqual({
			apiProvider: "openai",
			openAiModelId: "GLM-5.3-NVFP4",
		})
	})

	it("keeps the MCP server list from mcpServers and full state pushes, not from partial ones", () => {
		const servers = [{ name: "s", config: "{}", status: "connected" }]

		api.handleExtensionMessage({ type: "mcpServers", mcpServers: servers } as never)
		expect(useCLIStore.getState().mcpServers).toBe(servers)

		// The core pushes single-field state updates (storageErrorMessage).
		api.handleExtensionMessage({ type: "state", state: { storageErrorMessage: "x" } } as never)
		expect(useCLIStore.getState().mcpServers).toBe(servers)

		const reconnected = [{ ...servers[0], status: "disconnected", error: "gone" }]
		api.handleExtensionMessage({ type: "state", state: { mcpServers: reconnected } } as never)
		expect(useCLIStore.getState().mcpServers).toBe(reconnected)

		useCLIStore.getState().setMcpServers([])
	})

	it("preserves structured tool details for interactive approval dialogs", () => {
		const payload = JSON.stringify({
			tool: "readFile",
			path: "src/config.ts",
			toolCallId: "call-read-config",
		})

		api.handleExtensionMessage({
			type: "messageUpdated",
			clineMessage: {
				ts: 500,
				type: "ask",
				ask: "tool",
				text: payload,
				partial: false,
			},
		})

		expect(useCLIStore.getState().pendingAsk).toEqual({
			id: "500",
			type: "tool",
			content: payload,
			suggestions: undefined,
		})
	})

	it("uses the current permission policy after it changes at runtime", () => {
		const view = render(<Harness />)
		const stableHandler = api.handleExtensionMessage

		nonInteractive = true
		view.rerender(<Harness />)

		stableHandler({
			type: "messageUpdated",
			clineMessage: {
				ts: 501,
				type: "ask",
				ask: "command",
				text: "git status",
				partial: false,
			},
		})

		// The new policy is in force: an interactive handler would have queued
		// the command as an approval dialog instead of letting it run.
		expect(useCLIStore.getState().pendingAsk).toBeNull()

		// And the command is not announced as prose either — it reaches the
		// transcript only as the Bash row built from its output.
		useCLIStore.getState().setLoading(true)
		stableHandler({
			type: "messageUpdated",
			clineMessage: { ts: 502, type: "say", say: "command_output", text: "M src/app.ts\n", partial: false },
		})

		expect(useCLIStore.getState().messages.filter((m) => m.role === "assistant")).toEqual([])
		expect(useCLIStore.getState().messages.at(-1)?.toolData).toMatchObject({
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
		const view = render(<Harness />)
		nonInteractive = true
		view.rerender(<Harness />)

		api.handleExtensionMessage({
			type: "messageUpdated",
			clineMessage: {
				ts: 601,
				type: "ask",
				ask: "api_req_failed",
				text: "OpenAI completion error: 401 Incorrect API key provided",
				partial: false,
			} as never,
		})

		expect(useCLIStore.getState().pendingAsk).toMatchObject({
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

		api.handleExtensionMessage({
			type: "messageUpdated",
			clineMessage: { ts: 602, type: "ask", ask: "followup", text, partial: false } as never,
		})

		const pendingAsk = useCLIStore.getState().pendingAsk
		expect(typeof pendingAsk?.content).toBe("string")
		expect(pendingAsk?.suggestions).toEqual([{ answer: "Build it" }, { answer: "Plan", mode: "architect" }])
	})

	// A command that contains a pipe used to render as a bare bullet: the ask was
	// added as assistant prose, and the markdown renderer mistook any line with a
	// pipe for a table separator row and blanked it out (plan: 2026-09-22 empty
	// bullets in the CLI transcript).
	it("leaves no bullet-only row behind an auto-approved piped command", () => {
		const view = render(<Harness />)
		nonInteractive = true
		view.rerender(<Harness />)
		useCLIStore.getState().setLoading(true)

		const command = 'grep -n -E "available|curtail" v29.txt | head -30'

		api.handleExtensionMessage({
			type: "messageUpdated",
			clineMessage: { ts: 600, type: "ask", ask: "command", text: command, partial: false },
		})
		api.handleExtensionMessage({
			type: "messageUpdated",
			clineMessage: { ts: 1642, type: "say", say: "command_output", text: "704:25\n", partial: false },
		})

		const messages = useCLIStore.getState().messages

		expect(messages).toHaveLength(1)
		expect(messages[0]).toMatchObject({ role: "tool", toolName: "execute_command" })
		expect(messages[0]?.toolData?.command).toBe(command)
	})

	it("starts a step on every api_req_started, and a replay never moves it back", () => {
		sayUpdate(2_000, "api_req_started", '{"apiProtocol":"openai"}', false)
		expect(useCLIStore.getState().stepStartedAt).toBe(2_000)

		// The core rewrites the same message with the request's cost.
		sayUpdate(2_000, "api_req_started", '{"apiProtocol":"openai","tokensIn":85977}', false)
		expect(useCLIStore.getState().stepStartedAt).toBe(2_000)

		sayUpdate(3_000, "api_req_started", '{"apiProtocol":"openai"}', false)
		stateMessage([
			{ ts: 1_000, type: "say", say: "api_req_started", text: "{}", partial: false },
			{ ts: 2_000, type: "say", say: "api_req_started", text: "{}", partial: false },
		])
		expect(useCLIStore.getState().stepStartedAt).toBe(3_000)
		expect(useCLIStore.getState().messages).toHaveLength(0)
	})

	describe("MCP calls", () => {
		const mcpAsk = JSON.stringify({
			type: "use_mcp_tool",
			serverName: "projsrv",
			toolName: "list_handoffs",
			arguments: "{}",
		})

		function runMcpCall(): void {
			api.handleExtensionMessage({
				type: "messageUpdated",
				clineMessage: { ts: 700, type: "ask", ask: "use_mcp_server", text: mcpAsk, partial: false },
			})
			api.handleExtensionMessage({
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
			const view = render(<Harness />)
			nonInteractive = true
			view.rerender(<Harness />)
			useCLIStore.getState().setLoading(true)

			runMcpCall()

			const messages = useCLIStore.getState().messages
			expect(messages).toHaveLength(1)
			expect(messages[0]).toMatchObject({ role: "tool", toolName: "use_mcp_server" })
			expect(messages[0]?.toolData).toEqual({
				tool: "use_mcp_server",
				path: "projsrv › list_handoffs",
				content: "No handoffs.",
			})
		})

		it("names the server and tool of an approved call in the response row", () => {
			api.handleExtensionMessage({
				type: "messageUpdated",
				clineMessage: { ts: 700, type: "ask", ask: "use_mcp_server", text: mcpAsk, partial: false },
			})
			expect(useCLIStore.getState().pendingAsk?.type).toBe("use_mcp_server")

			api.handleExtensionMessage({
				type: "messageUpdated",
				clineMessage: {
					ts: 701,
					type: "say",
					say: "mcp_server_response",
					text: "No handoffs.",
					partial: false,
				},
			})

			expect(useCLIStore.getState().messages.at(-1)?.toolData?.path).toBe("projsrv › list_handoffs")
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

			const messages = useCLIStore.getState().messages
			expect(messages).toHaveLength(1)
			expect(messages[0]).toMatchObject({ role: "tool", toolName: tool, originalType: "tool" })
			expect(messages[0]?.toolData).toMatchObject({ tool, kind: tool, subject })
		})

		it("prints nothing for a say tool whose text is not a payload yet", () => {
			sayUpdate(801, "tool", '{"tool":"readArt', true)

			expect(useCLIStore.getState().messages).toEqual([])
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

		const assistantMessages = useCLIStore.getState().messages.filter((m) => m.role === "assistant")
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
		api.handleExtensionMessage({
			type: "messageUpdated",
			clineMessage: { ts: 2000, type: "say", say: "text", text: "Hello there", partial: false },
		})

		const assistantMessages = useCLIStore.getState().messages.filter((m) => m.role === "assistant")
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

		const assistantMessages = useCLIStore.getState().messages.filter((m) => m.role === "assistant")
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

		const assistantMessages = useCLIStore.getState().messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(1)
		expect(assistantMessages[0]?.content).toBe("Hi. What do you need help with?")
	})

	it("collapses say:text repeating an earlier say:completion_result (reverse order)", () => {
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "completion_result", text: "Done — see src/app.ts", partial: false },
			{ ts: 1001, type: "say", say: "text", text: "Done — see src/app.ts", partial: false },
		])

		const assistantMessages = useCLIStore.getState().messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(1)
	})

	it("does not dedupe a completion_result that differs from the streamed text", () => {
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "text", text: "Working on it…", partial: false },
			{ ts: 1001, type: "say", say: "completion_result", text: "All done.", partial: false },
		])

		const assistantMessages = useCLIStore.getState().messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(2)
		expect(assistantMessages.map((m) => m.content)).toEqual(["Working on it…", "All done."])
	})

	it("renders BOTH byte-identical replies across turns (user_feedback resets the dedupe)", () => {
		// Turn 1: prompt echo (skipped) + the model's reply.
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "text", text: "Same answer", partial: false },
		])

		expect(useCLIStore.getState().messages.filter((m) => m.role === "assistant")).toHaveLength(1)

		// Turn 2: the user asks the SAME question again. A new user turn begins
		// with a `user_feedback` say; the dedupe marker must be reset there so
		// the byte-identical second answer is NOT treated as an in-turn
		// duplicate of the first turn's reply.
		stateMessage([
			{ ts: 2000, type: "say", say: "user_feedback", text: "Same question", partial: false },
			{ ts: 2001, type: "say", say: "text", text: "Same answer", partial: false },
		])

		const assistantMessages = useCLIStore.getState().messages.filter((m) => m.role === "assistant")
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
	it("applies the same-ts finalization of a streamed say:text", async () => {
		sayUpdate(1, "text", "prompt echo", false) // first say:text is swallowed as the prompt echo

		sayUpdate(2, "text", "Conf", true)
		sayUpdate(2, "text", "Confirmed correct", true)
		sayUpdate(2, "text", "Confirmed correct: the full answer", true)
		sayUpdate(2, "text", "Confirmed correct: the full answer", false)

		// The store debounces partial updates for 150 ms; wait past that so a late
		// flush cannot silently put `partial: true` back.
		await new Promise((resolve) => setTimeout(resolve, 250))

		const messages = useCLIStore.getState().messages
		expect(messages).toHaveLength(1)
		expect(messages[0]?.partial).toBe(false)
		expect(messages[0]?.content).toBe("Confirmed correct: the full answer")
		// Promotion into <Static> is what prints the answer in full; while idle
		// every message must be promotable.
		expect(getStaticCount(messages, false, false)).toBe(messages.length)
	})

	it("applies the same-ts finalization of say:reasoning", async () => {
		// Reasoning is finalized out of band by the stream processor (it finds the
		// last reasoning message and clears its partial flag), so it hits exactly
		// the same guard and used to block promotion of everything after it.
		sayUpdate(10, "reasoning", "Let me", true)
		sayUpdate(10, "reasoning", "Let me check the config", true)
		sayUpdate(10, "reasoning", "Let me check the config first.", false)

		await new Promise((resolve) => setTimeout(resolve, 250))

		const thinking = useCLIStore.getState().messages.filter((m) => m.role === "thinking")
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

		const assistantMessages = useCLIStore.getState().messages.filter((m) => m.role === "assistant")
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
		const first = useCLIStore.getState().messages
		push()
		const second = useCLIStore.getState().messages

		expect(second).toHaveLength(1)
		expect(second[0]).toBe(first[0]) // identical object: nothing was replaced
		expect(second[0]?.partial).toBe(false)
	})

	it("does not finalize across say kinds with different text", async () => {
		stateMessage([
			{ ts: 999, type: "say", say: "text", text: "user prompt echo", partial: false },
			{ ts: 1000, type: "say", say: "text", text: "Working on it", partial: true },
			{ ts: 1001, type: "say", say: "completion_result", text: "All done.", partial: false },
		])

		await new Promise((resolve) => setTimeout(resolve, 250))

		const assistantMessages = useCLIStore.getState().messages.filter((m) => m.role === "assistant")
		expect(assistantMessages).toHaveLength(2)
		expect(assistantMessages[0]?.partial).toBe(true)
		expect(assistantMessages[1]?.partial).toBe(false)

		// The streamed message stays partial until its OWN finalization arrives.
		sayUpdate(1000, "text", "Working on it, nearly there.", false)

		const finalized = useCLIStore.getState().messages[0]
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
			useCLIStore.getState().setLoading(true)

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

		it("renders the answer once, not once per orphaned copy", async () => {
			replayTurn()
			await new Promise((resolve) => setTimeout(resolve, 250))

			const assistantMessages = useCLIStore.getState().messages.filter((m) => m.role === "assistant")
			expect(assistantMessages.map((m) => m.content)).toEqual([ANSWER])
			expect(assistantMessages[0]?.partial).toBe(false)
		})

		it("renders one thinking row, not one per orphaned reasoning copy", async () => {
			replayTurn()
			await new Promise((resolve) => setTimeout(resolve, 250))

			const thinking = useCLIStore.getState().messages.filter((m) => m.role === "thinking")
			expect(thinking).toHaveLength(1)
			expect(thinking[0]?.content).toBe(THOUGHT_FINAL)
			expect(thinking[0]?.partial).toBe(false)
		})

		it("leaves nothing partial, so the whole turn can be promoted into scrollback", async () => {
			replayTurn()
			await new Promise((resolve) => setTimeout(resolve, 250))

			const messages = useCLIStore.getState().messages
			expect(messages.filter((m) => m.partial)).toEqual([])
			expect(getStaticCount(messages, false, false)).toBe(messages.length)
		})
	})

	it("keeps deduping the completion_result after a state push replays an unrelated orphan partial", async () => {
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

		await new Promise((resolve) => setTimeout(resolve, 250))

		const assistantMessages = useCLIStore.getState().messages.filter((m) => m.role === "assistant")
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
			api.handleExtensionMessage({
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
			useCLIStore.getState().setLoading(true)
		})

		it("renders ONE Bash row per command, carrying the command and the complete output", () => {
			runOneCommand(1790082143805, COMMAND, FIRST_CHUNK, FULL_OUTPUT)

			const tools = useCLIStore.getState().messages.filter((m) => m.toolName === "execute_command")

			expect(tools).toHaveLength(1)
			expect(tools[0]?.toolData).toMatchObject({
				tool: "execute_command",
				command: COMMAND,
				output: FULL_OUTPUT,
			})
		})

		it("leaves nothing partial, so the turn can still be promoted into scrollback", () => {
			runOneCommand(1790082143805, COMMAND, FIRST_CHUNK, FULL_OUTPUT)

			const messages = useCLIStore.getState().messages
			expect(messages.filter((m) => m.partial)).toEqual([])
			expect(getStaticCount(messages, true, false)).toBe(messages.length - 1)
		})

		it("opens a new row for the next command instead of appending to the previous one", () => {
			runOneCommand(1790082143805, COMMAND, FIRST_CHUNK, FULL_OUTPUT)
			runOneCommand(1790082149611, "ls -la", "a\n", "a\nb\n")

			const tools = useCLIStore.getState().messages.filter((m) => m.toolName === "execute_command")

			expect(tools.map((m) => m.toolData?.command)).toEqual([COMMAND, "ls -la"])
			expect(tools.map((m) => m.toolData?.output)).toEqual([FULL_OUTPUT, "a\nb\n"])
		})

		it("does not write into a row that is already printed, once the agent is idle", () => {
			askUpdate(1790082143805, "command", COMMAND)
			sayUpdate(1790082144847, "command_output", FIRST_CHUNK, true)
			// Escape cancelled the task: the row may already be in scrollback, where
			// nothing can rewrite it, so a late finalization renders on its own.
			useCLIStore.getState().setLoading(false)
			sayUpdate(1790082144879, "command_output", FULL_OUTPUT, false)

			const outputs = useCLIStore
				.getState()
				.messages.filter((m) => m.toolName === "execute_command")
				.map((m) => m.toolData?.output)

			expect(outputs).toEqual([FIRST_CHUNK, FULL_OUTPUT])
		})

		it("keeps the command on a row replayed from a resumed task's history", () => {
			useCLIStore.getState().setLoading(false)
			useCLIStore.getState().setIsResumingTask(true)

			stateMessage([
				{ ts: 1, type: "say", say: "text", text: "prompt echo", partial: false },
				{ ts: 1790082143805, type: "ask", ask: "command", text: COMMAND, partial: false },
				{ ts: 1790082144847, type: "say", say: "command_output", text: FIRST_CHUNK, partial: true },
				{ ts: 1790082144847, type: "ask", ask: "command_output", text: "", partial: false },
				{ ts: 1790082144879, type: "say", say: "command_output", text: FULL_OUTPUT, partial: false },
			])

			const tools = useCLIStore.getState().messages.filter((m) => m.toolName === "execute_command")

			expect(tools).toHaveLength(1)
			expect(tools[0]?.toolData?.command).toBe(COMMAND)
			expect(tools[0]?.partial).toBeFalsy()
		})
	})
})
