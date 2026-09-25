// pnpm --filter tumble-code test core/webview/__tests__/taskEventForwarding.spec.ts

import { EventEmitter } from "events"

import { RooCodeEventName } from "@roo-code/types"

import { TASK_EVENT_FORWARDING, forwardTaskEvents, type TaskEventForwardingHost } from "../taskEventForwarding"

const FORWARDED = [
	RooCodeEventName.TaskStarted,
	RooCodeEventName.TaskCompleted,
	RooCodeEventName.TaskAborted,
	RooCodeEventName.TaskFocused,
	RooCodeEventName.TaskUnfocused,
	RooCodeEventName.TaskActive,
	RooCodeEventName.TaskInteractive,
	RooCodeEventName.TaskResumable,
	RooCodeEventName.TaskIdle,
	RooCodeEventName.TaskPaused,
	RooCodeEventName.TaskUnpaused,
	RooCodeEventName.TaskSpawned,
	RooCodeEventName.TaskUserMessage,
	RooCodeEventName.TaskTokenUsageUpdated,
]

const tokenUsage = { totalTokensIn: 1, totalTokensOut: 2, totalCost: 3 } as any
const toolUsage = {} as any

const makeHost = () => ({
	emit: vi.fn(),
	subagentRegistry: {
		markTerminal: vi.fn(),
		setLiveStatus: vi.fn(),
		has: vi.fn().mockReturnValue(true),
		update: vi.fn(),
	},
	rehydrateAfterStreamingFailure: vi.fn().mockResolvedValue(undefined),
})

const makeTask = () => Object.assign(new EventEmitter(), { taskId: "t1" }) as any

describe("task event forwarding", () => {
	it("the table covers exactly the forwarded task events", () => {
		expect(Object.keys(TASK_EVENT_FORWARDING).sort()).toEqual([...FORWARDED].sort())
	})

	it("attaches one listener per event and the returned cleanups detach all of them", () => {
		const task = makeTask()
		const cleanups = forwardTaskEvents(task, makeHost() as unknown as TaskEventForwardingHost)
		expect(cleanups).toHaveLength(FORWARDED.length)
		for (const event of FORWARDED) {
			expect(task.listenerCount(event)).toBe(1)
		}
		cleanups.forEach((cleanup) => cleanup())
		expect(task.eventNames()).toEqual([])
	})

	it("events without a task id are forwarded with the task's id, the others with their own arguments", () => {
		const task = makeTask()
		const host = makeHost()
		forwardTaskEvents(task, host as unknown as TaskEventForwardingHost)
		task.emit(RooCodeEventName.TaskStarted)
		task.emit(RooCodeEventName.TaskFocused)
		task.emit(RooCodeEventName.TaskUnfocused)
		task.emit(RooCodeEventName.TaskSpawned, "child")
		task.emit(RooCodeEventName.TaskCompleted, "t1", tokenUsage, toolUsage)
		expect(host.emit.mock.calls).toEqual([
			[RooCodeEventName.TaskStarted, "t1"],
			[RooCodeEventName.TaskFocused, "t1"],
			[RooCodeEventName.TaskUnfocused, "t1"],
			[RooCodeEventName.TaskSpawned, "child"],
			[RooCodeEventName.TaskCompleted, "t1", tokenUsage, toolUsage],
		])
	})

	it("an abort marks the subagent failed, forwards, then asks the host to rehydrate", async () => {
		const task = makeTask()
		const host = makeHost()
		const order: string[] = []
		host.subagentRegistry.markTerminal.mockImplementation(() => order.push("markTerminal"))
		host.emit.mockImplementation(() => order.push("emit"))
		host.rehydrateAfterStreamingFailure.mockImplementation(async () => {
			order.push("rehydrate")
		})
		forwardTaskEvents(task, host as unknown as TaskEventForwardingHost)
		task.emit(RooCodeEventName.TaskAborted)
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(order).toEqual(["markTerminal", "emit", "rehydrate"])
		expect(host.subagentRegistry.markTerminal).toHaveBeenCalledWith("t1", "failed")
		expect(host.rehydrateAfterStreamingFailure).toHaveBeenCalledWith(task)
	})

	it("token usage updates the registry only for a known subagent", () => {
		const task = makeTask()
		const host = makeHost()
		forwardTaskEvents(task, host as unknown as TaskEventForwardingHost)
		host.subagentRegistry.has.mockReturnValue(false)
		task.emit(RooCodeEventName.TaskTokenUsageUpdated, "t1", tokenUsage, toolUsage)
		expect(host.subagentRegistry.update).not.toHaveBeenCalled()
		expect(host.emit).toHaveBeenCalledWith(RooCodeEventName.TaskTokenUsageUpdated, "t1", tokenUsage, toolUsage)
	})
})
