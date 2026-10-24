// pnpm --filter tumble-code test core/webview/__tests__/aggregateTaskCosts.spec.ts

import type { HistoryItem } from "@tumble-code/types"

import { aggregateTaskCostsRecursive } from "../aggregateTaskCosts"
import { logger } from "../../../utils/logging"

type Node = Pick<HistoryItem, "totalCost" | "childIds" | "parallelChildIds">

/** Aggregates `rootId` over a history of `{ id: fields }`. */
const aggregate = (rootId: string, nodes: Record<string, Partial<Node>>) =>
	aggregateTaskCostsRecursive(rootId, async (id) =>
		nodes[id] ? ({ id, ...nodes[id] } as unknown as HistoryItem) : undefined,
	)

describe("aggregateTaskCostsRecursive", () => {
	let warn: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		warn = vi.spyOn(logger, "warn").mockImplementation(() => {})
	})

	it.each([
		["with an empty child list", { totalCost: 1.5, childIds: [] }, 1.5],
		["without a child list", { totalCost: 2 }, 2],
		["without a cost", { childIds: [] }, 0],
	])("a task %s costs its own cost", async (_name, node, cost) => {
		expect(await aggregate("task", { task: node })).toEqual({
			ownCost: cost,
			childrenCost: 0,
			totalCost: cost,
			childBreakdown: {},
		})
	})

	it("sums children and grandchildren and keeps a breakdown per child", async () => {
		const result = await aggregate("parent", {
			parent: { totalCost: 1, childIds: ["child", "other"] },
			child: { totalCost: 0.5, childIds: ["grandchild"] },
			other: { totalCost: 0.75 },
			grandchild: { totalCost: 0.25 },
		})

		expect(result).toMatchObject({ ownCost: 1, childrenCost: 1.5, totalCost: 2.5 })
		expect(result.childBreakdown!.child).toMatchObject({ ownCost: 0.5, childrenCost: 0.25, totalCost: 0.75 })
		expect(result.childBreakdown!.child.childBreakdown!.grandchild.totalCost).toBe(0.25)
	})

	it("counts a child shared by two siblings under each of them", async () => {
		const result = await aggregate("parent", {
			parent: { totalCost: 1, childIds: ["sibling-1", "sibling-2"] },
			"sibling-1": { totalCost: 0.5, childIds: ["nephew"] },
			"sibling-2": { totalCost: 0.25, childIds: ["nephew"] },
			nephew: { totalCost: 0.125 },
		})

		expect(result.totalCost).toBe(2)
	})

	it("includes parallel subagents recursively and counts a child named in both lists once", async () => {
		const result = await aggregate("parent", {
			parent: { totalCost: 1, childIds: ["delegated"], parallelChildIds: ["sub-1", "delegated"] },
			delegated: { totalCost: 0.5, parallelChildIds: ["sub-2"] },
			"sub-1": { totalCost: 0.25 },
			"sub-2": { totalCost: 0.125 },
		})

		expect(result).toMatchObject({ childrenCost: 0.875, totalCost: 1.875 })
		expect(Object.keys(result.childBreakdown!)).toEqual(["delegated", "sub-1"])
		expect(result.childBreakdown!.delegated.childBreakdown!["sub-2"].totalCost).toBe(0.125)
	})

	it("stops at a cycle and says so", async () => {
		const result = await aggregate("task-a", {
			"task-a": { totalCost: 1, childIds: ["task-b"] },
			"task-b": { totalCost: 0.5, childIds: ["task-a"] },
		})

		expect(result.totalCost).toBe(1.5)
		expect(warn).toHaveBeenCalledWith("[aggregateTaskCostsRecursive] Circular reference detected: task-a")
	})

	it("counts a missing task as zero and says so", async () => {
		const result = await aggregate("parent", { parent: { totalCost: 1, childIds: ["gone"] } })

		expect(result).toMatchObject({ childrenCost: 0, totalCost: 1 })
		expect(warn).toHaveBeenCalledWith("[aggregateTaskCostsRecursive] Task gone not found")
		expect(await aggregate("gone", {})).toEqual({ ownCost: 0, childrenCost: 0, totalCost: 0 })
	})
})
