// npx vitest run src/core/task/__tests__/TaskApiLoop.background-mistake-limit.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

import { TaskApiLoop } from "../TaskApiLoop"

vi.mock("@tumble-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			capture: vi.fn(),
			captureException: vi.fn(),
			captureEvent: vi.fn(),
		},
	},
}))

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
}))

// A parallel subagent has no turn limit and nobody to ask: its mistake limit
// first hints, then stops the task as stuck.
describe("TaskApiLoop background mistake limit", () => {
	let access: any
	let loop: TaskApiLoop

	beforeEach(() => {
		access = {
			taskId: "sub-1",
			isBackground: true,
			consecutiveMistakeCount: 0,
			consecutiveMistakeLimit: 3,
			apiConfiguration: { apiProvider: "openai" },
			lastToolErrorName: "apply_diff",
			askSay: { ask: vi.fn(), say: vi.fn() },
			stopStuckBackgroundTask: vi.fn().mockResolvedValue(undefined),
		}
		loop = new TaskApiLoop(access)
	})

	// handleBackgroundMistakeLimit is private; it is the unit under test.
	const check = (content: any[] = []) => (loop as any).handleBackgroundMistakeLimit(content) as Promise<boolean>

	it("below the limit: nothing happens", async () => {
		access.consecutiveMistakeCount = 2
		const content: any[] = []

		expect(await check(content)).toBe(false)
		expect(content).toEqual([])
		expect(access.stopStuckBackgroundTask).not.toHaveBeenCalled()
	})

	it("at the limit: one hint, never the user ask, the count is kept", async () => {
		access.consecutiveMistakeCount = 3
		const first: any[] = []
		const second: any[] = []

		expect(await check(first)).toBe(false)
		access.consecutiveMistakeCount = 4
		expect(await check(second)).toBe(false)

		const hint = JSON.parse(first[0].text)
		expect(hint.status).toBe("guidance")
		expect(hint.feedback).toContain("attempt_completion")
		expect(hint.failed_tool).toBe("apply_diff")
		expect(second).toEqual([])
		expect(access.askSay.ask).not.toHaveBeenCalled()
		expect(access.consecutiveMistakeCount).toBe(4)
	})

	it("twice the limit after the hint: the task is stopped as stuck", async () => {
		access.consecutiveMistakeCount = 3
		await check()
		access.consecutiveMistakeCount = 6

		expect(await check()).toBe(true)
		expect(access.stopStuckBackgroundTask).toHaveBeenCalledWith(
			"It made 6 mistakes in a row (last failing tool: apply_diff), even after a hint to change course.",
		)
	})

	it("a success in between (count back under the limit) starts a new run with a new hint", async () => {
		access.consecutiveMistakeCount = 3
		await check()
		access.consecutiveMistakeCount = 0
		await check()
		access.consecutiveMistakeCount = 6
		const content: any[] = []

		expect(await check(content)).toBe(false)
		expect(content).toHaveLength(1)
		expect(access.stopStuckBackgroundTask).not.toHaveBeenCalled()
	})

	it("a profile limit of 0 (no limit) still uses the default for a subagent", async () => {
		access.consecutiveMistakeLimit = 0
		access.consecutiveMistakeCount = 3
		const content: any[] = []

		await check(content)

		expect(content).toHaveLength(1)
	})
})
