// cd src && ./node_modules/.bin/vitest run extension/__tests__/api-delegation-events.spec.ts

/**
 * The public API must forward the three delegation events to its consumers.
 *
 * DelegationService emits TaskDelegated, TaskDelegationCompleted and
 * TaskDelegationResumed on its host, and ClineProvider hands itself in as
 * that host (`emit: (event, ...args) => this.emit(...)`), so the events land
 * on the PROVIDER, never on a Task. This spec wires a real DelegationService
 * to a provider stand-in that is a real EventEmitter (the same `emit`
 * closure ClineProvider uses) and checks what the API re-emits.
 */

import { EventEmitter } from "events"

import { beforeEach, describe, expect, it, vi } from "vitest"
import type * as vscode from "vscode"
import { RooCodeEventName, type HistoryItem } from "@roo-code/types"

vi.mock("vscode", () => ({
	window: { showWarningMessage: vi.fn() },
	commands: { executeCommand: vi.fn() },
}))
vi.mock("../../core/webview/ClineProvider")
vi.mock("../../activate/registerCommands", () => ({ openClineInNewTab: vi.fn() }))
vi.mock("../../core/task-persistence", () => ({
	readApiMessages: vi.fn().mockResolvedValue([]),
	saveApiMessages: vi.fn().mockResolvedValue(undefined),
	saveTaskMessages: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../core/task-persistence/taskMessages", () => ({
	readTaskMessages: vi.fn().mockResolvedValue([]),
}))

import { API } from "../api"
import type { ClineProvider } from "../../core/webview/ClineProvider"
import { DelegationService, type DelegationHost } from "../../core/webview/DelegationService"

const item = (id: string, fields: Partial<HistoryItem> = {}): HistoryItem =>
	({ id, number: 1, ts: 1, task: id, tokensIn: 0, tokensOut: 0, totalCost: 0, ...fields }) as HistoryItem

/** Minimal in-memory history store with the members DelegationService touches. */
function makeStore() {
	const items = new Map<string, HistoryItem>()
	return {
		items,
		get: (id: string) => items.get(id),
		async atomicReadAndUpdate(id: string, updater: (current: HistoryItem) => HistoryItem) {
			const current = items.get(id)
			if (!current) {
				throw new Error(`missing ${id}`)
			}
			const updated = updater(structuredClone(current))
			items.set(id, updated)
			return updated
		},
	}
}

/** A Task stand-in: an EventEmitter with a taskId, like the real Task. */
function makeTask(taskId: string) {
	return Object.assign(new EventEmitter(), {
		taskId,
		flushPendingToolResultsToHistory: vi.fn().mockResolvedValue(true),
		retrySaveApiConversationHistory: vi.fn(),
		start: vi.fn(),
	})
}

describe("API forwards the delegation events DelegationService emits on the provider", () => {
	let provider: EventEmitter
	let api: API
	let service: DelegationService
	let store: ReturnType<typeof makeStore>
	let parent: ReturnType<typeof makeTask>
	let child: ReturnType<typeof makeTask>
	let currentTask: ReturnType<typeof makeTask> | undefined

	beforeEach(() => {
		provider = new EventEmitter()
		store = makeStore()
		parent = makeTask("p")
		child = makeTask("c1")
		currentTask = parent

		const outputChannel = { appendLine: vi.fn() } as unknown as vscode.OutputChannel
		Object.assign(provider, { context: {} })
		api = new API(outputChannel, provider as unknown as ClineProvider)

		// ClineProvider creates both tasks and emits TaskCreated for each, which
		// is where the API used to hang its (dead) per-task delegation listeners.
		provider.emit(RooCodeEventName.TaskCreated, parent)

		const host = {
			isViewLaunched: false,
			contextProxy: { globalStorageUri: { fsPath: "/storage" } },
			getTaskHistoryStore: vi.fn(async () => store),
			getHistoryItem: vi.fn(async (id: string) => {
				const found = store.items.get(id)
				if (!found) {
					throw new Error("Task not found")
				}
				return found
			}),
			updateTaskHistory: vi.fn(async (next: HistoryItem) => {
				store.items.set(next.id, next)
			}),
			postMessageToWebview: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
			getCurrentTask: vi.fn(() => currentTask),
			getCurrentTaskStack: vi.fn(() => (currentTask ? [currentTask.taskId] : [])),
			clearCurrentTask: vi.fn(async () => {
				currentTask = undefined
			}),
			createTask: vi.fn(async () => {
				provider.emit(RooCodeEventName.TaskCreated, child)
				currentTask = child
				return child
			}),
			createTaskWithHistoryItem: vi.fn(async () => ({
				overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
				overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
				resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
			})),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			// The same closure ClineProvider hands in: the event lands on the provider.
			emit: (event: string | symbol, ...args: unknown[]) => provider.emit(event, ...args),
			showAllowListViolation: vi.fn().mockReturnValue(false),
		}
		service = new DelegationService(host as unknown as DelegationHost)
		store.items.set("p", item("p", { status: "active" }))
	})

	it("re-emits TaskDelegated with (parentTaskId, childTaskId) exactly once", async () => {
		const delegated = vi.fn()
		api.on(RooCodeEventName.TaskDelegated, delegated)

		await service.delegate({ parentTaskId: "p", message: "do it", initialTodos: [], mode: "code" })

		expect(delegated).toHaveBeenCalledTimes(1)
		expect(delegated).toHaveBeenCalledWith("p", "c1")
	})

	it("re-emits TaskDelegationCompleted and TaskDelegationResumed exactly once, in order", async () => {
		await service.delegate({ parentTaskId: "p", message: "do it", initialTodos: [], mode: "code" })
		store.items.set("c1", item("c1", { status: "active" }))

		const order: string[] = []
		const completed = vi.fn(() => order.push("completed"))
		const resumed = vi.fn(() => order.push("resumed"))
		api.on(RooCodeEventName.TaskDelegationCompleted, completed)
		api.on(RooCodeEventName.TaskDelegationResumed, resumed)

		const reopened = await service.complete({
			parentTaskId: "p",
			childTaskId: "c1",
			completionResultSummary: "all done",
		})

		expect(reopened).toBe(true)
		// Two tasks exist by now (parent and child); a per-task listener would
		// fire twice or, as before this fix, not at all.
		expect(completed).toHaveBeenCalledTimes(1)
		expect(completed).toHaveBeenCalledWith("p", "c1", "all done")
		expect(resumed).toHaveBeenCalledTimes(1)
		expect(resumed).toHaveBeenCalledWith("p", "c1")
		expect(order).toEqual(["completed", "resumed"])
	})

	it("registers one provider listener per event, however many tasks are created", () => {
		provider.emit(RooCodeEventName.TaskCreated, makeTask("t2"))
		provider.emit(RooCodeEventName.TaskCreated, makeTask("t3"))

		expect(provider.listenerCount(RooCodeEventName.TaskDelegated)).toBe(1)
		expect(provider.listenerCount(RooCodeEventName.TaskDelegationCompleted)).toBe(1)
		expect(provider.listenerCount(RooCodeEventName.TaskDelegationResumed)).toBe(1)
	})
})
