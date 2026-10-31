// npx vitest run src/core/task/__tests__/TaskApiLoop.mode-request-budget.spec.ts

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

const budgetedMode = {
	slug: "konsylium-odkrywca",
	name: "Explorer",
	roleDefinition: "Explores.",
	groups: ["read"],
	maxRequests: 3,
}
const state = { customModes: [budgetedMode] } as any

// A mode's request budget: one reminder past the budget, a stop two requests later.
describe("TaskApiLoop mode request budget", () => {
	let access: any
	let loop: TaskApiLoop
	let mode: string

	beforeEach(() => {
		mode = "konsylium-odkrywca"
		access = {
			taskId: "sub-1",
			isBackground: true,
			abortReason: undefined,
			askSay: { ask: vi.fn(), say: vi.fn() },
			getTaskMode: vi.fn(async () => mode),
			abortTask: vi.fn().mockResolvedValue(undefined),
			stopBackgroundTask: vi.fn().mockResolvedValue(undefined),
		}
		loop = new TaskApiLoop(access)
	})

	// handleModeRequestBudget is private; it is the unit under test.
	const request = (content: any[] = [], retryAttempt = 0) =>
		(loop as any).handleModeRequestBudget(
			state,
			{ userContent: content, retryAttempt },
			content,
		) as Promise<boolean>

	/** Makes `count` fresh requests and returns the content of each. */
	const requests = async (count: number) => {
		const contents: any[][] = []
		for (let i = 0; i < count; i++) {
			const content: any[] = []
			expect(await request(content)).toBe(false)
			contents.push(content)
		}
		return contents
	}

	it("the request past the budget carries one reminder; the next one does not", async () => {
		const contents = await requests(5)

		expect(contents.slice(0, 3)).toEqual([[], [], []])
		expect(contents[3]).toHaveLength(1)
		expect(contents[3][0].text).toContain("budget of 3 requests")
		expect(contents[3][0].text).toContain("attempt_completion")
		expect(contents[4]).toEqual([])
		expect(access.stopBackgroundTask).not.toHaveBeenCalled()
	})

	it("a background task still going two requests after the reminder is stopped with reason budget", async () => {
		await requests(5)

		expect(await request()).toBe(true)
		expect(access.stopBackgroundTask).toHaveBeenCalledWith(
			"budget",
			"It used its budget of 3 requests in konsylium-odkrywca mode and went on after a reminder to finish.",
		)
		expect(access.abortTask).not.toHaveBeenCalled()
	})

	it("a foreground task is shown the reason and aborted", async () => {
		access.isBackground = false
		await requests(5)

		expect(await request()).toBe(true)
		expect(access.askSay.say).toHaveBeenCalledWith(
			"error",
			"Task stopped: It used its budget of 3 requests in konsylium-odkrywca mode and went on after a reminder to finish.",
		)
		expect(access.abortReason).toBe("budget")
		expect(access.abortTask).toHaveBeenCalled()
		expect(access.stopBackgroundTask).not.toHaveBeenCalled()
	})

	it("retries of a failed request are not counted", async () => {
		await requests(3)
		for (let i = 0; i < 5; i++) {
			const content: any[] = []
			expect(await request(content, 1)).toBe(false)
			expect(content).toEqual([])
		}
	})

	it("counting starts again when the task switches mode", async () => {
		await requests(3)
		mode = "code"
		await requests(10)
		mode = "konsylium-odkrywca"

		const contents = await requests(3)

		expect(contents).toEqual([[], [], []])
	})

	it("a mode without a budget is never reminded or stopped", async () => {
		mode = "code"

		const contents = await requests(50)

		expect(contents.every((content) => content.length === 0)).toBe(true)
		expect(access.stopBackgroundTask).not.toHaveBeenCalled()
	})
})
