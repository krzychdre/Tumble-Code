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

	// Minimal ExtensionState shape; the handler only reads clineMessages/type.
	function stateMessage(msg: Array<{ ts: number; type: string; say: string; text: string; partial: boolean }>): void {
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

		expect(useCLIStore.getState().pendingAsk).toBeNull()
		expect(useCLIStore.getState().messages.at(-1)).toMatchObject({
			role: "assistant",
			content: "git status",
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
})
