import { renderHook, act } from "@/utils/test-utils"

import type { HistoryItem } from "@tumble-code/types"

import { useGroupedTasks, buildSubtree, toDayRows } from "../useGroupedTasks"
import { countAllSubtasks, type SubtaskTreeNode } from "../types"

const createMockTask = (overrides: Partial<HistoryItem> = {}): HistoryItem => ({
	id: "task-1",
	number: 1,
	task: "Test task",
	ts: Date.now(),
	tokensIn: 100,
	tokensOut: 50,
	totalCost: 0.01,
	workspace: "/workspace/project",
	...overrides,
})

const task = (id: string, ts: number, parentTaskId?: string) => createMockTask({ id, ts, parentTaskId })

/** root (ts 100) > child-a (110) > grandchild (115), root > child-b (120), orphan (130, parent not listed), solo (90). */
const tree = [
	task("root", 100),
	task("child-a", 110, "root"),
	task("grandchild", 115, "child-a"),
	task("child-b", 120, "root"),
	task("orphan", 130, "missing-parent"),
	task("solo", 90),
]

const ids = (nodes: SubtaskTreeNode[]): unknown[] =>
	nodes.map((node) => (node.children.length ? [node.item.id, ids(node.children)] : node.item.id))

describe("useGroupedTasks", () => {
	it("groups by parent: newest root first, children newest first, an orphan promoted to a root", () => {
		const { result } = renderHook(() => useGroupedTasks(tree, ""))

		expect(result.current.isSearchMode).toBe(false)
		expect(result.current.flatTasks).toBeNull()
		expect(result.current.groups.map((g) => g.parent.id)).toEqual(["orphan", "root", "solo"])
		expect(ids(result.current.groups[1].subtasks)).toEqual(["child-b", ["child-a", ["grandchild"]]])
		expect(result.current.groups.every((g) => !g.isExpanded)).toBe(true)
	})

	it("returns no groups for no tasks", () => {
		expect(renderHook(() => useGroupedTasks([], "")).result.current.groups).toEqual([])
	})

	it("toggles groups and nested nodes independently and keeps the state when the tasks change", () => {
		const { result, rerender } = renderHook(({ tasks }) => useGroupedTasks(tasks, ""), {
			initialProps: { tasks: tree },
		})

		act(() => result.current.toggleExpand("root"))
		act(() => result.current.toggleExpand("child-a"))
		act(() => result.current.toggleExpand("solo"))
		act(() => result.current.toggleExpand("solo"))
		rerender({ tasks: [...tree, task("new", 200)] })

		const root = result.current.groups.find((g) => g.parent.id === "root")!
		expect(root.isExpanded).toBe(true)
		expect(root.subtasks.find((n) => n.item.id === "child-a")!.isExpanded).toBe(true)
		expect(result.current.groups.find((g) => g.parent.id === "solo")!.isExpanded).toBe(false)
		expect(result.current.groups[0].parent.id).toBe("new")
	})

	it("search mode: a flat list in the given order, subtasks marked only when their parent is listed", () => {
		const { result } = renderHook(() => useGroupedTasks(tree, "task"))

		expect(result.current.isSearchMode).toBe(true)
		expect(result.current.groups).toEqual([])
		expect(result.current.flatTasks?.map((t) => [t.id, t.isSubtask])).toEqual([
			["root", false],
			["child-a", true],
			["grandchild", true],
			["child-b", true],
			["orphan", false],
			["solo", false],
		])
	})

	it("a whitespace-only query is no search", () => {
		expect(renderHook(() => useGroupedTasks(tree, "   ")).result.current.isSearchMode).toBe(false)
	})

	it("passes the running status through to groups, subtasks and search results", () => {
		const tasks = [
			{ ...task("parent", 1), runningStatus: "awaiting_input" as const },
			{ ...task("child", 2, "parent"), runningStatus: "running" as const },
		]

		const grouped = renderHook(() => useGroupedTasks(tasks, "")).result.current
		expect(grouped.groups[0].parent.runningStatus).toBe("awaiting_input")
		expect(grouped.groups[0].subtasks[0].item.runningStatus).toBe("running")

		const searched = renderHook(() => useGroupedTasks(tasks, "x")).result.current
		expect(searched.flatTasks?.map((t) => t.runningStatus)).toEqual(["awaiting_input", "running"])
	})

	it("sorts pinned groups first (most recently pinned first), then working trees, then by time", () => {
		const tasks = [
			createMockTask({ id: "newest", ts: 300 }),
			createMockTask({ id: "pinned-old", ts: 10, pinnedAt: 1 }),
			{ ...createMockTask({ id: "working", ts: 30 }), runningStatus: "running" as const },
			{ ...createMockTask({ id: "waiting", ts: 20 }), runningStatus: "awaiting_input" as const },
			{ ...createMockTask({ id: "pinned-working", ts: 20, pinnedAt: 2 }), runningStatus: "running" as const },
			createMockTask({ id: "middle", ts: 200 }),
		]

		const { result } = renderHook(() => useGroupedTasks(tasks, ""))

		expect(result.current.groups.map((g) => g.parent.id)).toEqual([
			"pinned-working",
			"pinned-old",
			"working",
			"waiting",
			"newest",
			"middle",
		])
	})
})

