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

	it("returns all tasks by default", () => {
		const { result } = renderHook(() => useTaskSearch())

		expect(result.current.tasks).toHaveLength(2) // Only tasks from current workspace
		expect(result.current.tasks[0].id).toBe("task-2") // Newest first
		expect(result.current.tasks[1].id).toBe("task-1")
	})

	it("filters tasks by current workspace by default", () => {
		const { result } = renderHook(() => useTaskSearch())

		expect(result.current.tasks).toHaveLength(2)
		expect(result.current.tasks.every((task) => task.workspace === "/workspace/project1")).toBe(true)
	})

	it("shows all workspaces when showAllWorkspaces is true", () => {
		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setShowAllWorkspaces(true)
		})

		expect(result.current.tasks).toHaveLength(3)
		expect(result.current.showAllWorkspaces).toBe(true)
	})

	it("sorts by newest by default", () => {
		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setShowAllWorkspaces(true)
		})

		expect(result.current.sortOption).toBe("newest")
		expect(result.current.tasks[0].id).toBe("task-2") // Feb 17
		expect(result.current.tasks[1].id).toBe("task-1") // Feb 16
		expect(result.current.tasks[2].id).toBe("task-3") // Feb 15
	})

	it("sorts by oldest", () => {
		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setShowAllWorkspaces(true)
			result.current.setSortOption("oldest")
		})

		expect(result.current.tasks[0].id).toBe("task-3") // Feb 15
		expect(result.current.tasks[1].id).toBe("task-1") // Feb 16
		expect(result.current.tasks[2].id).toBe("task-2") // Feb 17
	})

	it("sorts by most expensive", () => {
		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setShowAllWorkspaces(true)
			result.current.setSortOption("mostExpensive")
		})

		expect(result.current.tasks[0].id).toBe("task-3") // $0.05
		expect(result.current.tasks[1].id).toBe("task-2") // $0.02
		expect(result.current.tasks[2].id).toBe("task-1") // $0.01
	})

	it("sorts by most tokens", () => {
		const { result } = renderHook(() => useTaskSearch())

		act(() => {
			result.current.setShowAllWorkspaces(true)
			result.current.setSortOption("mostTokens")
		})

		// task-2: 200 + 100 + 25 + 10 = 335 tokens
		// task-3: 150 + 75 = 225 tokens
		// task-1: 100 + 50 = 150 tokens
		expect(result.current.tasks[0].id).toBe("task-2")
		expect(result.current.tasks[1].id).toBe("task-3")
		expect(result.current.tasks[2].id).toBe("task-1")
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

	it("automatically switches to mostRelevant when searching", () => {
		const { result } = renderHook(() => useTaskSearch())

		// Initially lastNonRelevantSort should be "newest" (the default)
		expect(result.current.lastNonRelevantSort).toBe("newest")

		act(() => {
			result.current.setSortOption("oldest")
		})

		expect(result.current.sortOption).toBe("oldest")

		// Clear lastNonRelevantSort to test the auto-switch behavior
		act(() => {
			result.current.setLastNonRelevantSort(null)
		})

		act(() => {
			result.current.setSearchQuery("test")
		})

		// The hook should automatically switch to mostRelevant when there's a search query
		// and the current sort is not mostRelevant and lastNonRelevantSort is null
		expect(result.current.sortOption).toBe("mostRelevant")
		expect(result.current.lastNonRelevantSort).toBe("oldest")
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

	it("handles empty task history", () => {
		mockUseExtensionState.mockReturnValue({
			taskHistory: [],
			cwd: "/workspace/project1",
		} as any)

		const { result } = renderHook(() => useTaskSearch())

		expect(result.current.tasks).toHaveLength(0)
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
			expect(result.current.tasks.map((task) => task.id)).toEqual(["root", "pricey", "child", "task-1"])
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
