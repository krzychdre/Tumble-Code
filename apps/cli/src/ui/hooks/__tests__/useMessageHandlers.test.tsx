import { Text } from "ink"
import { render } from "ink-testing-library"

import { useCLIStore } from "../../store.js"
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

	function Harness() {
		api = useMessageHandlers({ nonInteractive: false })
		return <Text>harness</Text>
	}

	beforeEach(() => {
		useCLIStore.getState().reset()
		useCLIStore.getState().setHasStartedTask(true)
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
})
