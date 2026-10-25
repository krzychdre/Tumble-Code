import { renderHook, act } from "@/utils/test-utils"

import type { HistoryItem } from "@tumble-code/types"

import { useTaskSearch } from "../useTaskSearch"

const mockState = vi.hoisted(() => ({ fn: vi.fn() }))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: mockState.fn,
	useExtensionSelector: (selector: (s: never) => unknown) => selector(mockState.fn() as never),
}))

vi.mock("@/utils/highlight", () => ({
	highlightFzfMatch: vi.fn((text) => `<mark>${text}</mark>`),
}))

const mockUseExtensionState = mockState.fn as unknown as ReturnType<typeof vi.fn>

const mockTaskHistory: HistoryItem[] = [
	{
		id: "task-1",
		number: 1,
		task: "Create a React component",
		ts: new Date("2022-02-16T12:00:00").getTime(),
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.01,
		workspace: "/workspace/project1",
	},
	{
		id: "task-2",
		number: 2,
		task: "Write unit tests",
		ts: new Date("2022-02-17T12:00:00").getTime(),
		tokensIn: 200,
		tokensOut: 100,
		totalCost: 0.02,
		cacheWrites: 25,
		cacheReads: 10,
		workspace: "/workspace/project1",
	},
	{
		id: "task-3",
		number: 3,
		task: "Fix bug in authentication",
		ts: new Date("2022-02-15T12:00:00").getTime(),
		tokensIn: 150,
		tokensOut: 75,
		totalCost: 0.05,
		workspace: "/workspace/project2",
	},
]

