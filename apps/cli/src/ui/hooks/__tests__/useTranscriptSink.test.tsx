import { Text } from "ink"
import { render } from "ink-testing-library"
import type { ExtensionMessage } from "@roo-code/types"

import { TranscriptReader, type TranscriptSink } from "../../../agent/transcript-reader.js"
import { useCLIStore } from "../../store.js"
import { getStaticCount } from "../../transcript.js"
import { useTranscriptSink } from "../useTranscriptSink.js"

/**
 * The sink is the TUI's side of the client's transcript reader: the reader
 * asks it for the transcript as the store holds it and hands back the
 * changes, which it applies through the store actions. What a message means
 * is specced in agent/__tests__/transcript-reducer.test.ts; these specs run a
 * real TranscriptReader against the sink and keep what depends on the store
 * around it: the store's 150 ms debounce of partial updates, the sink the
 * reader keeps from the first render, the todos, and the reset.
 */
describe("useTranscriptSink", () => {
	let sink: TranscriptSink
	let reader: TranscriptReader
	let nonInteractive = false
	let view: ReturnType<typeof render>

	function Harness() {
		sink = useTranscriptSink({ nonInteractive })
		return <Text>harness</Text>
	}

	// What the extension host and the client do with the sink of the first render.
	const api = {
		handleExtensionMessage: (message: ExtensionMessage) => reader.handleMessage(message),
		resetTranscript: () => reader.reset(),
	}

	beforeEach(() => {
		useCLIStore.getState().reset()
		useCLIStore.getState().setHasStartedTask(true)
		nonInteractive = false
		view = render(<Harness />)
		reader = new TranscriptReader()
		reader.attach(sink)
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

	describe("todos and conversation reset", () => {
		function askUpdate(ts: number, ask: string, text: string, partial = false): void {
			api.handleExtensionMessage({
				type: "messageUpdated",
				clineMessage: { ts, type: "ask", ask, text, partial } as never,
			})
		}

		it("keeps the todo list of an auto-approved update_todo_list ask, with the current todos as previous", () => {
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

			// The reader keeps the sink of the first render. It must still compare
			// with the list the transcript holds now, not with the list of a render.
			view.rerender(<Harness />)
			api.handleExtensionMessage({
				type: "messageUpdated",
				clineMessage: { ts: 911, type: "ask", ask: "tool", text: todos("completed", "pending"), partial: false },
			} as never)
			expect(useCLIStore.getState().messages[1]?.previousTodos?.map((t) => t.status)).toEqual([
				"pending",
				"pending",
			])

			api.handleExtensionMessage({
				type: "messageUpdated",
				clineMessage: { ts: 912, type: "ask", ask: "tool", text: todos("completed", "completed"), partial: false },
			} as never)
			expect(useCLIStore.getState().messages[2]?.previousTodos?.map((t) => t.status)).toEqual([
				"completed",
				"pending",
			])
		})

		// The /new and /clear reset (useTaskSubmit.resetConversation): the new
		// task starts with nothing remembered from the old one, including the
		// marker of the last rendered answer.
		it("after a conversation reset, shows a first answer identical to the previous task's last answer", () => {
			stateMessage([
				{ ts: 1, type: "say", say: "text", text: "Say hi", partial: false },
				{ ts: 2, type: "say", say: "text", text: "Hi!", partial: false },
			])
			expect(useCLIStore.getState().messages.map((m) => m.content)).toEqual(["Hi!"])

			useCLIStore.getState().reset()
			api.resetTranscript()

			stateMessage([
				{ ts: 10, type: "say", say: "text", text: "Say hi", partial: false },
				{ ts: 11, type: "say", say: "text", text: "Hi!", partial: false },
				{ ts: 12, type: "say", say: "text", text: "Anything else?", partial: false },
			])
			expect(useCLIStore.getState().messages.map((m) => m.content)).toEqual(["Hi!", "Anything else?"])
		})

		it("after a conversation reset, opens a new row for command output instead of the old task's row", () => {
			useCLIStore.getState().setLoading(true)
			askUpdate(30, "command", "ls")
			sayUpdate(31, "command_output", "a\n", true)

			useCLIStore.getState().reset()
			useCLIStore.getState().setLoading(true)
			api.resetTranscript()

			sayUpdate(40, "command_output", "b\n", false)

			const rows = useCLIStore.getState().messages
			expect(rows.map((m) => [m.id, m.toolData?.command, m.toolData?.output])).toEqual([
				["40", undefined, "b\n"],
			])
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

	it("uses the current permission policy after it changes at runtime", () => {
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
})
