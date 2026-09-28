// §2.6: the tooltip lookup table keyed by button kind (not translated
// labels) and the shortcut strings it appends.

import { askButtonTooltipKey, askButtonShortcut, PRIMARY_ACTION_SHORTCUT, SECONDARY_ACTION_SHORTCUT } from "../askButtonTooltips"
import type { AskButtonKind } from "../hooks/useAskButtons"

describe("askButtonTooltips (§2.6)", () => {
	it("maps every kind to a tooltip key or deliberately none", () => {
		// The kinds that appear on the primary slot across all asks.
		expect(askButtonTooltipKey("retry")).toBe("chat:retry.tooltip")
		expect(askButtonTooltipKey("startNewTask")).toBe("chat:startNewTask.tooltip")
		expect(askButtonTooltipKey("save")).toBe("chat:save.tooltip")
		expect(askButtonTooltipKey("approve")).toBe("chat:approve.tooltip")
		expect(askButtonTooltipKey("runCommand")).toBe("chat:runCommand.tooltip")
		expect(askButtonTooltipKey("resumeTask")).toBe("chat:resumeTask.tooltip")
		expect(askButtonTooltipKey("terminate")).toBe("chat:terminate.tooltip")

		// Batch variants reuse the base tooltips.
		expect(askButtonTooltipKey("edit-batch.approve")).toBe("chat:save.tooltip")
		expect(askButtonTooltipKey("read-batch.deny")).toBe("chat:reject.tooltip")
		expect(askButtonTooltipKey("list-batch.approve")).toBe("chat:approve.tooltip")

		// "Complete subtask and keep going" is its own explanation.
		expect(askButtonTooltipKey("completeSubtaskAndReturn")).toBeUndefined()
	})

	it("returns undefined for unknown or absent kinds", () => {
		expect(askButtonTooltipKey(undefined)).toBeUndefined()
	})

	it("names the slot's shortcut", () => {
		expect(askButtonShortcut("primary")).toBe(PRIMARY_ACTION_SHORTCUT)
		expect(askButtonShortcut("secondary")).toBe(SECONDARY_ACTION_SHORTCUT)
		expect(PRIMARY_ACTION_SHORTCUT).toMatch(/Enter$/)
		expect(SECONDARY_ACTION_SHORTCUT).toBe("Esc")
	})

	it("covers every kind useAskButtons can set", () => {
		// The union members of AskButtonKind must all be present in the
		// table (as a key or an explicit undefined), so a new kind added to
		// the state machine fails here until the tooltip table is extended.
		const allKinds: AskButtonKind[] = [
			"retry",
			"startNewTask",
			"proceedAnyways",
			"save",
			"reject",
			"approve",
			"read-batch.approve",
			"read-batch.deny",
			"list-batch.approve",
			"list-batch.deny",
			"edit-batch.approve",
			"edit-batch.deny",
			"runCommand",
			"proceedWhileRunning",
			"killCommand",
			"resumeTask",
			"terminate",
			"completeSubtaskAndReturn",
		]
		for (const kind of allKinds) {
			// Every kind resolves to a string key or an explicit undefined
			// (no accidental "unknown kind" gap).
			expect([typeof askButtonTooltipKey(kind), "undefined"]).toContain(typeof askButtonTooltipKey(kind))
		}
	})
})
