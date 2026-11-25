// cd src && ./node_modules/.bin/vitest run core/task/__tests__/TaskApiLoop.subtask-context-limit.spec.ts

import { TaskApiLoop } from "../TaskApiLoop"

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: { instance: { capture: vi.fn(), captureException: vi.fn(), captureEvent: vi.fn() } },
}))

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
}))

// A delegated task is reminded once at 65% of the window and handed over at 85% (the defaults).
describe("TaskApiLoop subtask context limit", () => {
	let access: any
	let loop: TaskApiLoop

	beforeEach(() => {
		access = {
			taskId: "child-1",
			isBackground: false,
			parentTaskId: "parent-1",
			contextHandoff: false,
			contextTokens: 0,
			microcompactStrippedTokens: 0,
			getTokenUsage() {
				return { contextTokens: this.contextTokens }
			},
			api: { getModel: () => ({ info: { contextWindow: 100_000 } }) },
			handOverAtContextLimit: vi.fn().mockResolvedValue(undefined),
		}
		loop = new TaskApiLoop(access)
	})

	// handleSubtaskContextLimit is private; it is the unit under test.
	const request = async (contextTokens: number, state?: object) => {
		access.contextTokens = contextTokens
		const content: any[] = []
		const stopped = (await (loop as any).handleSubtaskContextLimit(state, content)) as boolean
		return { stopped, content }
	}

	it.each([
		["a new_task child", { isBackground: false, parentTaskId: "parent-1" }],
		["a subagent", { isBackground: true, parentTaskId: undefined }],
	])("%s is reminded once from 65% and handed over at 85%", async (_, origin) => {
		Object.assign(access, origin)

		expect(await request(64_000)).toEqual({ stopped: false, content: [] })

		const reminded = await request(65_000)
		expect(reminded.stopped).toBe(false)
		expect(reminded.content).toHaveLength(1)
		expect(reminded.content[0].text).toContain("Your context window is 65% full. This subtask stops at 85%")
		expect(reminded.content[0].text).toContain("call attempt_completion with a handoff report")
		expect(access.contextHandoff).toBe(true)

		expect(await request(80_000)).toEqual({ stopped: false, content: [] })
		expect(access.handOverAtContextLimit).not.toHaveBeenCalled()

		expect((await request(85_000)).stopped).toBe(true)
		expect(access.handOverAtContextLimit).toHaveBeenCalledWith(
			"Its context window was 85% full, so it handed its work over.",
		)
	})

	it("uses the thresholds set in the settings", async () => {
		const state = { subtaskContextReminderPercent: 50, subtaskContextStopPercent: 70 }

		expect(await request(49_000, state)).toEqual({ stopped: false, content: [] })
		expect((await request(50_000, state)).content[0].text).toContain(
			"Your context window is 50% full. This subtask stops at 70%",
		)
		expect((await request(70_000, state)).stopped).toBe(true)
	})

	it("counts what microcompaction stripped from the request", async () => {
		access.microcompactStrippedTokens = 20_000

		expect((await request(66_000)).stopped).toBe(true)
	})

	it("leaves a task the user started the whole window", async () => {
		access.parentTaskId = undefined

		expect(await request(99_000)).toEqual({ stopped: false, content: [] })
		expect(access.contextHandoff).toBe(false)
		expect(access.handOverAtContextLimit).not.toHaveBeenCalled()
	})
})