describe("useTaskSearch", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockUseExtensionState.mockReturnValue({
			taskHistory: mockTaskHistory,
			cwd: "/workspace/project1",
		} as any)
	})

	it("lists the tasks of the current workspace, newest first", () => {
		const { result } = renderHook(() => useTaskSearch())

		expect(result.current.tasks.map((task) => task.id)).toEqual(["task-2", "task-1"])
	})

	it("keeps a subtask from another workspace (at any depth) when an ancestor is in this one", () => {
		const base = { number: 4, ts: 1, tokensIn: 0, tokensOut: 0, totalCost: 0 }
		mockUseExtensionState.mockReturnValue({
			taskHistory: [
				...mockTaskHistory,
				{ ...base, id: "sub", task: "subagent", parentTaskId: "task-1", workspace: "/tmp/worktree" },
				{ ...base, id: "grand", task: "grandchild", parentTaskId: "sub", workspace: undefined },
				{ ...base, id: "stranger", task: "child of project2", parentTaskId: "task-3", workspace: "/x" },
				{ ...base, id: "loop-a", task: "corrupt a", parentTaskId: "loop-b", workspace: "/x" },
				{ ...base, id: "loop-b", task: "corrupt b", parentTaskId: "loop-a", workspace: "/x" },
			],
			cwd: "/workspace/project1",
		} as any)

		const { result } = renderHook(() => useTaskSearch())

		expect(result.current.tasks.map((task) => task.id).sort()).toEqual(["grand", "sub", "task-1", "task-2"])
	})

	it("shows all workspaces when showAllWorkspaces is true", () => {
		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setShowAllWorkspaces(true)
		})

		expect(result.current.tasks).toHaveLength(3)
		expect(result.current.showAllWorkspaces).toBe(true)
	})

	// task-2: Feb 17, $0.02, 335 tokens with cache; task-1: Feb 16, $0.01, 150; task-3: Feb 15, $0.05, 225.
	it.each([
		{ sort: "newest" as const, ids: ["task-2", "task-1", "task-3"] },
		{ sort: "oldest" as const, ids: ["task-3", "task-1", "task-2"] },
		{ sort: "mostExpensive" as const, ids: ["task-3", "task-2", "task-1"] },
		{ sort: "mostTokens" as const, ids: ["task-2", "task-3", "task-1"] },
	])("sorts by $sort", ({ sort, ids }) => {
		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setShowAllWorkspaces(true)
			result.current.setSortOption(sort)
		})

		expect(result.current.tasks.map((task) => task.id)).toEqual(ids)
	})

	it("filters tasks by search query", () => {
		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setShowAllWorkspaces(true)
			result.current.setSearchQuery("React")
		})

		expect(result.current.tasks).toHaveLength(1)
		expect(result.current.tasks[0].id).toBe("task-1")
		expect((result.current.tasks[0] as any).highlight).toBe("<mark>Create a React component</mark>")
	})

	it("restores previous sort when clearing search", () => {
		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setSortOption("mostExpensive")
		})

		expect(result.current.sortOption).toBe("mostExpensive")

		// Clear lastNonRelevantSort to enable the auto-switch behavior
		act(() => {
			result.current.setLastNonRelevantSort(null)
		})

		act(() => {
			result.current.setSearchQuery("test")
		})

		expect(result.current.sortOption).toBe("mostRelevant")
		expect(result.current.lastNonRelevantSort).toBe("mostExpensive")

		act(() => {
			result.current.setSearchQuery("")
		})

		expect(result.current.sortOption).toBe("mostExpensive")
		expect(result.current.lastNonRelevantSort).toBe(null)
	})

	it("filters out tasks without timestamp or task content", () => {
		const incompleteTaskHistory = [
			...mockTaskHistory,
			{
				id: "incomplete-1",
				number: 4,
				task: "",
				ts: Date.now(),
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			},
			{
				id: "incomplete-2",
				number: 5,
				task: "Valid task",
				ts: 0,
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
			},
		] as HistoryItem[]

		mockUseExtensionState.mockReturnValue({
			taskHistory: incompleteTaskHistory,
			cwd: "/workspace/project1",
		} as any)

		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setShowAllWorkspaces(true)
		})

		// Should only include tasks with both ts and task content
		expect(result.current.tasks).toHaveLength(3)
		expect(result.current.tasks.every((task) => task.ts && task.task)).toBe(true)
	})

	it("handles search with no results", () => {
		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setShowAllWorkspaces(true)
			result.current.setSearchQuery("nonexistent")
		})

		expect(result.current.tasks).toHaveLength(0)
	})

	it("preserves search results order when using mostRelevant sort", () => {
		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setShowAllWorkspaces(true)
			result.current.setSearchQuery("test")
			result.current.setSortOption("mostRelevant")
		})

		// When searching, mostRelevant should preserve fzf order
		// When not searching, it should fall back to newest
		expect(result.current.sortOption).toBe("mostRelevant")
	})

	it("marks the rows of working tasks with their running status", () => {
		mockUseExtensionState.mockReturnValue({
			taskHistory: mockTaskHistory,
			cwd: "/workspace/project1",
			runningTasks: { "task-1": "running", "task-2": "awaiting_input" },
		} as any)

		const { result } = renderHook(() => useTaskSearch())

		expect(result.current.tasks.map((task) => [task.id, task.runningStatus])).toEqual([
			["task-2", "awaiting_input"],
			["task-1", "running"],
		])
	})

	it("leaves tasks at rest unmarked and unchanged", () => {
		mockUseExtensionState.mockReturnValue({
			taskHistory: mockTaskHistory,
			cwd: "/workspace/project1",
			runningTasks: { "task-2": "running" },
		} as any)

		const { result } = renderHook(() => useTaskSearch())

		const restingTask = result.current.tasks.find((task) => task.id === "task-1")
		expect(restingTask?.runningStatus).toBeUndefined()
		expect(restingTask).toBe(mockTaskHistory[0])
	})

	it("keeps the running status on search results", () => {
		mockUseExtensionState.mockReturnValue({
			taskHistory: mockTaskHistory,
			cwd: "/workspace/project1",
			runningTasks: { "task-2": "running" },
		} as any)

		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setSearchQuery("unit tests")
		})

		expect(result.current.tasks[0].id).toBe("task-2")
		expect(result.current.tasks[0].runningStatus).toBe("running")
		expect(result.current.tasks[0].highlight).toBeDefined()
	})

	describe("pinned and working tasks first", () => {
		// Three tasks of project1, newest first: b (17th), a (16th), c (15th).
		const history: HistoryItem[] = [
			{ ...mockTaskHistory[0], id: "a" },
			{ ...mockTaskHistory[1], id: "b" },
			{ ...mockTaskHistory[2], id: "c", workspace: "/workspace/project1" },
		]

		const idsWith = (runningTasks: Record<string, string>, configure?: (hook: any) => void) => {
			mockUseExtensionState.mockReturnValue({
				taskHistory: history,
				cwd: "/workspace/project1",
				runningTasks,
			} as any)
			const { result } = renderHook(() => useTaskSearch())
			if (configure) {
				act(() => configure(result.current))
			}
			return result.current.tasks.map((task) => task.id)
		}

		it("lists a working task first even when it is the oldest", () => {
			expect(idsWith({ c: "running" })).toEqual(["c", "b", "a"])
		})

		it("lists a task that waits for the user first too", () => {
			expect(idsWith({ a: "awaiting_input" })).toEqual(["a", "b", "c"])
		})

		it("keeps the sort order within the working and the resting tasks", () => {
			expect(idsWith({ c: "running", a: "running" })).toEqual(["a", "c", "b"])
			expect(idsWith({ c: "running", a: "running" }, (hook) => hook.setSortOption("oldest"))).toEqual([
				"c",
				"a",
				"b",
			])
		})

		it("lists the root of a working subtask first", () => {
			mockUseExtensionState.mockReturnValue({
				taskHistory: [...history, { ...mockTaskHistory[1], id: "sub", ts: 1, parentTaskId: "c" }],
				cwd: "/workspace/project1",
				runningTasks: { sub: "running" },
			} as any)
			const { result } = renderHook(() => useTaskSearch())
			expect(result.current.tasks.map((task) => task.id)).toEqual(["c", "sub", "b", "a"])
		})

		it("lists the pinned tasks above the working ones, most recently pinned first", () => {
			mockUseExtensionState.mockReturnValue({
				taskHistory: [
					{ ...history[0], pinnedAt: 10 },
					history[1],
					{ ...history[2], pinnedAt: 20 },
					{ ...mockTaskHistory[0], id: "d", ts: 1 },
				],
				cwd: "/workspace/project1",
				runningTasks: { d: "running", a: "running" },
			} as any)
			const { result } = renderHook(() => useTaskSearch())

			// c pinned last, a pinned first (and working, it keeps its pinned slot),
			// then the working d, then the resting b.
			expect(result.current.tasks.map((task) => [task.id, task.runningStatus])).toEqual([
				["c", undefined],
				["a", "running"],
				["d", "running"],
				["b", undefined],
			])
		})

		it("lists pinned tasks first while nothing works, and keeps the list otherwise", () => {
			mockUseExtensionState.mockReturnValue({
				taskHistory: [history[0], history[1], { ...history[2], pinnedAt: 1 }],
				cwd: "/workspace/project1",
			} as any)
			const { result } = renderHook(() => useTaskSearch())
			expect(result.current.tasks.map((task) => task.id)).toEqual(["c", "b", "a"])
		})

		it("keeps the relevance order of a search ranked by relevance", () => {
			// Both match "deploy"; the exact one ranks first although the other works.
			mockUseExtensionState.mockReturnValue({
				taskHistory: [
					{ ...mockTaskHistory[0], id: "exact", task: "deploy" },
					{ ...mockTaskHistory[1], id: "fuzzy", task: "d e p l o y later" },
				],
				cwd: "/workspace/project1",
				runningTasks: { fuzzy: "running" },
			} as any)
			const { result } = renderHook(() => useTaskSearch())
			// HistoryView switches to mostRelevant when the user starts to type.
			act(() => {
				result.current.setSearchQuery("deploy")
				result.current.setSortOption("mostRelevant")
			})
			expect(result.current.tasks.map((task) => task.id)).toEqual(["exact", "fuzzy"])

			act(() => {
				result.current.setSortOption("oldest")
			})
			expect(result.current.tasks.map((task) => task.id)).toEqual(["fuzzy", "exact"])
		})
	})

	describe("a working subtask", () => {
		// root -> child -> grandchild, plus an unrelated task-1 at rest.
		const tree: HistoryItem[] = [
			mockTaskHistory[0],
			{ ...mockTaskHistory[1], id: "root", number: 4 },
			{ ...mockTaskHistory[1], id: "child", number: 5, parentTaskId: "root", rootTaskId: "root" },
			{ ...mockTaskHistory[1], id: "grandchild", number: 6, parentTaskId: "child", rootTaskId: "root" },
		]

		const statusesWith = (runningTasks: Record<string, string>) => {
			mockUseExtensionState.mockReturnValue({
				taskHistory: tree,
				cwd: "/workspace/project1",
				runningTasks,
			} as any)
			const { result } = renderHook(() => useTaskSearch())
			return Object.fromEntries(result.current.tasks.map((task) => [task.id, task.runningStatus]))
		}

		it("marks every ancestor up to the root task as running", () => {
			expect(statusesWith({ grandchild: "running" })).toEqual({
				"task-1": undefined,
				root: "running",
				child: "running",
				grandchild: "running",
			})
		})

		it("shows on the ancestors that the subtask waits for the user", () => {
			expect(statusesWith({ grandchild: "awaiting_input" })).toMatchObject({
				root: "awaiting_input",
				child: "awaiting_input",
			})
		})

		it("lets a waiting subtask win over a running one on a shared ancestor", () => {
			const statuses = statusesWith({ child: "awaiting_input", grandchild: "running" })
			expect(statuses).toMatchObject({ root: "awaiting_input", child: "awaiting_input", grandchild: "running" })
		})

		it("stops at a parent cycle instead of looping", () => {
			mockUseExtensionState.mockReturnValue({
				taskHistory: [
					{ ...mockTaskHistory[0], id: "a", parentTaskId: "b" },
					{ ...mockTaskHistory[1], id: "b", parentTaskId: "a" },
				],
				cwd: "/workspace/project1",
				runningTasks: { a: "running" },
			} as any)
			const { result } = renderHook(() => useTaskSearch())
			expect(result.current.tasks.map((task) => [task.id, task.runningStatus])).toEqual([
				["b", "running"],
				["a", "running"],
			])
		})
	})

	describe("the usage of a task with subtasks", () => {
		// root (0.25) -> child (0.5) -> grandchild (1), the grandchild in another
		// workspace; plus an unrelated task-1 (0.01) without subtasks.
		const tree: HistoryItem[] = [
			mockTaskHistory[0],
			{ ...mockTaskHistory[1], id: "root", totalCost: 0.25 },
			{ ...mockTaskHistory[1], id: "child", totalCost: 0.5, parentTaskId: "root" },
			{
				...mockTaskHistory[1],
				id: "grandchild",
				totalCost: 1,
				parentTaskId: "child",
				workspace: "/workspace/project2",
			},
		]

		const subtreeCostsOf = (taskHistory: HistoryItem[]) => {
			mockUseExtensionState.mockReturnValue({ taskHistory, cwd: "/workspace/project1" } as any)
			const { result } = renderHook(() => useTaskSearch())
			return Object.fromEntries(result.current.tasks.map((task) => [task.id, task.subtree?.cost]))
		}

		it("sums every descendant, also one outside the current workspace", () => {
			expect(subtreeCostsOf(tree)).toEqual({ "task-1": undefined, root: 1.75, child: 1.5 })
		})

		it("sums the tokens of the tree too", () => {
			mockUseExtensionState.mockReturnValue({ taskHistory: tree, cwd: "/workspace/project1" } as any)
			const { result } = renderHook(() => useTaskSearch())
			const root = result.current.tasks.find((task) => task.id === "root")
			expect(root?.subtree).toEqual({ cost: 1.75, tokensIn: 600, tokensOut: 300 })
		})

		it("sorts by the cost of the whole tree for most expensive", () => {
			mockUseExtensionState.mockReturnValue({
				taskHistory: [...tree, { ...mockTaskHistory[0], id: "pricey", totalCost: 1.6 }],
				cwd: "/workspace/project1",
			} as any)
			const { result } = renderHook(() => useTaskSearch())
			act(() => result.current.setSortOption("mostExpensive"))
			// The grandchild of another workspace is listed under its root.
			expect(result.current.tasks.map((task) => task.id)).toEqual([
				"root",
				"pricey",
				"child",
				"grandchild",
				"task-1",
			])
		})

		it("counts each task once in a parent cycle", () => {
			const costs = subtreeCostsOf([
				{ ...mockTaskHistory[0], id: "a", totalCost: 1, parentTaskId: "b" },
				{ ...mockTaskHistory[1], id: "b", totalCost: 2, parentTaskId: "a" },
			])
			// History order: "a" is summed first and reaches "b", whose child is "a" again.
			expect(costs).toEqual({ a: 3, b: 2 })
		})
	})
})
