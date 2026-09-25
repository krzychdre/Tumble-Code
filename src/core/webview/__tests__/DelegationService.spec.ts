// cd src && ./node_modules/.bin/vitest run core/webview/__tests__/DelegationService.spec.ts

/**
 * Transition table of the delegation state machine (CORE-R2).
 *
 * The parent's `HistoryItem` carries the delegation state: `status`,
 * `awaitingChildId` (the authoritative "waiting for this child" signal),
 * `delegatedToId` (the last child it delegated to) and `childIds`. Each row
 * below starts from one parent state, runs one transition of
 * `DelegationService` against an in-memory history store, and pins the
 * parent state and the return value afterwards. The rows pin today's
 * behavior, including the quirks (see the "drift" rows).
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { RooCodeEventName, type HistoryItem } from "@roo-code/types"

vi.mock("vscode", () => ({
	window: { showWarningMessage: vi.fn() },
}))

vi.mock("../../task-persistence", () => ({
	readApiMessages: vi.fn().mockResolvedValue([]),
	saveApiMessages: vi.fn().mockResolvedValue(undefined),
	saveTaskMessages: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../task-persistence/taskMessages", () => ({
	readTaskMessages: vi.fn().mockResolvedValue([]),
}))

import { readApiMessages } from "../../task-persistence"
import { DelegationService, parentAwaitsChild, type DelegationHost } from "../DelegationService"

/**
 * In-memory stand-in for `TaskHistoryStore` with the same semantics for the
 * members the delegation code touches: `get` returns the cached item,
 * `upsert` replaces it, `atomicReadAndUpdate` throws for a missing task and
 * for an updater that changes the id, and hands the updater a copy.
 */
class InMemoryHistoryStore {
	readonly items = new Map<string, HistoryItem>()

	get(id: string): HistoryItem | undefined {
		return this.items.get(id)
	}

	async upsert(item: HistoryItem): Promise<void> {
		this.items.set(item.id, item)
	}

	async atomicReadAndUpdate(taskId: string, updater: (current: HistoryItem) => HistoryItem): Promise<HistoryItem> {
		const current = this.items.get(taskId)
		if (!current) {
			throw new Error(`[TaskHistoryStore.atomicReadAndUpdate] read failed for ${taskId}: file not found`)
		}
		const updated = updater(structuredClone(current))
		if (updated.id !== taskId) {
			throw new Error(`[TaskHistoryStore.atomicReadAndUpdate] updater changed task id`)
		}
		this.items.set(taskId, updated)
		return updated
	}
}

const item = (id: string, fields: Partial<HistoryItem> = {}): HistoryItem =>
	({ id, number: 1, ts: 1, task: id, tokensIn: 0, tokensOut: 0, totalCost: 0, ...fields }) as HistoryItem

/** A host over the in-memory store that mirrors ClineProvider's own history accessors. */
function makeHost(store: InMemoryHistoryStore, overrides: Partial<DelegationHost> = {}) {
	const host = {
		isViewLaunched: false,
		contextProxy: { globalStorageUri: { fsPath: "/storage" } },
		taskHistoryOrigin: Symbol("test"),
		getTaskHistoryStore: vi.fn(async () => store),
		getHistoryItem: vi.fn(async (id: string) => {
			const found = store.get(id)
			if (!found) {
				throw new Error("Task not found")
			}
			return found
		}),
		updateTaskHistory: vi.fn(async (next: HistoryItem) => store.upsert(next)),
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		log: vi.fn(),
		getCurrentTask: vi.fn().mockReturnValue(undefined),
		getCurrentTaskStack: vi.fn().mockReturnValue([]),
		removeClineFromStack: vi.fn().mockResolvedValue(undefined),
		createTask: vi.fn(),
		createTaskWithHistoryItem: vi.fn().mockResolvedValue({
			overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
			overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
			resumeAfterDelegation: vi.fn().mockResolvedValue(undefined),
		}),
		handleModeSwitch: vi.fn().mockResolvedValue(undefined),
		emit: vi.fn().mockReturnValue(true),
		showAllowListViolation: vi.fn().mockReturnValue(false),
		...overrides,
	}
	return host as typeof host & DelegationHost
}

/** API history of a parent frozen at a `new_task` call (optionally already answered). */
const frozenParentApi = (answered = false) => [
	{ role: "user", content: [{ type: "text", text: "start" }] },
	{ role: "assistant", content: [{ type: "tool_use", id: "tu-1", name: "new_task", input: {} }] },
	...(answered ? [{ role: "user", content: [{ type: "tool_result", tool_use_id: "tu-1", content: "done" }] }] : []),
]

