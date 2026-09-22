import * as path from "path"

import { describe, expect, it, vi, beforeEach } from "vitest"

import { pauseForPlanReviewIfNeeded } from "../planReviewPause"
import { PlanReviewPanel } from "../../webview/PlanReviewPanel"

vi.mock("vscode", () => ({
	window: { showErrorMessage: vi.fn() },
	workspace: { workspaceFolders: undefined },
	env: { language: "en" },
}))

vi.mock("../../webview/PlanReviewPanel", () => ({
	PlanReviewPanel: {
		open: vi.fn().mockResolvedValue(undefined),
		seedBaseline: vi.fn(),
		closeForFile: vi.fn(),
		consumeDraftNotes: vi.fn().mockReturnValue(undefined),
	},
}))

vi.mock("../../webview/planReviewRegistry", () => ({
	isPlanReviewFileOpen: vi.fn().mockReturnValue(false),
}))

const mockPanel = vi.mocked(PlanReviewPanel)

// The product resolves the plan path with `path.resolve(task.cwd, relPath)`,
// so the expected absolute path is built the same way (drive letter and
// backslashes on Windows).
const PLAN_ABS = path.resolve("/ws", "plans/plan.md")

interface TaskOverrides {
	ask?: ReturnType<typeof vi.fn>
	diffViewProvider?: unknown
	isBackground?: boolean
	state?: Record<string, unknown>
}

function makeTask(overrides: TaskOverrides = {}) {
	const state = { alwaysApprovePlan: false, autoApprovalMode: "semi", ...overrides.state }
	const provider = {
		getState: vi.fn().mockResolvedValue(state),
		context: {},
		log: vi.fn(),
	}
	return {
		cwd: "/ws",
		isBackground: overrides.isBackground ?? false,
		providerRef: { deref: () => provider },
		diffViewProvider:
			"diffViewProvider" in overrides
				? overrides.diffViewProvider
				: { lastSavedRelPath: "plans/plan.md", originalContent: "old plan content" },
		ask: overrides.ask ?? vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		say: vi.fn().mockResolvedValue(undefined),
	} as never
}

describe("pauseForPlanReviewIfNeeded", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("skips non-plan files", async () => {
		const task = makeTask()
		const result = await pauseForPlanReviewIfNeeded(task, "src/index.ts")
		expect(result).toBeUndefined()
		expect(mockPanel.open).not.toHaveBeenCalled()
	})

	it("skips when alwaysApprovePlan is on", async () => {
		const task = makeTask({ state: { alwaysApprovePlan: true } })
		const result = await pauseForPlanReviewIfNeeded(task, "plans/plan.md")
		expect(result).toBeUndefined()
	})

	it("skips background tasks", async () => {
		const task = makeTask({ isBackground: true })
		const result = await pauseForPlanReviewIfNeeded(task, "plans/plan.md")
		expect(result).toBeUndefined()
	})

	it("seeds the diff baseline from the pre-write content of the saved file", async () => {
		const task = makeTask()
		await pauseForPlanReviewIfNeeded(task, "plans/plan.md")
		expect(mockPanel.seedBaseline).toHaveBeenCalledWith(PLAN_ABS, "old plan content")
	})

	it("does not seed the baseline from another file's edit", async () => {
		const task = makeTask({
			diffViewProvider: { lastSavedRelPath: "src/other.ts", originalContent: "unrelated" },
		})
		await pauseForPlanReviewIfNeeded(task, "plans/plan.md")
		expect(mockPanel.seedBaseline).not.toHaveBeenCalled()
	})

	it("closes the panel after Approve and reports approval", async () => {
		const task = makeTask()
		const result = await pauseForPlanReviewIfNeeded(task, "plans/plan.md")
		expect(result).toContain("approved")
		expect(mockPanel.closeForFile).toHaveBeenCalledWith(PLAN_ABS)
	})

	it("closes the panel after a plain reject", async () => {
		const task = makeTask({ ask: vi.fn().mockResolvedValue({ response: "noButtonClicked" }) })
		const result = await pauseForPlanReviewIfNeeded(task, "plans/plan.md")
		expect(result).toContain("rejected")
		expect(mockPanel.closeForFile).toHaveBeenCalledWith(PLAN_ABS)
	})

	it("closes the panel after feedback text and relays it", async () => {
		const task = makeTask({
			ask: vi.fn().mockResolvedValue({ response: "messageResponse", text: "add rollout step" }),
		})
		const result = await pauseForPlanReviewIfNeeded(task, "plans/plan.md")
		expect(result).toContain("add rollout step")
		expect(mockPanel.closeForFile).toHaveBeenCalledWith(PLAN_ABS)
	})

	it("delivers draft notes on Approve and still closes the panel", async () => {
		mockPanel.consumeDraftNotes.mockReturnValueOnce("note about step 2")
		const task = makeTask()
		const result = await pauseForPlanReviewIfNeeded(task, "plans/plan.md")
		expect(result).toContain("note about step 2")
		expect(mockPanel.closeForFile).toHaveBeenCalledWith(PLAN_ABS)
	})
})
