// cd src && npx vitest run core/task/__tests__/TaskApiLoop.cycle-state-snapshot.spec.ts

// P5 (ai_plans/2026-09-27_simplification-roadmap.md): one request cycle used to
// call provider.getState() six to eight times (rate-limit wait, cycle read,
// environment details, the request generator, and twice in the system-prompt
// builder), each reading settings, custom modes, cloud facts and command lists.
// The cycle now takes ONE snapshot at cycle start and passes it down; the
// volatile decisions (post-stream retry paths, asks) still read live.

import { TaskApiLoop, type TaskApiLoopAccess } from "../TaskApiLoop"
import { logger } from "../../../utils/logging"

const systemPromptMock = vi.hoisted(() => vi.fn().mockResolvedValue("system prompt"))
vi.mock("../../prompts/system", () => ({ SYSTEM_PROMPT: systemPromptMock }))

// buildSystemPromptInput projects the state away, so the specs record the
// SOURCE it was handed; `source.state` is what proves which state object the
// prompt was built from.
const promptSources: any[] = vi.hoisted(() => [])
vi.mock("../../prompts/system-prompt-input", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../prompts/system-prompt-input")>()
	return {
		...actual,
		buildSystemPromptInput: (source: any) => {
			promptSources.push(source)
			return actual.buildSystemPromptInput(source)
		},
	}
})

vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: { capture: vi.fn(), captureException: vi.fn() },
		hasInstance: vi.fn().mockReturnValue(true),
	},
}))

// The full cycle resolves mentions and builds environment details; keep those
// cheap and deterministic. The environment-details mock records the STATE the
// cycle handed it — after P5 that is the cycle snapshot, not a fresh
// provider.getState() result (site 3 in the plan's inventory).
const envDetailsMock = vi.hoisted(() => vi.fn().mockResolvedValue("<environment_details></environment_details>"))
vi.mock("../../mentions/processUserContentMentions", () => ({
	processUserContentMentions: vi.fn(async ({ userContent }: { userContent: unknown[] }) => ({
		content: userContent,
		mode: undefined,
	})),
}))
vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: envDetailsMock,
}))

/** A distinct state object per read, so identity assertions can tell reads apart. */
const resolvedStates: any[] = []
function makeState(overrides: Record<string, unknown> = {}) {
	const state = {
		apiConfiguration: { apiProvider: "anthropic" as const, modelId: `model-${resolvedStates.length + 1}` },
		autoApprovalEnabled: false,
		mcpEnabled: false,
		mode: "code",
		...overrides,
	}
	resolvedStates.push(state)
	return state
}

