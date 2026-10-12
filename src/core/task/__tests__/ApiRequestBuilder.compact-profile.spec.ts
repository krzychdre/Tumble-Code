// cd src && npx vitest run core/task/__tests__/ApiRequestBuilder.compact-profile.spec.ts

import type { ProviderSettings } from "@tumble-code/types"

import { ApiRequestBuilder, type ApiRequestBuilderAccess } from "../ApiRequestBuilder"

const systemPromptMock = vi.hoisted(() => vi.fn().mockResolvedValue("system prompt"))
vi.mock("../../prompts/system", () => ({ SYSTEM_PROMPT: systemPromptMock }))

const buildToolsMock = vi.hoisted(() => vi.fn().mockResolvedValue({ tools: [] }))
vi.mock("../build-tools", () => ({ buildNativeToolsArrayWithRestrictions: buildToolsMock }))

/**
 * The compact profile follows the profile that SERVES the request: the task's own
 * `apiConfiguration`, the one its API handler was built from. The provider
 * state's `apiConfiguration` is the panel's active profile, which belongs to the
 * focused task; a background subagent or a detached parent runs on its own.
 */
function makeBuilder(taskProfile: ProviderSettings, activeProfile: ProviderSettings) {
	const state = { mode: "code", mcpEnabled: false, apiConfiguration: activeProfile }
	const provider = {
		getState: vi.fn().mockResolvedValue(state),
		context: {},
		getMcpHub: vi.fn().mockReturnValue(undefined),
		getSkillsManager: vi.fn().mockReturnValue(undefined),
	}
	const access = {
		taskId: "task-1",
		providerRef: { deref: () => provider },
		apiConfiguration: taskProfile,
		api: { getModel: () => ({ id: "m", info: {} }) },
		isBackground: true,
		cwd: "/workspace",
		materializedDeferredTools: new Set<string>(),
		deferredToolDirectory: new Map(),
		getTaskMode: vi.fn().mockResolvedValue("code"),
	} as unknown as ApiRequestBuilderAccess
	return { builder: new ApiRequestBuilder(access), state }
}

const compact: ProviderSettings = { apiProvider: "openai", compactProfile: true }
const full: ProviderSettings = { apiProvider: "anthropic" }

beforeEach(() => {
	systemPromptMock.mockClear()
	buildToolsMock.mockClear()
})

describe("ApiRequestBuilder compact profile source", () => {
	it("gives the system prompt the task's flag when the active profile is not compact", async () => {
		const { builder } = makeBuilder(compact, full)

		await builder.buildSystemPrompt()

		expect(systemPromptMock.mock.calls[0][0].settings.compactProfile).toBe(true)
	})

	it("keeps the system prompt off when only the active profile is compact", async () => {
		const { builder } = makeBuilder(full, compact)

		await builder.buildSystemPrompt()

		expect(systemPromptMock.mock.calls[0][0].settings.compactProfile).toBe(false)
	})

	it("gives the tool filter the task's flag, not the active profile's", async () => {
		const onTask = makeBuilder(compact, full)
		await onTask.builder.buildToolsArray(onTask.state as never, onTask.state.apiConfiguration, "code", {} as never)

		const onPanel = makeBuilder(full, compact)
		await onPanel.builder.buildToolsArray(
			onPanel.state as never,
			onPanel.state.apiConfiguration,
			"code",
			{} as never,
		)

		expect(buildToolsMock.mock.calls[0][0].compactProfile).toBe(true)
		expect(buildToolsMock.mock.calls[1][0].compactProfile).toBe(false)
		// The slim flags keep reading the profile handed in (the active one), unchanged.
		expect(buildToolsMock.mock.calls[1][0].apiConfiguration).toBe(compact)
	})
})
