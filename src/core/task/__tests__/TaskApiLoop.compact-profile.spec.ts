// cd src && npx vitest run core/task/__tests__/TaskApiLoop.compact-profile.spec.ts

// The compact profile, read from the task's own profile: one tool call per message in the
// request metadata every handler reads, and the output reservation and condense threshold
// handed to context management.

import { TaskApiLoop } from "../TaskApiLoop"
import type { ApiHandlerCreateMessageMetadata } from "../../../api"
import { logger } from "../../../utils/logging"

function makeLoop(apiConfiguration: Record<string, unknown>) {
	const createMessage = vi.fn(async function* (
		_systemPrompt: string,
		_messages: unknown[],
		_metadata?: ApiHandlerCreateMessageMetadata,
	) {
		yield { type: "text" as const, text: "answer" }
	})
	const access: any = {
		taskId: "task-1",
		instanceId: "inst-1",
		isBackground: false,
		abort: false,
		apiConfiguration: { apiProvider: "openai", ...apiConfiguration },
		api: {
			getModel: vi.fn().mockReturnValue({
				id: "qwen3.5-4b-q4_k_m",
				info: { contextWindow: 40960, maxTokens: -1, supportsPromptCache: false },
			}),
			countTokens: vi.fn().mockResolvedValue(0),
			createMessage,
			cancelRequest: vi.fn(),
		},
		apiConversationHistory: [],
		clineMessages: [],
		microcompactStrippedTokens: 0,
		skipPrevResponseIdOnce: false,
		providerRef: { deref: () => ({ getState: async () => ({}) }) },
		getTaskMode: async () => "code",
		getTokenUsage: () => ({ contextTokens: 0 }),
		combineMessages: (messages: unknown[]) => messages,
		autoApprovalHandler: { checkAutoApprovalLimits: vi.fn().mockResolvedValue({ shouldProceed: true }) },
		askSay: { ask: vi.fn(), say: vi.fn() },
	}
	const loop = new TaskApiLoop(access)
	vi.spyOn(loop, "getSystemPrompt").mockResolvedValue("system prompt")
	vi.spyOn((loop as any).retryHandler, "maybeWaitForProviderRateLimit").mockResolvedValue(undefined)
	vi.spyOn(loop as any, "buildToolsArray").mockResolvedValue({
		allTools: [{ type: "function", function: { name: "read_file", parameters: {} } }],
		allowedFunctionNames: undefined,
	})
	return { loop, access, createMessage }
}

/** The parameters TaskApiLoop hands to context management on a request with 20,000 tracked tokens. */
async function contextManagementParams(apiConfiguration: Record<string, unknown>, state: Record<string, unknown> = {}) {
	const { loop, access } = makeLoop(apiConfiguration)
	access.getTokenUsage = () => ({ contextTokens: 20_000 })
	access.apiConversationHistory = [{ role: "user", content: "hello", ts: 1 }]
	access.providerRef = { deref: () => ({ getState: async () => state }) }
	const manageContextIfNeeded = vi.fn().mockResolvedValue(undefined)
	access.contextManager = { manageContextIfNeeded }
	await loop.attemptApiRequest().next()
	expect(manageContextIfNeeded).toHaveBeenCalledTimes(1)
	return manageContextIfNeeded.mock.calls[0][0]
}

async function firstRequestMetadata(apiConfiguration: Record<string, unknown>) {
	const { loop, createMessage } = makeLoop(apiConfiguration)
	await loop.attemptApiRequest().next()
	expect(createMessage).toHaveBeenCalledTimes(1)
	return createMessage.mock.calls[0][2]
}

describe("TaskApiLoop under the compact profile", () => {
	beforeEach(() => {
		vi.spyOn(logger, "info").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("output reservation", () => {
		it("reserves min(4096, 15 percent of the window) when the model's maxTokens is -1", async () => {
			const params = await contextManagementParams({ compactProfile: true })
			expect(params.maxTokens).toBe(4096)
			expect(params.contextWindow).toBe(40960)
		})

		it.each([
			["absent", {}],
			["false", { compactProfile: false }],
		])("keeps today's -1 (nothing reserved) with the flag %s", async (_label, flag) => {
			expect((await contextManagementParams(flag)).maxTokens).toBe(-1)
		})
	})

	describe("parallel tool calls", () => {
		it("asks every handler for one tool call per message", async () => {
			expect((await firstRequestMetadata({ compactProfile: true }))?.parallelToolCalls).toBe(false)
		})

		it.each([
			["absent", {}],
			["false", { compactProfile: false }],
		])("keeps parallel tool calls on with the flag %s", async (_label, flag) => {
			expect((await firstRequestMetadata(flag))?.parallelToolCalls).toBe(true)
		})
	})
})
