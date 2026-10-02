// npx vitest run core/task/__tests__/TaskLifecycle.too-many-tools.spec.ts

import { describe, it, expect, vi } from "vitest"

import { TOO_MANY_TOOLS_DISMISSAL_ID, MAX_MCP_TOOLS_THRESHOLD } from "@tumble-code/types"

import { TaskLifecycle, type TaskLifecycleAccess } from "../TaskLifecycle"

// startTask warns once when MCP tools exceed the threshold. A "don't show again"
// click (kept in dismissedUpsells) mutes the warning until the count has been
// under the threshold once, which clears the dismissal.
async function runStartTask(toolCount: number, dismissedUpsells: string[]) {
	const say = vi.fn().mockResolvedValue(undefined)
	const setValue = vi.fn().mockResolvedValue(undefined)
	const provider = {
		getValue: (key: string) => (key === "dismissedUpsells" ? dismissedUpsells : undefined),
		setValue,
		getState: async () => ({ experiments: {} }),
		postStateToWebviewWithoutTaskHistory: vi.fn().mockResolvedValue(undefined),
	}
	const access = {
		clineMessages: [],
		apiConversationHistory: [],
		providerRef: { deref: () => provider },
		askSay: { say },
		contextManager: {
			getEnabledMcpToolsCount: async () => ({ enabledToolCount: toolCount, enabledServerCount: 3 }),
		},
		initiateTaskLoop: vi.fn().mockResolvedValue(undefined),
	} as unknown as TaskLifecycleAccess

	await new TaskLifecycle(access).startTask("hi")
	const warnings = say.mock.calls.filter((c) => c[0] === "too_many_tools_warning")
	return { warnings, setValue }
}

describe("TaskLifecycle.startTask too many tools warning", () => {
	const over = MAX_MCP_TOOLS_THRESHOLD + 1

	it("warns when over the threshold and not dismissed", async () => {
		const { warnings } = await runStartTask(over, [])
		expect(warnings).toHaveLength(1)
	})

	it("stays silent while dismissed and still over the threshold", async () => {
		const { warnings, setValue } = await runStartTask(over, [TOO_MANY_TOOLS_DISMISSAL_ID, "other"])
		expect(warnings).toHaveLength(0)
		expect(setValue).not.toHaveBeenCalled()
	})

	it("forgets the dismissal once the count is under the threshold", async () => {
		const { warnings, setValue } = await runStartTask(MAX_MCP_TOOLS_THRESHOLD, [
			TOO_MANY_TOOLS_DISMISSAL_ID,
			"other",
		])
		expect(warnings).toHaveLength(0)
		expect(setValue).toHaveBeenCalledWith("dismissedUpsells", ["other"])
	})
})