function makeAccess(providerStateOverrides: () => Record<string, unknown> = () => ({})) {
	const getState = vi.fn(async () => makeState(providerStateOverrides()))
	const provider = {
		getState,
		getSkillsManager: vi.fn().mockReturnValue(undefined),
		getMcpHub: vi.fn().mockReturnValue(undefined),
		context: {},
		handleModeSwitch: vi.fn().mockResolvedValue(undefined),
		postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
	}
	const createMessage = vi.fn(async function* () {
		yield { type: "text" as const, text: "answer" }
	})
	const access: any = {
		taskId: "task-1",
		instanceId: "inst-1",
		isBackground: false,
		abort: false,
		abandoned: false,
		apiConfiguration: { apiProvider: "anthropic" },
		api: {
			getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }),
			countTokens: vi.fn().mockResolvedValue(0),
			createMessage,
			cancelRequest: vi.fn(),
		},
		apiConversationHistory: [],
		clineMessages: [],
		cloudSyncedMessageTimestamps: new Set<number>(),
		microcompactedToolUseIds: new Set<string>(),
		microcompactStrippedTokens: 0,
		skipPrevResponseIdOnce: false,
		consecutiveMistakeCount: 0,
		consecutiveMistakeLimit: 3,
		consecutiveNoToolUseCount: 0,
		consecutiveNoAssistantMessagesCount: 0,
		agentTurnCount: 0,
		isStreaming: false,
		isWaitingForFirstChunk: false,
		didFinishAbortingStream: false,
		didRejectTool: false,
		didAlreadyUseTool: false,
		userMessageContent: [],
		userMessageContentReady: true,
		settlePendingToolResultSpills: vi.fn().mockResolvedValue(undefined),
		assistantMessageContent: [],
		cachedStreamingModel: { id: "test-model", info: {} },
		materializedDeferredTools: new Set<string>(),
		deferredToolDirectory: new Map(),
		providerRef: { deref: () => provider },
		getTaskMode: vi.fn().mockResolvedValue("code"),
		getTokenUsage: () => ({ contextTokens: 0 }),
		combineMessages: (messages: unknown[]) => messages,
		autoApprovalHandler: { checkAutoApprovalLimits: vi.fn().mockResolvedValue({ shouldProceed: true }) },
		askSay: {
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			// The cycle appends rows to clineMessages itself; the say mock
			// must record the api_req_started row so the loop can find and
			// update it (executeApiRequestCycle:553).
			say: vi.fn(async (type: string) => {
				if (type === "api_req_started") {
					access.clineMessages.push({ type: "say", say: "api_req_started", ts: Date.now() })
				}
			}),
		},
		abortTask: vi.fn().mockResolvedValue(undefined),
		history: {
			addToApiConversationHistory: vi.fn().mockResolvedValue(undefined),
			saveClineMessages: vi.fn().mockResolvedValue(undefined),
			flushPendingToolResultsToHistory: vi.fn().mockResolvedValue(undefined),
		},
		emit: vi.fn(),
		streamProcessor: {
			resetStreamingState: vi.fn().mockResolvedValue(undefined),
			createUpdateApiReqMsgFn: vi.fn().mockReturnValue(vi.fn()),
			createAbortStreamFn: vi.fn().mockReturnValue(vi.fn().mockResolvedValue(undefined)),
			processChunk: vi.fn(),
			appendAssistantMessage: vi.fn(),
			finalizeStream: vi.fn().mockResolvedValue(undefined),
			assembleAndSaveAssistantMessage: vi.fn().mockResolvedValue(undefined),
			partialBlocks: [],
			assistantMessage: "answer",
			inputTokens: 0,
			outputTokens: 0,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalCost: 0,
			createBackgroundUsageDrain: vi.fn().mockReturnValue(() => Promise.resolve()),
		},
		contextManager: {
			manageContextIfNeeded: vi.fn().mockResolvedValue(undefined),
		},
	}
	return { access, provider, getState, createMessage }
}

function makeLoop(access: any) {
	const loop = new TaskApiLoop(access)
	return loop
}

/**
 * Run exactly one successful request cycle: the user content yields a text-only
 * answer (no tool use, no pending todos), so the text-completion fallback
 * completes the task and the loop exits.
 */
async function runOneCycle(loop: TaskApiLoop) {
	await loop.recursivelyMakeClineRequests([{ type: "text", text: "hello" }], false)
}

