// cd src && npx vitest run core/task/__tests__/TaskApiLoop.profile-switch.spec.ts

// The compact profile follows the task's CURRENT profile across a mid-task switch.
// Task.updateApiConfiguration replaces `task.apiConfiguration` with a new object (a profile
// switch, a saved profile edit, a mode bound to another profile), while TaskApiLoop builds its
// ApiRequestBuilder once, in the Task constructor. The builder must read the flag from the live
// task profile: a task started on a large profile and switched to the compact one must send the
// compact prompt and toolset, and the reverse must not leak compact into the large model.
//
// The tool array is built by the real build-tools path; the system prompt is stubbed to name the
// compact flag it was given (its compact content is pinned in compact-profile-prompt.spec.ts).

vi.mock("../../../services/code-index/manager", () => ({
	CodeIndexManager: {
		getInstance: vi.fn(() => ({ isFeatureEnabled: false, isFeatureConfigured: false, isInitialized: false })),
	},
}))

const systemPromptMock = vi.hoisted(() =>
	vi.fn(async (input: { settings: { compactProfile?: boolean } }) =>
		input.settings.compactProfile === true ? "COMPACT PROMPT" : "FULL PROMPT",
	),
)
vi.mock("../../prompts/system", () => ({ SYSTEM_PROMPT: systemPromptMock }))

import type * as vscode from "vscode"

import { type ProviderSettings, experimentDefault } from "@tumble-code/types"

import type { ApiHandlerCreateMessageMetadata } from "../../../api"
import { logger } from "../../../utils/logging"
import { TaskApiLoop } from "../TaskApiLoop"

const mockContext = {
	extensionPath: "/mock/extension/path",
	globalStoragePath: "/mock/storage/path",
	subscriptions: [],
	workspaceState: { get: () => undefined, update: () => Promise.resolve() },
	globalState: { get: () => undefined, update: () => Promise.resolve(), setKeysForSync: () => {} },
	extensionUri: { fsPath: "/mock/extension/path" },
	globalStorageUri: { fsPath: "/mock/settings/path" },
	asAbsolutePath: (relativePath: string) => `/mock/extension/path/${relativePath}`,
	extension: { packageJSON: { version: "1.0.0" } },
} as unknown as vscode.ExtensionContext

const LARGE: ProviderSettings = { apiProvider: "openai", openAiModelId: "large-model" }
const COMPACT: ProviderSettings = { apiProvider: "openai", openAiModelId: "qwen3.5-4b", compactProfile: true }

function makeApi(info: Record<string, unknown> = {}) {
	return {
		getModel: vi.fn().mockReturnValue({
			id: "model",
			info: { contextWindow: 40960, maxTokens: -1, supportsPromptCache: false, ...info },
		}),
		countTokens: vi.fn().mockResolvedValue(0),
		createMessage: vi.fn(async function* (
			_systemPrompt: string,
			_messages: unknown[],
			_metadata?: ApiHandlerCreateMessageMetadata,
		) {
			yield { type: "text" as const, text: "answer" }
		}),
		cancelRequest: vi.fn(),
	}
}

/** A task started on `initial`, wired the way Task wires its TaskApiLoop (the access object is the task). */
function makeTask(initial: ProviderSettings) {
	// The panel's state follows the focused task's profile, as after a real switch.
	const state = {
		mode: "code",
		mcpEnabled: false,
		customModes: [],
		customModePrompts: {},
		experiments: { ...experimentDefault },
		apiConfiguration: initial,
	}
	const provider = {
		context: mockContext,
		cwd: "/workspace",
		getState: vi.fn(async () => state),
		getMcpHub: vi.fn().mockReturnValue(undefined),
		getSkillsManager: vi.fn().mockReturnValue(undefined),
	}
	const task: any = {
		taskId: "task-1",
		instanceId: "inst-1",
		isBackground: false,
		abort: false,
		apiConfiguration: initial,
		api: makeApi(),
		apiConversationHistory: [],
		clineMessages: [],
		microcompactedIds: new Set<string>(),
		microcompactStrippedTokens: 0,
		skipPrevResponseIdOnce: false,
		providerRef: { deref: () => provider },
		cwd: "/workspace",
		rooIgnoreController: undefined,
		materializedDeferredTools: new Set<string>(),
		deferredToolDirectory: new Map(),
		getTaskMode: async () => "code",
		getTokenUsage: () => ({ contextTokens: 0 }),
		combineMessages: (messages: unknown[]) => messages,
		autoApprovalHandler: { checkAutoApprovalLimits: vi.fn().mockResolvedValue({ shouldProceed: true }) },
		askSay: { ask: vi.fn(), say: vi.fn() },
		emit: vi.fn(),
	}
	const loop = new TaskApiLoop(task)
	vi.spyOn((loop as any).retryHandler, "maybeWaitForProviderRateLimit").mockResolvedValue(undefined)

	/** What Task.updateApiConfiguration does: a new profile object and a handler built from it. */
	const switchProfile = (next: ProviderSettings, modelInfo?: Record<string, unknown>) => {
		task.apiConfiguration = next
		task.api = makeApi(modelInfo)
		state.apiConfiguration = next
	}

	/** The system prompt, tool names and metadata the next request hands to the task's current handler. */
	const nextRequest = async () => {
		await loop.attemptApiRequest().next()
		const [systemPrompt, , metadata] = task.api.createMessage.mock.calls.at(-1)!
		const names = (metadata?.tools ?? []).map((tool: { function: { name: string } }) => tool.function.name)
		return { systemPrompt, names, parallelToolCalls: metadata?.parallelToolCalls }
	}

	return { switchProfile, nextRequest }
}

describe("TaskApiLoop: the compact flag follows a mid-task profile switch", () => {
	beforeEach(() => {
		systemPromptMock.mockClear()
		vi.spyOn(logger, "info").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("large profile switched to compact: the next request is compact", async () => {
		const { switchProfile, nextRequest } = makeTask(LARGE)

		const before = await nextRequest()
		expect(before.systemPrompt).toBe("FULL PROMPT")
		expect(before.names).toContain("apply_diff")
		expect(before.names).not.toContain("edit")

		switchProfile(COMPACT)

		const after = await nextRequest()
		expect(after.systemPrompt).toBe("COMPACT PROMPT")
		expect(after.names).toContain("edit")
		expect(after.names).not.toContain("apply_diff")
		expect(after.parallelToolCalls).toBe(false)
	})

	it("compact profile switched to large: the next request is today's", async () => {
		const { switchProfile, nextRequest } = makeTask(COMPACT)

		const before = await nextRequest()
		expect(before.systemPrompt).toBe("COMPACT PROMPT")
		expect(before.names).not.toContain("apply_diff")

		switchProfile(LARGE)

		const after = await nextRequest()
		expect(after.systemPrompt).toBe("FULL PROMPT")
		expect(after.names).toContain("apply_diff")
		expect(after.names).not.toContain("edit")
		expect(after.parallelToolCalls).toBe(true)
	})

	// The handler is replaced too: the system prompt reads the new model's info.
	it("the system prompt reads the model of the handler the switch built", async () => {
		const { switchProfile, nextRequest } = makeTask(LARGE)
		await nextRequest()

		switchProfile(LARGE, { isStealthModel: true })
		await nextRequest()

		expect(systemPromptMock.mock.calls.at(-1)![0].settings).toMatchObject({ isStealthModel: true })
	})
})