/** The delegation fields of the parent after a transition. */
const delegationState = (h: HistoryItem | undefined) => ({
	status: h?.status,
	awaitingChildId: h?.awaitingChildId,
	delegatedToId: h?.delegatedToId,
	childIds: h?.childIds,
})

describe("DelegationService transition table", () => {
	let store: InMemoryHistoryStore

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(readApiMessages).mockResolvedValue([])
		store = new InMemoryHistoryStore()
	})

	describe("delegate: parent opens a child", () => {
		it.each([
			{
				name: "first child",
				parent: { status: "active" as const },
				expected: { status: "delegated", awaitingChildId: "c1", delegatedToId: "c1", childIds: ["c1"] },
			},
			{
				name: "a later child keeps earlier children once (no duplicates)",
				parent: { status: "active" as const, childIds: ["c0", "c1"], delegatedToId: "c0" },
				expected: { status: "delegated", awaitingChildId: "c1", delegatedToId: "c1", childIds: ["c0", "c1"] },
			},
		])("$name", async ({ parent, expected }) => {
			store.items.set("p", item("p", parent))
			const parentTask = {
				taskId: "p",
				flushPendingToolResultsToHistory: vi.fn().mockResolvedValue(true),
				retrySaveApiConversationHistory: vi.fn(),
			}
			const child = { taskId: "c1", start: vi.fn() }
			const host = makeHost(store, {
				getCurrentTask: vi.fn().mockReturnValue(parentTask),
				createTask: vi.fn().mockResolvedValue(child),
			})

			const opened = await new DelegationService(host).delegate({
				parentTaskId: "p",
				message: "do it",
				initialTodos: [],
				mode: "code",
			})

			expect(opened).toBe(child)
			expect(delegationState(store.get("p"))).toEqual(expected)
			expect(host.removeClineFromStack).toHaveBeenCalledWith({ skipDelegationRepair: true })
			expect(child.start).toHaveBeenCalledTimes(1)
			expect(host.emit).toHaveBeenCalledWith(RooCodeEventName.TaskDelegated, "p", "c1")
		})

		it("refuses when the parent is not the current task", async () => {
			const host = makeHost(store, { getCurrentTask: vi.fn().mockReturnValue({ taskId: "other" }) })

			await expect(
				new DelegationService(host).delegate({
					parentTaskId: "p",
					message: "m",
					initialTodos: [],
					mode: "code",
				}),
			).rejects.toThrow("[delegateParentAndOpenChild] Parent mismatch: expected p, current other")
		})
	})

	describe("detach: the awaited child goes away", () => {
		it.each([
			{
				name: "delegated to this child: detached",
				parent: { status: "delegated" as const, awaitingChildId: "c1", delegatedToId: "c1", childIds: ["c1"] },
				returns: true,
				expected: { status: "active", awaitingChildId: undefined, delegatedToId: "c1", childIds: ["c1"] },
			},
			{
				name: "delegated to another child: untouched",
				parent: { status: "delegated" as const, awaitingChildId: "c2", delegatedToId: "c2" },
				returns: false,
				expected: { status: "delegated", awaitingChildId: "c2", delegatedToId: "c2", childIds: undefined },
			},
			{
				name: "already detached: untouched",
				parent: { status: "active" as const, delegatedToId: "c1" },
				returns: false,
				expected: { status: "active", awaitingChildId: undefined, delegatedToId: "c1", childIds: undefined },
			},
			{
				// Drift: the completion gate (parentAwaitsChild) accepts this parent, detach does not.
				name: "status drifted to active while still awaiting this child: untouched",
				parent: { status: "active" as const, awaitingChildId: "c1", delegatedToId: "c1" },
				returns: false,
				expected: { status: "active", awaitingChildId: "c1", delegatedToId: "c1", childIds: undefined },
			},
			{
				name: "completed parent: untouched",
				parent: { status: "completed" as const, awaitingChildId: "c1" },
				returns: false,
				expected: { status: "completed", awaitingChildId: "c1", delegatedToId: undefined, childIds: undefined },
			},
		])("$name", async ({ parent, returns, expected }) => {
			store.items.set("p", item("p", parent))
			const host = makeHost(store)

			await expect(new DelegationService(host).detach("p", "c1")).resolves.toBe(returns)
			expect(delegationState(store.get("p"))).toEqual(expected)
		})

		it("throws when the parent is missing (callers decide how to fail)", async () => {
			await expect(new DelegationService(makeHost(store)).detach("p", "c1")).rejects.toThrow("Task not found")
		})
	})

	describe("detachOnCancel: the user cancels the child", () => {
		const child = item("c1", { status: "active", parentTaskId: "p", rootTaskId: "p" })

		it("detaches a parent that awaits the child and drops the lineage", async () => {
			store.items.set("p", item("p", { status: "delegated", awaitingChildId: "c1", delegatedToId: "c1" }))
			const service = new DelegationService(makeHost(store))
			service.cancelledChildIds.add("c1")

			const outcome = await service.detachOnCancel("c1", "p", child)

			expect(outcome).toEqual({ dropLineage: true, childHistory: child })
			expect(delegationState(store.get("p"))).toMatchObject({ status: "active", awaitingChildId: undefined })
			expect(service.cancelledChildIds.has("c1")).toBe(false)
		})

		it("keeps the lineage when the parent does not await the child", async () => {
			store.items.set("p", item("p", { status: "active", delegatedToId: "c1" }))

			const outcome = await new DelegationService(makeHost(store)).detachOnCancel("c1", "p", child)

			expect(outcome).toEqual({ dropLineage: false, childHistory: child })
		})

		it("fails closed when the parent cannot be read: the child becomes standalone and is fenced", async () => {
			store.items.set("c1", child)
			const service = new DelegationService(makeHost(store))

			const outcome = await service.detachOnCancel("c1", "p", child)

			const standalone = { ...child, parentTaskId: undefined, rootTaskId: undefined }
			expect(outcome).toEqual({ dropLineage: true, childHistory: standalone })
			expect(store.get("c1")).toEqual(standalone)
			expect(service.cancelledChildIds.has("c1")).toBe(true)
		})

		it("rethrows when the standalone child cannot be persisted either", async () => {
			const host = makeHost(store, {
				updateTaskHistory: vi.fn().mockRejectedValue(new Error("disk full")),
			})

			await expect(new DelegationService(host).detachOnCancel("c1", "p", child)).rejects.toThrow("disk full")
		})
	})

	describe("reattach: a detached parent takes a resumed child back", () => {
		const detachedParent = { status: "active" as const, delegatedToId: "c1", childIds: ["c1"] }

		it.each([
			{ name: "all five evidence conditions hold", parent: detachedParent, returns: true },
			{
				name: "parent still delegated",
				parent: { ...detachedParent, status: "delegated" as const },
				returns: false,
			},
			{
				name: "parent awaits another child",
				parent: { ...detachedParent, awaitingChildId: "c2" },
				returns: false,
			},
			{
				name: "parent last delegated elsewhere",
				parent: { ...detachedParent, delegatedToId: "c2" },
				returns: false,
			},
			{ name: "parent completed", parent: { ...detachedParent, status: "completed" as const }, returns: false },
			{ name: "parent open in the task stack", parent: detachedParent, stack: ["p"], returns: false },
			{ name: "parent already answered the new_task", parent: detachedParent, answered: true, returns: false },
			{ name: "no new_task in the parent history", parent: detachedParent, api: [], returns: false },
		])("$name", async ({ parent, returns, stack = [], answered = false, api }) => {
			store.items.set("p", item("p", parent))
			vi.mocked(readApiMessages).mockResolvedValue((api ?? frozenParentApi(answered)) as any)
			const host = makeHost(store, { getCurrentTaskStack: vi.fn().mockReturnValue(stack) })
			const before = delegationState(store.get("p"))

			await expect(new DelegationService(host).reattach("p", "c1")).resolves.toBe(returns)

			expect(delegationState(store.get("p"))).toEqual(
				returns ? { ...before, status: "delegated", awaitingChildId: "c1" } : before,
			)
		})

		it("returns false (never throws) when the parent API history cannot be read", async () => {
			store.items.set("p", item("p", detachedParent))
			vi.mocked(readApiMessages).mockRejectedValue(new Error("EACCES"))

			await expect(new DelegationService(makeHost(store)).reattach("p", "c1")).resolves.toBe(false)
		})

		it("returns false (never throws) when the parent is missing", async () => {
			await expect(new DelegationService(makeHost(store)).reattach("p", "c1")).resolves.toBe(false)
		})
	})

	describe("complete: the child hands its result back", () => {
		it.each([
			{
				name: "parent awaits this child",
				parent: { status: "delegated" as const, awaitingChildId: "c1", delegatedToId: "c1", childIds: ["c1"] },
				returns: true,
			},
			{
				// Drift kept on purpose (2026-06-08): a late save on the parent can flip the status only.
				name: "status drifted to active while still awaiting this child",
				parent: { status: "active" as const, awaitingChildId: "c1", delegatedToId: "c1" },
				returns: true,
			},
			{
				name: "parent awaits another child",
				parent: { status: "delegated" as const, awaitingChildId: "c2", delegatedToId: "c2" },
				returns: false,
			},
			{
				name: "parent detached",
				parent: { status: "active" as const, delegatedToId: "c1" },
				returns: false,
			},
			{
				name: "parent completed",
				parent: { status: "completed" as const, awaitingChildId: "c1" },
				returns: false,
			},
		])("$name", async ({ parent, returns }) => {
			store.items.set("p", item("p", parent))
			store.items.set("c1", item("c1", { status: "active", parentTaskId: "p" }))
			const host = makeHost(store)
			const before = store.get("p")

			await expect(
				new DelegationService(host).complete({
					parentTaskId: "p",
					childTaskId: "c1",
					completionResultSummary: "result",
				}),
			).resolves.toBe(returns)

			if (returns) {
				expect(store.get("p")).toMatchObject({
					status: "active",
					awaitingChildId: undefined,
					completedByChildId: "c1",
					completionResultSummary: "result",
					childIds: expect.arrayContaining(["c1"]),
				})
				expect(store.get("c1")?.status).toBe("completed")
				expect(host.createTaskWithHistoryItem).toHaveBeenCalledWith(expect.objectContaining({ id: "p" }), {
					startTask: false,
				})
			} else {
				expect(store.get("p")).toEqual(before)
				expect(store.get("c1")?.status).toBe("active")
				expect(host.createTaskWithHistoryItem).not.toHaveBeenCalled()
			}
		})

		it("refuses a child fenced by a failed cancel even when the parent still awaits it", async () => {
			store.items.set("p", item("p", { status: "delegated", awaitingChildId: "c1" }))
			const service = new DelegationService(makeHost(store))
			service.cancelledChildIds.add("c1")

			await expect(
				service.complete({ parentTaskId: "p", childTaskId: "c1", completionResultSummary: "r" }),
			).resolves.toBe(false)
		})
	})

	it("full cycle: delegate, cancel (detach), reattach, complete", async () => {
		store.items.set("p", item("p", { status: "active" }))
		store.items.set("c1", item("c1", { status: "active", parentTaskId: "p", rootTaskId: "p" }))
		vi.mocked(readApiMessages).mockResolvedValue(frozenParentApi() as any)
		const host = makeHost(store, {
			getCurrentTask: vi.fn().mockReturnValue({
				taskId: "p",
				flushPendingToolResultsToHistory: vi.fn().mockResolvedValue(true),
			}),
			createTask: vi.fn().mockResolvedValue({ taskId: "c1", start: vi.fn() }),
		})
		const service = new DelegationService(host)

		await service.delegate({ parentTaskId: "p", message: "m", initialTodos: [], mode: "code" })
		expect(delegationState(store.get("p"))).toEqual({
			status: "delegated",
			awaitingChildId: "c1",
			delegatedToId: "c1",
			childIds: ["c1"],
		})

		await service.detachOnCancel("c1", "p", store.get("c1")!)
		expect(delegationState(store.get("p"))).toMatchObject({ status: "active", awaitingChildId: undefined })

		vi.mocked(host.getCurrentTask).mockReturnValue(undefined)
		await expect(service.reattach("p", "c1")).resolves.toBe(true)
		expect(delegationState(store.get("p"))).toMatchObject({ status: "delegated", awaitingChildId: "c1" })

		await expect(
			service.complete({ parentTaskId: "p", childTaskId: "c1", completionResultSummary: "r" }),
		).resolves.toBe(true)
		expect(store.get("p")).toMatchObject({ status: "active", awaitingChildId: undefined, completedByChildId: "c1" })
		expect(store.get("c1")?.status).toBe("completed")
	})
})

describe("parentAwaitsChild (the completion gate)", () => {
	it.each([
		{ parent: { status: "delegated" as const, awaitingChildId: "c1" }, expected: true },
		{ parent: { status: "active" as const, awaitingChildId: "c1" }, expected: true },
		{ parent: { status: "completed" as const, awaitingChildId: "c1" }, expected: false },
		{ parent: { status: "delegated" as const, awaitingChildId: "c2" }, expected: false },
		{ parent: { status: "active" as const }, expected: false },
	])("$parent.status awaiting $parent.awaitingChildId -> $expected", ({ parent, expected }) => {
		expect(parentAwaitsChild(item("p", parent), "c1")).toBe(expected)
	})

	it("is false for a missing parent", () => {
		expect(parentAwaitsChild(undefined, "c1")).toBe(false)
	})
})
