// npx vitest run core/task/__tests__/TaskLifecycle.profile-listener.spec.ts
//
// The panel's provider profile belongs to the task on screen. A task working
// off screen (left by the user while it was running, or a headless background
// task) must keep the configuration it runs on when the user opens another
// task with another profile.

import { describe, expect, it, vi } from "vitest"
import { TumbleCodeEventName } from "@tumble-code/types"

import { TaskLifecycle } from "../TaskLifecycle"

function setup(currentTaskId: string | undefined) {
	let listener: (() => Promise<void>) | undefined
	const provider = {
		on: vi.fn((event: string, callback: () => Promise<void>) => {
			if (event === TumbleCodeEventName.ProviderProfileChanged) {
				listener = callback
			}
		}),
		getState: vi.fn().mockResolvedValue({ apiConfiguration: { apiProvider: "openai" } }),
		getCurrentTask: vi.fn(() => (currentTaskId ? { taskId: currentTaskId } : undefined)),
	}
	const access = { taskId: "task-1", instanceId: "1", updateApiConfiguration: vi.fn() }
	new TaskLifecycle(access as any).setupProviderProfileChangeListener(provider as any)
	return { fire: () => listener!(), access, provider }
}

describe("provider profile changes reach only the task on screen", () => {
	it("updates the task on screen", async () => {
		const { fire, access } = setup("task-1")

		await fire()

		expect(access.updateApiConfiguration).toHaveBeenCalledWith({ apiProvider: "openai" })
	})

	it.each([
		["another task is on screen", "task-2"],
		["no task is on screen", undefined],
	])("leaves a task working off screen alone: %s", async (_label, currentTaskId) => {
		const { fire, access, provider } = setup(currentTaskId)

		await fire()

		expect(access.updateApiConfiguration).not.toHaveBeenCalled()
		expect(provider.getState).not.toHaveBeenCalled()
	})
})
