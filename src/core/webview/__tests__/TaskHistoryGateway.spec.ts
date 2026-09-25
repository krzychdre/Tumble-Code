// pnpm --filter tumble-code test core/webview/__tests__/TaskHistoryGateway.spec.ts

import * as path from "path"
import fs from "fs/promises"
import type { HistoryItem } from "@roo-code/types"

import { TaskHistoryStore, type TaskHistoryStoreHandle } from "../../task-persistence"
import { ShadowCheckpointService } from "../../../services/checkpoints/ShadowCheckpointService"
import { TaskHistoryGateway, type TaskHistoryGatewayHost } from "../TaskHistoryGateway"
import type { MockInstance } from "vitest"

vi.mock("fs/promises", () => {
	const mocks = {
		readFile: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })),
		rm: vi.fn().mockResolvedValue(undefined),
		access: vi.fn().mockResolvedValue(undefined),
	}
	return { ...mocks, default: mocks }
})

vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: vi.fn(async (_base: string, id: string) => `/storage/tasks/${id}`),
}))

vi.mock("../../../services/checkpoints/ShadowCheckpointService", () => ({
	ShadowCheckpointService: { deleteTask: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock("../../../integrations/misc/export-markdown", () => ({
	getTaskFileName: vi.fn((ts: number) => `task-${ts}.md`),
	downloadTask: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../utils/export", () => ({
	resolveDefaultSaveUri: vi.fn().mockResolvedValue(undefined),
	saveLastExportPath: vi.fn().mockResolvedValue(undefined),
}))

const item = (id: string, overrides: Partial<HistoryItem> = {}): HistoryItem => ({
	id,
	number: 1,
	ts: 1000,
	task: `task ${id}`,
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	...overrides,
})

/** An in-memory store double that records the origin of every write. */
const makeHandle = () => {
	const records = new Map<string, HistoryItem>()
	const listeners: Array<(event: any) => void> = []
	const unsubscribe = vi.fn()
	const store = {
		onChange: vi.fn((listener: (event: any) => void) => {
			listeners.push(listener)
			return unsubscribe
		}),
		migrateFromLegacyHistory: vi.fn().mockResolvedValue(true),
		upsert: vi.fn(async (next: HistoryItem, _origin?: symbol) => void records.set(next.id, next)),
		delete: vi.fn(async (id: string, _origin?: symbol) => void records.delete(id)),
		deleteMany: vi.fn(async (ids: string[], _origin?: symbol) => ids.forEach((id) => records.delete(id))),
		atomicReadAndUpdate: vi.fn(
			async (id: string, updater: (current: HistoryItem) => HistoryItem, _origin?: symbol) => {
				const updated = updater(records.get(id)!)
				records.set(id, updated)
				return updated
			},
		),
		get: vi.fn((id: string) => records.get(id)),
		getAll: vi.fn(() => Array.from(records.values()).sort((a, b) => b.ts - a.ts)),
	}
	const handle = { store: store as unknown as TaskHistoryStore, dispose: vi.fn() } as TaskHistoryStoreHandle
	const fire = (event: any) => listeners.forEach((listener) => listener(event))
	return { handle, store, records, fire, unsubscribe }
}

const makeHost = () => {
	const state = { isViewLaunched: true, isDisposed: false }
	const contextProxy = {
		globalStorageUri: { fsPath: "/storage" },
		hasLegacyTaskHistory: vi.fn().mockReturnValue(false),
		getLegacyTaskHistory: vi.fn().mockReturnValue(undefined),
		clearLegacyTaskHistoryKeys: vi.fn().mockResolvedValue(undefined),
	}
	const host = {
		get isViewLaunched() {
			return state.isViewLaunched
		},
		get isDisposed() {
			return state.isDisposed
		},
		contextProxy,
		cwd: "/workspace",
		log: vi.fn(),
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		postStateToWebviewWithoutClineMessages: vi.fn().mockResolvedValue(undefined),
		getCurrentTask: vi.fn().mockReturnValue(undefined),
		removeClineFromStack: vi.fn().mockResolvedValue(undefined),
	}
	return { host, state, contextProxy }
}

const gatewayFor = (host: ReturnType<typeof makeHost>["host"]) =>
	new TaskHistoryGateway(host as unknown as TaskHistoryGatewayHost)

const messagesOfType = (host: { postMessageToWebview: ReturnType<typeof vi.fn> }, type: string) =>
	host.postMessageToWebview.mock.calls.map((call) => call[0]).filter((message: any) => message.type === type)

describe("TaskHistoryGateway", () => {
	let acquire: MockInstance<typeof TaskHistoryStore.acquire> | undefined

	afterEach(() => {
		acquire?.mockRestore()
		vi.clearAllMocks()
	})

	const ready = async () => {
		const store = makeHandle()
		acquire = vi.spyOn(TaskHistoryStore, "acquire").mockResolvedValue(store.handle)
		const { host, state, contextProxy } = makeHost()
		const gateway = gatewayFor(host)
		await gateway.getStore()
		return { gateway, host, state, contextProxy, ...store }
	}

	describe("echo suppression", () => {
		it("marks every write with the gateway's own origin", async () => {
			const { gateway, store, records } = await ready()
			records.set("a", item("a"))
			records.set("b", item("b"))

			await gateway.updateTaskHistory(item("c"), { broadcast: false })
			await gateway.atomicReadAndUpdateHistoryItem("c", (current) => ({ ...current, task: "changed" }))
			await gateway.deleteTaskFromState("a")
			await gateway.deleteTaskWithId("b")

			expect(typeof gateway.origin).toBe("symbol")
			expect(store.upsert).toHaveBeenCalledWith(item("c"), gateway.origin)
			expect(store.atomicReadAndUpdate).toHaveBeenCalledWith("c", expect.any(Function), gateway.origin)
			expect(store.delete).toHaveBeenCalledWith("a", gateway.origin)
			expect(store.deleteMany).toHaveBeenCalledWith(["b"], gateway.origin)
		})

		it.each([
			["own upsert", (origin: symbol) => ({ kind: "upsert", taskId: "x", item: item("x"), origin }), {}],
			["own delete", (origin: symbol) => ({ kind: "delete", taskId: "x", origin }), {}],
			[
				"foreign upsert",
				() => ({ kind: "upsert", taskId: "x", item: item("x"), origin: Symbol("other") }),
				{ taskHistoryItemUpdated: 1 },
			],
			[
				"foreign delete",
				() => ({ kind: "delete", taskId: "x", origin: Symbol("other") }),
				{ taskHistoryItemDeleted: 1 },
			],
			["external change", () => ({ kind: "external", external: true }), { taskHistoryUpdated: 1 }],
			["upsert without an item", () => ({ kind: "upsert", taskId: "x", origin: Symbol("other") }), {}],
		])("routes a %s", async (_name, makeEvent, expected: Record<string, number>) => {
			const { gateway, host, fire } = await ready()
			fire(makeEvent(gateway.origin))
			await vi.waitFor(() => {
				for (const type of ["taskHistoryItemUpdated", "taskHistoryItemDeleted", "taskHistoryUpdated"]) {
					expect(messagesOfType(host, type)).toHaveLength(expected[type] ?? 0)
				}
			})
		})

		it("pushes nothing while the view is not launched or after dispose", async () => {
			const { host, state, fire } = await ready()
			state.isViewLaunched = false
			fire({ kind: "external", external: true })
			fire({ kind: "delete", taskId: "x", origin: Symbol("other") })
			state.isViewLaunched = true
			state.isDisposed = true
			fire({ kind: "external", external: true })
			fire({ kind: "upsert", taskId: "x", item: item("x"), origin: Symbol("other") })
			await new Promise((resolve) => setTimeout(resolve, 5))
			expect(host.postMessageToWebview).not.toHaveBeenCalled()
		})

		it("broadcasts the history sorted newest first without entries lacking ts or task", async () => {
			const { gateway, host, records } = await ready()
			records.set("old", item("old", { ts: 1 }))
			records.set("new", item("new", { ts: 2 }))
			records.set("empty", item("empty", { task: "" }))

			await gateway.broadcastTaskHistoryUpdate()

			expect(messagesOfType(host, "taskHistoryUpdated")[0].taskHistory.map((h: HistoryItem) => h.id)).toEqual([
				"new",
				"old",
			])
		})
	})

	describe("store acquire and reacquire", () => {
		it("reports a failed acquire, rethrows it during the cooldown and retries after it", async () => {
			const store = makeHandle()
			acquire = vi
				.spyOn(TaskHistoryStore, "acquire")
				.mockRejectedValueOnce(new Error("disk gone"))
				.mockResolvedValueOnce(store.handle)
			const { host } = makeHost()
			const gateway = gatewayFor(host)
			const now = vi.spyOn(Date, "now").mockReturnValue(10_000)

			await expect(gateway.getStore()).rejects.toThrow("disk gone")
			expect(gateway.storageErrorMessage).toBe("TaskHistoryStore: disk gone")
			expect(host.postStateToWebviewWithoutClineMessages).toHaveBeenCalledTimes(1)
			expect(acquire).toHaveBeenCalledWith("/storage")

			now.mockReturnValue(10_000 + TaskHistoryGateway.RETRY_COOLDOWN_MS - 1)
			await expect(gateway.getStore()).rejects.toThrow("disk gone")
			expect(acquire).toHaveBeenCalledTimes(1)

			now.mockReturnValue(10_000 + TaskHistoryGateway.RETRY_COOLDOWN_MS)
			await expect(gateway.getStore()).resolves.toBe(store.handle.store)
			expect(acquire).toHaveBeenCalledTimes(2)
			expect(gateway.storageErrorMessage).toBe("")
			expect(host.postStateToWebviewWithoutClineMessages).toHaveBeenCalledTimes(2)
			now.mockRestore()
		})

		it("shares one acquire between parallel callers", async () => {
			const store = makeHandle()
			acquire = vi.spyOn(TaskHistoryStore, "acquire").mockResolvedValue(store.handle)
			const gateway = gatewayFor(makeHost().host)

			const [a, b] = await Promise.all([gateway.getStore(), gateway.getStore()])

			expect(a).toBe(b)
			expect(acquire).toHaveBeenCalledTimes(1)
			expect(store.store.onChange).toHaveBeenCalledTimes(1)
		})

		it("releases a store that resolves after the host was disposed", async () => {
			const store = makeHandle()
			acquire = vi.spyOn(TaskHistoryStore, "acquire").mockResolvedValue(store.handle)
			const { host, state } = makeHost()
			const gateway = gatewayFor(host)
			const pending = gateway.acquire()
			state.isDisposed = true

			await expect(pending).rejects.toThrow("ClineProvider was disposed before TaskHistoryStore became ready")
			expect(store.handle.dispose).toHaveBeenCalledTimes(1)
			expect(store.store.onChange).not.toHaveBeenCalled()
			expect(gateway.storageErrorMessage).toBe("")
			await expect(gateway.getStore()).rejects.toThrow("ClineProvider is disposed")
		})

		it("dispose unsubscribes and releases the shared handle", async () => {
			const { gateway, handle, unsubscribe } = await ready()
			gateway.dispose()
			expect(unsubscribe).toHaveBeenCalledTimes(1)
			expect(handle.dispose).toHaveBeenCalledTimes(1)
		})
	})

	describe("legacy migration", () => {
		it("keeps the legacy keys and reports an error when the migration is incomplete, but the store stays usable", async () => {
			const store = makeHandle()
			store.store.migrateFromLegacyHistory.mockResolvedValue(false)
			acquire = vi.spyOn(TaskHistoryStore, "acquire").mockResolvedValue(store.handle)
			const { host, contextProxy } = makeHost()
			contextProxy.hasLegacyTaskHistory.mockReturnValue(true)
			contextProxy.getLegacyTaskHistory.mockReturnValue([item("legacy")])
			const gateway = gatewayFor(host)

			await expect(gateway.getStore()).resolves.toBe(store.handle.store)
			expect(store.store.migrateFromLegacyHistory).toHaveBeenCalledWith([item("legacy")])
			expect(contextProxy.clearLegacyTaskHistoryKeys).not.toHaveBeenCalled()
		})

		it("clears the legacy keys after a successful migration", async () => {
			const store = makeHandle()
			acquire = vi.spyOn(TaskHistoryStore, "acquire").mockResolvedValue(store.handle)
			const { host, contextProxy } = makeHost()
			contextProxy.hasLegacyTaskHistory.mockReturnValue(true)
			contextProxy.getLegacyTaskHistory.mockReturnValue([item("legacy")])

			await gatewayFor(host).getStore()

			expect(contextProxy.clearLegacyTaskHistoryKeys).toHaveBeenCalledTimes(1)
		})

		it("reports a throwing migration as a storage error without failing the acquire", async () => {
			const store = makeHandle()
			store.store.migrateFromLegacyHistory.mockRejectedValue(new Error("bad legacy"))
			acquire = vi.spyOn(TaskHistoryStore, "acquire").mockResolvedValue(store.handle)
			const { host, contextProxy } = makeHost()
			contextProxy.hasLegacyTaskHistory.mockReturnValue(true)
			contextProxy.getLegacyTaskHistory.mockReturnValue([item("legacy")])
			const gateway = gatewayFor(host)

			await expect(gateway.getStore()).resolves.toBe(store.handle.store)
			expect(gateway.storageErrorMessage).toBe("TaskHistoryStore: bad legacy")
		})
	})

	describe("storage-error banner", () => {
		it("posts once per distinct error and clears only when an error was set", async () => {
			const { gateway, host } = await ready()
			host.postStateToWebviewWithoutClineMessages.mockClear()

			gateway.clearStorageError()
			expect(host.postStateToWebviewWithoutClineMessages).not.toHaveBeenCalled()

			gateway.reportStorageError("Ctx", new Error("full"))
			gateway.reportStorageError("Ctx", new Error("full"))
			expect(gateway.storageErrorMessage).toBe("Ctx: full")
			expect(host.postStateToWebviewWithoutClineMessages).toHaveBeenCalledTimes(1)
			expect(host.log).toHaveBeenCalledWith("[storage error] Ctx: full")

			gateway.clearStorageError()
			expect(gateway.storageErrorMessage).toBe("")
			expect(host.postStateToWebviewWithoutClineMessages).toHaveBeenCalledTimes(2)
		})

		it("falls back to a partial state push when the full push rejects", async () => {
			const { gateway, host } = await ready()
			host.postStateToWebviewWithoutClineMessages.mockRejectedValue(new Error("store down"))

			gateway.reportStorageError("Ctx", "plain string")

			await vi.waitFor(() =>
				expect(host.postMessageToWebview).toHaveBeenCalledWith({
					type: "state",
					state: { storageErrorMessage: "Ctx: plain string" },
				}),
			)
			expect(host.log).toHaveBeenCalledWith("[storage error] Failed to post full state: store down")
		})
	})

	describe("task-history operations", () => {
		it("getHistoryItem throws 'Task not found' for an unknown id", async () => {
			const { gateway } = await ready()
			await expect(gateway.getHistoryItem("nope")).rejects.toThrow("Task not found")
		})

		it("updateTaskHistory pushes the stored item only when asked and the view is launched", async () => {
			const { gateway, host, state } = await ready()
			await gateway.updateTaskHistory(item("u"))
			await gateway.updateTaskHistory(item("u"), { broadcast: false })
			state.isViewLaunched = false
			await gateway.updateTaskHistory(item("u"))
			expect(messagesOfType(host, "taskHistoryItemUpdated")).toEqual([
				{ type: "taskHistoryItemUpdated", taskHistoryItem: item("u") },
			])
		})

		it("getTaskWithId parses the conversation file of the task", async () => {
			const { gateway, records } = await ready()
			records.set("conv", item("conv"))
			vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify([{ role: "user", content: "hi" }]) as never)

			const result = await gateway.getTaskWithId("conv")

			expect(result).toEqual({
				historyItem: item("conv"),
				taskDirPath: "/storage/tasks/conv",
				apiConversationHistoryFilePath: path.join("/storage/tasks/conv", "api_conversation_history.json"),
				uiMessagesFilePath: path.join("/storage/tasks/conv", "ui_messages.json"),
				apiConversationHistory: [{ role: "user", content: "hi" }],
			})
		})

		it("deleteTaskWithId removes checkpoints and task directories of the whole family", async () => {
			const { gateway, host, records } = await ready()
			records.set("p", item("p", { childIds: ["c"] }))
			records.set("c", item("c"))
			host.getCurrentTask.mockReturnValue({ taskId: "c" })

			await gateway.deleteTaskWithId("p")

			expect(host.removeClineFromStack).toHaveBeenCalledTimes(1)
			expect(ShadowCheckpointService.deleteTask).toHaveBeenCalledWith({
				taskId: "c",
				globalStorageDir: "/storage",
				workspaceDir: "/workspace",
			})
			expect(fs.rm).toHaveBeenCalledWith("/storage/tasks/p", { recursive: true, force: true })
			expect(fs.rm).toHaveBeenCalledWith("/storage/tasks/c", { recursive: true, force: true })
			expect(host.postStateToWebview).toHaveBeenCalledTimes(1)
		})

		it("deleteTaskWithId rethrows errors other than 'Task not found'", async () => {
			const { gateway, store, records } = await ready()
			records.set("p", item("p"))
			store.deleteMany.mockRejectedValueOnce(new Error("locked"))
			await expect(gateway.deleteTaskWithId("p")).rejects.toThrow("locked")
		})

		it("getTaskWithAggregatedCosts sums the task and its subtasks", async () => {
			const { gateway, records } = await ready()
			records.set("p", item("p", { totalCost: 1, childIds: ["c"] }))
			records.set("c", item("c", { totalCost: 2 }))

			const { historyItem, aggregatedCosts } = await gateway.getTaskWithAggregatedCosts("p")

			expect(historyItem.id).toBe("p")
			expect(aggregatedCosts.totalCost).toBe(3)
		})
	})
})
