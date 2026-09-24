// cd src && npx vitest run core/task/__tests__/TaskApiLoop.task-mode.spec.ts

import { TaskApiLoop, type TaskApiLoopAccess } from "../TaskApiLoop"

const processMentionsMock = vi.hoisted(() =>
	vi.fn(async ({ userContent }: { userContent: unknown[] }) => ({ content: userContent, mode: undefined })),
)
vi.mock("../../mentions/processUserContentMentions", () => ({ processUserContentMentions: processMentionsMock }))
vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn().mockResolvedValue("<environment_details></environment_details>"),
}))

/**
 * Slash commands in a user message resolve skills for a mode. That must be the mode of
 * the task receiving the message, not the focused task's mode held in provider state.
 */
describe("TaskApiLoop user content mode", () => {
	it("resolves slash-command skills for the task's mode, not the provider's", async () => {
		const provider = { getSkillsManager: vi.fn().mockReturnValue(undefined) }
		const access = {
			taskId: "task-1",
			instanceId: "1",
			cwd: "/workspace",
			providerRef: { deref: () => provider },
			getTaskMode: vi.fn().mockResolvedValue("architect"),
		} as unknown as TaskApiLoopAccess

		const loop = new TaskApiLoop(access) as unknown as {
			prepareUserContent: (
				state: unknown,
				content: unknown[],
				includeFileDetails: boolean,
				item: unknown,
			) => Promise<unknown>
		}
		await loop.prepareUserContent({ mode: "code" }, [{ type: "text", text: "/review" }], false, { retryAttempt: 0 })

		expect(processMentionsMock).toHaveBeenCalledWith(expect.objectContaining({ currentMode: "architect" }))
	})
})
