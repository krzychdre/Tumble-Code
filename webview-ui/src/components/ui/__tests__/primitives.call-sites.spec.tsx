// Characterization for UI plan §2.12 part c (one checkbox, one button with an
// `icon` variant, one icon button). The call sites below are the ones whose
// primitive is about to change and that no other spec renders with the real
// component: the Radix checkbox in the history row and in the worktree delete
// dialog, the toolbar icon button of the Mermaid actions and the icon
// appearance of ThemedButton in the code index form. The assertions go through
// roles, names, checked state, clicks and posted messages, so they hold for
// either implementation.

import React from "react"

import { fireEvent, render, screen } from "@/utils/test-utils"

import type { Worktree } from "@tumble-code/types"

import TaskItem from "@src/components/history/TaskItem"
import { DeleteWorktreeModal } from "@src/components/worktrees/DeleteWorktreeModal"
import { MermaidActionButtons } from "@src/components/common/MermaidActionButtons"
import { CodeIndexAdvancedFields } from "@src/components/code-index/CodeIndexAdvancedFields"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/utils/format", () => ({
	formatDateTime: () => "2026-05-22 17:50:33",
	formatLargeNumber: (num: number) => num.toString(),
}))

beforeEach(() => {
	vi.clearAllMocks()
})

describe("history row selection checkbox", () => {
	const item = {
		id: "task-1",
		number: 1,
		task: "Test task",
		ts: 1_700_000_000_000,
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.002,
		workspace: "/test/workspace",
	}

	it("shows the selection and reports a click once, without toggling through the row", () => {
		const onToggleSelection = vi.fn()
		render(
			<TaskItem
				item={item}
				variant="full"
				isSelected={true}
				onToggleSelection={onToggleSelection}
				isSelectionMode={true}
			/>,
		)

		const checkbox = screen.getByRole("checkbox")
		expect(checkbox).toBeChecked()

		fireEvent.click(checkbox)
		expect(onToggleSelection).toHaveBeenCalledTimes(1)
		expect(onToggleSelection).toHaveBeenCalledWith("task-1", false)
	})

	it("has no checkbox outside selection mode", () => {
		render(
			<TaskItem
				item={item}
				variant="full"
				isSelected={false}
				onToggleSelection={vi.fn()}
				isSelectionMode={false}
			/>,
		)
		expect(screen.queryByRole("checkbox")).toBeNull()
	})
})

describe("worktree delete dialog force checkbox", () => {
	const worktree: Worktree = {
		path: "/repo/.worktrees/feature",
		branch: "feature",
		commitHash: "abc123",
		isCurrent: false,
		isBare: false,
		isDetached: false,
		isLocked: true,
	}

	it("is named by its label, starts unchecked and decides worktreeForce", () => {
		render(<DeleteWorktreeModal open onClose={vi.fn()} worktree={worktree} />)

		const checkbox = screen.getByRole("checkbox", { name: /worktrees:forceDelete/ })
		expect(checkbox).not.toBeChecked()

		fireEvent.click(screen.getByRole("button", { name: "worktrees:delete" }))
		expect(vscode.postMessage).toHaveBeenLastCalledWith({
			type: "deleteWorktree",
			worktreePath: worktree.path,
			worktreeForce: false,
		})
	})

	it("forces the delete once ticked, also when the label text is clicked", () => {
		render(<DeleteWorktreeModal open onClose={vi.fn()} worktree={worktree} />)

		fireEvent.click(screen.getByText("worktrees:forceDelete"))
		const checkbox = screen.getByRole("checkbox", { name: /worktrees:forceDelete/ })
		expect(checkbox).toBeChecked()

		fireEvent.click(screen.getByRole("button", { name: "worktrees:delete" }))
		expect(vscode.postMessage).toHaveBeenLastCalledWith({
			type: "deleteWorktree",
			worktreePath: worktree.path,
			worktreeForce: true,
		})
	})

	it("has no checkbox for an unlocked worktree", () => {
		render(<DeleteWorktreeModal open onClose={vi.fn()} worktree={{ ...worktree, isLocked: false }} />)
		expect(screen.queryByRole("checkbox")).toBeNull()
	})
})

describe("Mermaid toolbar icon buttons", () => {
	it("renders one codicon button per action and routes the clicks", () => {
		const handlers = {
			onZoom: vi.fn(),
			onCopy: vi.fn(),
			onSave: vi.fn(),
			onViewCode: vi.fn(),
			onClose: vi.fn(),
		}
		render(<MermaidActionButtons {...handlers} copyFeedback={false} />)

		const buttons = screen.getAllByRole("button")
		const glyphs = buttons.map((b) => b.querySelector(".codicon")?.className.replace(/\s+/g, " ").trim())
		expect(glyphs).toEqual([
			"codicon codicon-zoom-in",
			"codicon codicon-code",
			"codicon codicon-copy",
			"codicon codicon-save",
			"codicon codicon-close",
		])

		buttons.forEach((b) => fireEvent.click(b))
		expect(handlers.onZoom).toHaveBeenCalledTimes(1)
		expect(handlers.onViewCode).toHaveBeenCalledTimes(1)
		expect(handlers.onCopy).toHaveBeenCalledTimes(1)
		expect(handlers.onSave).toHaveBeenCalledTimes(1)
		expect(handlers.onClose).toHaveBeenCalledTimes(1)
	})

	it("shows the check glyph while the copy feedback is on", () => {
		render(<MermaidActionButtons onCopy={vi.fn()} onViewCode={vi.fn()} copyFeedback={true} />)
		expect(document.querySelector(".codicon-check")?.closest("button")).not.toBeNull()
	})
})

describe("code index reset buttons (icon appearance)", () => {
	it("are two non-submit buttons with a reset title that restore the defaults", () => {
		const updateSetting = vi.fn()
		render(
			<form onSubmit={(e) => e.preventDefault()}>
				<CodeIndexAdvancedFields
					settings={{ codebaseIndexSearchMinScore: 0.9, codebaseIndexSearchMaxResults: 5 } as never}
					updateSetting={updateSetting as never}
				/>
			</form>,
		)

		const resets = screen.getAllByTitle("settings:codeIndex.resetToDefault")
		expect(resets).toHaveLength(2)
		for (const reset of resets) {
			expect(reset.tagName).toBe("BUTTON")
			expect(reset.getAttribute("type")).toBe("button")
			expect(reset.querySelector(".codicon-discard")).not.toBeNull()
		}

		fireEvent.click(resets[0])
		fireEvent.click(resets[1])
		expect(updateSetting.mock.calls.map(([key]) => key)).toEqual([
			"codebaseIndexSearchMinScore",
			"codebaseIndexSearchMaxResults",
		])
	})
})