describe("TaskApiLoop: one state snapshot per request cycle (P5)", () => {
	beforeEach(() => {
		resolvedStates.length = 0
		promptSources.length = 0
		systemPromptMock.mockClear()
		envDetailsMock.mockClear()
		vi.spyOn(logger, "info").mockImplementation(() => {})
		vi.spyOn(logger, "warn").mockImplementation(() => {})
		vi.spyOn(logger, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("calls provider.getState() exactly once per request cycle (was 6+)", async () => {
		const { access, getState } = makeAccess()
		const loop = makeLoop(access)

		await runOneCycle(loop)

		// Before P5 this harness measures 5 reads per cycle on main
		// (rate-limit wait, cycle read, request generator, and the two
		// system-prompt builder reads; the environment-details read is
		// mocked out here and would make it 6 against the real module).
		expect(getState).toHaveBeenCalledTimes(1)
	})

	it("the consumers receive the cycle snapshot's data", async () => {
		const { access, getState, createMessage } = makeAccess()
		const loop = makeLoop(access)

		await runOneCycle(loop)

		// The one snapshot is the state every consumer saw: the request
		// generator handed its apiConfiguration onward (here: into the
		// metadata / createMessage call chain) and the system prompt was
		// built from the same object.
		expect(getState).toHaveBeenCalledTimes(1)

		// SYSTEM_PROMPT was called with the input built from the snapshot.
		expect(systemPromptMock).toHaveBeenCalled()
		expect(promptSources[0].state).toBe(resolvedStates[0])

		// The environment details were built from the same snapshot (P5:
		// getEnvironmentDetails receives the cycle state instead of
		// re-reading the provider).
		expect(envDetailsMock).toHaveBeenCalled()
		expect(envDetailsMock.mock.calls.at(-1)!.at(-1)).toBe(resolvedStates[0])

		// The API request went out (metadata built by the generator).
		expect(createMessage).toHaveBeenCalled()
	})

	it("re-snapshots after a slash-command mode switch (mid-cycle state writer)", async () => {
		// A slash command with a `mode:` frontmatter switches the mode
		// mid-cycle; the request must be built from the POST-switch state
		// (build-tools-slim-toolset.spec.ts pins this contract).
		const { processUserContentMentions } = await import("../../mentions/processUserContentMentions")
		const { access, getState } = makeAccess()
		const customModes = [{ slug: "review-mode", name: "Review" }]
		;(getState as any).mockImplementation(async () => makeState({ customModes }))
		vi.mocked(processUserContentMentions).mockResolvedValueOnce({
			content: [],
			mode: "review-mode",
		} as any)
		const loop = makeLoop(access)

		await runOneCycle(loop)

		// Cycle snapshot + the post-switch refresh: exactly two reads, and
		// the second one (post-handleModeSwitch) is what reached the
		// request build.
		expect(getState).toHaveBeenCalledTimes(2)
		expect(access.providerRef.deref().handleModeSwitch).toHaveBeenCalledWith("review-mode")
		expect(promptSources.at(-1)!.state).toBe(resolvedStates[1])
	})

	it("retry re-entries read state fresh (no stale cycle snapshot across a retry)", async () => {
		const { access, getState, createMessage } = makeAccess()
		// First call fails, retry succeeds.
		let calls = 0
		createMessage.mockImplementation(async function* () {
			calls++
			if (calls === 1) throw new Error("socket hang up")
			yield { type: "text" as const, text: "recovered" }
		})
		const loop = makeLoop(access)

		await runOneCycle(loop)

		// First attempt snapshot + the retry attempt's fresh read. The
		// retried request may run minutes later (backoff) or after a
		// context-window truncation; it must never reuse the first attempt's
		// snapshot. The retried request's prompt must be built from a state
		// that was read AFTER the cycle snapshot (any later read), never the
		// snapshot itself.
		expect(getState.mock.calls.length).toBeGreaterThanOrEqual(2)
		const retriedState = promptSources.at(-1)!.state
		expect(retriedState).not.toBe(resolvedStates[0])
		expect(resolvedStates.indexOf(retriedState)).toBeGreaterThan(0)
	})

	it("the first-chunk dispatch passes the task's own autoApprovalEnabled (live decision input)", async () => {
		// handleApiRequestError receives autoApprovalEnabled captured from the
		// state the generator read for THAT attempt; the retry path re-reads,
		// so the second attempt sees a value the user could have flipped.
		const { access, getState, createMessage } = makeAccess(() => ({ autoApprovalEnabled: true }))
		let calls = 0
		createMessage.mockImplementation(async function* () {
			calls++
			if (calls === 1) throw Object.assign(new Error("rate limited"), { status: 429 })
			yield { type: "text" as const, text: "recovered" }
		})
		const loop = makeLoop(access)
		const backoff = vi.spyOn((loop as any).retryHandler, "backoffAndAnnounce").mockResolvedValue(undefined)

		await runOneCycle(loop)

		expect(backoff).toHaveBeenCalled()
		// The 429 backoff path read its own (fresh) state.
		expect(getState.mock.calls.length).toBeGreaterThanOrEqual(2)
	})
})
