// pnpm --filter tumble-code test core/webview/__tests__/TaskHistoryGateway.sharedStore.spec.ts
//
// The sidebar and every Tumble editor tab have their own ClineProvider, and so
// their own TaskHistoryGateway, on ONE shared TaskHistoryStore. A history
// change made in one panel (a new task, a pin, a delete) must reach the other
// panels' webviews at once, without a reload. These tests use a real store on
// a temporary directory, so they prove the store's change echo and the
// gateways' origin filter together.

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import type { HistoryItem } from "@tumble-code/types"

import { TaskHistoryStore } from "../../task-persistence"
import { TaskHistoryGateway, type TaskHistoryGatewayHost } from "../TaskHistoryGateway"

vi.mock("../../../utils/storage", () => ({
	getStorageBasePath: vi.fn().mockImplementation((defaultPath: string) => defaultPath),
	getTaskDirectoryPath: vi.fn(async (base: string, id: string) => path.join(base, "tasks", id)),
}))

// Plain fs writes instead of proper-lockfile, as in TaskHistoryStore.crossInstance.spec.ts.
vi.mock("@tumble-code/core/fs", () => {
	const write = vi.fn().mockImplementation(async (filePath: string, data: unknown) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(data, null, "\t"), "utf8")
	})
	return {
		safeWriteJson: write,
		writeFileAtomic: vi.fn().mockResolvedValue(undefined),
		withLockedJsonTransaction: vi.fn(
			async <T>(
				_lockTarget: string,
				destination: string,
				body: (writeJson: (data: unknown) => Promise<void>) => Promise<T>,
			) => body((data) => write(destination, data)),
		),
	}
})

const item = (id: string): HistoryItem => ({
	id,
	number: 1,
	ts: 1000,
	task: `task ${id}`,
	tokensIn: 0,
	tokensOut: 0,
	totalCost: 0,
	workspace: "/workspace",
})

/** One panel: a launched webview whose posted messages the test reads. */
const makePanel = (storagePath: string) => {
	const host = {
		isViewLaunched: true,
		isDisposed: false,
		contextProxy: {
			globalStorageUri: { fsPath: storagePath },
			hasLegacyTaskHistory: vi.fn().mockReturnValue(false),
			getLegacyTaskHistory: vi.fn().mockReturnValue(undefined),
			clearLegacyTaskHistoryKeys: vi.fn().mockResolvedValue(undefined),
		},
		cwd: "/workspace",
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		postStateToWebviewWithoutClineMessages: vi.fn().mockResolvedValue(undefined),
		getCurrentTask: vi.fn().mockReturnValue(undefined),
		clearCurrentTask: vi.fn().mockResolvedValue(undefined),
		destroyDetachedTasks: vi.fn().mockResolvedValue(undefined),
		abortBackgroundTasks: vi.fn().mockResolvedValue(undefined),
	}
	const gateway = new TaskHistoryGateway(host as unknown as TaskHistoryGatewayHost)
	const messages = (type: string) =>
		host.postMessageToWebview.mock.calls
			.map(([message]) => message as { type: string; taskHistoryItem?: HistoryItem; taskHistoryItemId?: string })
			.filter((message) => message.type === type)
	return { host, gateway, messages }
}

describe("TaskHistoryGateway - several panels on one shared store", () => {
	let storagePath: string
	let panels: Array<ReturnType<typeof makePanel>>

	beforeEach(async () => {
		storagePath = await fs.mkdtemp(path.join(os.tmpdir(), "task-history-panels-"))
		panels = []
	})

	afterEach(async () => {
		for (const panel of panels) {
			panel.gateway.dispose()
		}
		TaskHistoryStore.resetSharedStoresForTests()
		await fs.rm(storagePath, { recursive: true, force: true }).catch(() => {})
	})

	const openPanels = async () => {
		const one = makePanel(storagePath)
		const two = makePanel(storagePath)
		panels.push(one, two)
		const [storeOne, storeTwo] = await Promise.all([one.gateway.getStore(), two.gateway.getStore()])
		expect(storeOne).toBe(storeTwo)
		return { one, two }
	}

	it("a task created in one panel shows in the other panel's history at once", async () => {
		const { one, two } = await openPanels()

		await one.gateway.updateTaskHistory(item("task-1"))

		expect(one.messages("taskHistoryItemUpdated")).toHaveLength(1)
		await vi.waitFor(() => expect(two.messages("taskHistoryItemUpdated")).toHaveLength(1))
		expect(two.messages("taskHistoryItemUpdated")[0].taskHistoryItem?.id).toBe("task-1")
	})

	it("a pin and an unpin made in one panel reach the other panel, each exactly once", async () => {
		const { one, two } = await openPanels()
		await one.gateway.updateTaskHistory(item("task-1"), { broadcast: false })
		await vi.waitFor(() => expect(two.messages("taskHistoryItemUpdated")).toHaveLength(1))

		await one.gateway.setTaskPinned("task-1", true)
		await vi.waitFor(() => expect(two.messages("taskHistoryItemUpdated")).toHaveLength(2))
		const pinned = two.messages("taskHistoryItemUpdated")[1].taskHistoryItem
		expect(pinned?.pinnedAt).toEqual(expect.any(Number))

		await one.gateway.setTaskPinned("task-1", false)
		await vi.waitFor(() => expect(two.messages("taskHistoryItemUpdated")).toHaveLength(3))
		expect(two.messages("taskHistoryItemUpdated")[2].taskHistoryItem?.pinnedAt).toBeUndefined()

		// The panel that pinned got its own two pushes, never its own echo.
		expect(one.messages("taskHistoryItemUpdated")).toHaveLength(2)
	})

	it("a task deleted in one panel leaves the other panel's history", async () => {
		const { one, two } = await openPanels()
		await one.gateway.updateTaskHistory(item("task-1"), { broadcast: false })

		await one.gateway.deleteTaskFromState("task-1")

		await vi.waitFor(() =>
			expect(two.messages("taskHistoryItemDeleted")).toEqual([
				{ type: "taskHistoryItemDeleted", taskHistoryItemId: "task-1" },
			]),
		)
		expect(one.messages("taskHistoryItemDeleted")).toHaveLength(1)
	})
})
