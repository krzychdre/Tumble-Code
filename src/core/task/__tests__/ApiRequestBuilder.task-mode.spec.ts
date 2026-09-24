// cd src && npx vitest run core/task/__tests__/ApiRequestBuilder.task-mode.spec.ts

import { ApiRequestBuilder, type ApiRequestBuilderAccess } from "../ApiRequestBuilder"

const systemPromptMock = vi.hoisted(() => vi.fn().mockResolvedValue("system prompt"))
vi.mock("../../prompts/system", () => ({ SYSTEM_PROMPT: systemPromptMock }))

/**
 * The provider state holds the mode of the FOCUSED task. A background subagent or a
 * delegated child can run in another mode, so its system prompt must be built for its
 * own mode (`Task.getTaskMode()`), not for whatever the user is looking at.
 */
describe("ApiRequestBuilder system prompt mode", () => {
	it("builds the system prompt for the task's mode, not the provider's", async () => {
		const provider = {
			getState: vi.fn().mockResolvedValue({ mode: "code", mcpEnabled: false }),
			context: {},
			getSkillsManager: vi.fn().mockReturnValue(undefined),
		}
		const access = {
			taskId: "task-1",
			providerRef: { deref: () => provider },
			api: { getModel: () => ({ id: "m", info: {} }) },
			cwd: "/workspace",
			materializedDeferredTools: new Set<string>(),
			getTaskMode: vi.fn().mockResolvedValue("architect"),
		} as unknown as ApiRequestBuilderAccess

		await new ApiRequestBuilder(access).buildSystemPrompt()

		expect(systemPromptMock).toHaveBeenCalledTimes(1)
		// SYSTEM_PROMPT(context, cwd, supportsComputerUse, mcpHub, diffStrategy, mode, ...)
		expect(systemPromptMock.mock.calls[0][5]).toBe("architect")
	})
})