describe("buildSubtree", () => {
	it("builds the nested tree newest first with the expanded flags, without touching the input lists", () => {
		const children = [task("a", 1, "root"), task("b", 2, "root")]
		const childrenMap = new Map([
			["root", children],
			["a", [task("a1", 3, "a")]],
		])

		const node = buildSubtree(task("root", 0), childrenMap, new Set(["a"]))

		expect(ids([node])).toEqual([["root", ["b", ["a", ["a1"]]]]])
		expect(node.isExpanded).toBe(false)
		expect(node.children[1].isExpanded).toBe(true)
		expect(children.map((c) => c.id)).toEqual(["a", "b"])
	})
})

describe("countAllSubtasks", () => {
	it("counts every node at every level", () => {
		const leaf = (id: string): SubtaskTreeNode => ({ item: task(id, 0) as never, children: [], isExpanded: false })

		expect(countAllSubtasks([])).toBe(0)
		expect(countAllSubtasks([{ ...leaf("a"), children: [leaf("a1"), leaf("a2")] }, leaf("b")])).toBe(4)
	})
})

describe("toDayRows", () => {
	const t = (key: string) => key
	const noon = new Date().setHours(12, 0, 0, 0)
	const DAY = 86400000
	const group = (id: string, ts: number, runningStatus?: "running" | "awaiting_input", pinnedAt?: number) => ({
		parent: { ...createMockTask({ id, ts, pinnedAt }), runningStatus },
		subtasks: [],
		isExpanded: false,
	})

	it("puts the working groups under one section header above the day headers", () => {
		const rows = toDayRows(
			[
				group("old-working", noon - 3 * DAY, "running"),
				group("waiting", noon, "awaiting_input"),
				group("today", noon - 1000),
				group("yesterday", noon - DAY),
			],
			t,
		)

		expect(rows.map((row) => (row.type === "group" ? row.group.parent.id : row.label))).toEqual([
			"history:section.active",
			"old-working",
			"waiting",
			"history:today",
			"today",
			"history:yesterday",
			"yesterday",
		])
		expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
	})

	it("puts the pinned groups under their own header first, a working one included", () => {
		const rows = toDayRows(
			[
				group("pinned-working", noon - 5 * DAY, "running", 2),
				group("pinned", noon - 9 * DAY, undefined, 1),
				group("working", noon, "running"),
				group("today", noon - 1000),
			],
			t,
		)

		expect(rows.map((row) => (row.type === "group" ? row.group.parent.id : row.label))).toEqual([
			"history:section.pinned",
			"pinned-working",
			"pinned",
			"history:section.active",
			"working",
			"history:today",
			"today",
		])
	})

	it("adds no section header when nothing works", () => {
		const rows = toDayRows([group("today", noon)], t)
		expect(rows.map((row) => row.type)).toEqual(["day-header", "group"])
	})
})
