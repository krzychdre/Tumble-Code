import React from "react"
import { describe, expect, it, vi, beforeAll, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@/utils/test-utils"

import { PlanReviewSurface } from "../PlanReviewSurface"

// Mock MarkdownBlock to just render text — avoids complex markdown rendering in jsdom.
vi.mock("../../common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown?: string }) => <div data-testid="markdown-block">{markdown}</div>,
}))

// Mock the i18n translation to return predictable English strings.
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: Record<string, unknown>) => {
			const map: Record<string, string> = {
				"chat:planReview.title": "Review plan",
				"chat:planReview.addNote": "Add note",
				"chat:planReview.notePlaceholder": "Write your note…",
				"chat:planReview.send": "Send notes",
				"chat:planReview.cancel": "Cancel",
				"chat:planReview.emptyState": "Select text in the plan to add a note.",
				"chat:planReview.notesCount": `Notes: ${options?.count ?? 0}`,
				"chat:planReview.editNote": "Edit note",
				"chat:planReview.deleteNote": "Delete note",
				"chat:planReview.save": "Save",
				"chat:planReview.annotateTooltip": "Review & annotate",
				"chat:planReview.changesHighlighted": "Changes since last review",
				"chat:planReview.removedContent": "Removed since last review",
			}
			return map[key] ?? key
		},
	}),
}))

// jsdom has no layout, so a selection range has no size; give it one, like a real selection.
beforeAll(() => {
	Range.prototype.getBoundingClientRect = () => new DOMRect(10, 10, 50, 12)
})

/** Selects `quote` in the rendered plan, clicks the "Add note" chip, types `note` and saves it. */
const addNote = async (quote: string, note: string) => {
	const block = screen.getAllByTestId("markdown-block").find((b) => b.textContent!.includes(quote))!
	const text = block.firstChild as Text
	const start = text.data.indexOf(quote)
	const range = document.createRange()
	range.setStart(text, start)
	range.setEnd(text, start + quote.length)
	const selection = window.getSelection()!
	selection.removeAllRanges()
	selection.addRange(range)
	fireEvent.mouseUp(block)

	fireEvent.click(await screen.findByText("Add note"))
	fireEvent.change(screen.getByPlaceholderText("Write your note…"), { target: { value: note } })
	fireEvent.click(screen.getByRole("button", { name: "Save" }))
}

const addTwoNotes = async () => {
	await addNote("Plan Title", "Rename this section")
	await addNote("substantial plan", "Add a rollout step")
}

describe("PlanReviewSurface", () => {
	const defaultProps = {
		markdown: "# Plan Title\n\nThis is a substantial plan with enough content to be reviewed carefully.",
		onClose: vi.fn(),
		onSubmit: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the plan markdown", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		expect(screen.getByTestId("markdown-block")).toBeInTheDocument()
		expect(screen.getByTestId("markdown-block")).toHaveTextContent("Plan Title")
	})

	it("renders the title in header", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		expect(screen.getByText("Review plan")).toBeInTheDocument()
	})

	it("shows empty state when no annotations", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		expect(screen.getAllByText("Select text in the plan to add a note.").length).toBeGreaterThan(0)
	})

	it("send and cancel buttons are always visible; send disabled with no notes", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		const sendButton = screen.getByText("Send notes")
		expect(sendButton).toBeVisible()
		expect(sendButton.closest("button")).toBeDisabled()
		const cancelButtons = screen.getAllByText("Cancel").filter((el) => el.tagName === "BUTTON")
		expect(cancelButtons.length).toBeGreaterThan(0)
		expect(cancelButtons[0]).toBeVisible()
	})

	it("a note added on a selection is listed with its quote and enables send", async () => {
		render(<PlanReviewSurface {...defaultProps} />)
		await addTwoNotes()
		expect(screen.getByText("Rename this section")).toBeInTheDocument()
		expect(screen.getByText("substantial plan", { selector: "blockquote" })).toBeInTheDocument()
		const sendButton = screen.getByText("Send notes (2)")
		expect(sendButton.closest("button")).not.toBeDisabled()
		expect(screen.getByText("Notes: 2")).toBeInTheDocument()
	})

	it("an empty note is not added", async () => {
		render(<PlanReviewSurface {...defaultProps} />)
		await addNote("Plan Title", "   ")
		expect(screen.queryByPlaceholderText("Write your note…")).not.toBeInTheDocument()
		expect(screen.getByText("Send notes").closest("button")).toBeDisabled()
	})

	it("edits and deletes a listed note", async () => {
		render(<PlanReviewSurface {...defaultProps} />)
		await addTwoNotes()

		fireEvent.click(screen.getAllByLabelText("Edit note")[0])
		const list = screen.getByText("Plan Title", { selector: "blockquote" }).parentElement!
		fireEvent.change(within(list).getByRole("textbox"), { target: { value: "Call it Overview" } })
		fireEvent.click(within(list).getByRole("button", { name: "Save" }))
		expect(screen.getByText("Call it Overview")).toBeInTheDocument()
		expect(screen.queryByText("Rename this section")).not.toBeInTheDocument()

		fireEvent.click(screen.getAllByLabelText("Delete note")[1])
		expect(screen.queryByText("Add a rollout step")).not.toBeInTheDocument()
		expect(screen.getByText("Send notes (1)")).toBeInTheDocument()
	})

	it("clicking send compiles the notes and calls onSubmit", async () => {
		render(<PlanReviewSurface {...defaultProps} filePath="plans/plan.md" />)
		await addTwoNotes()
		fireEvent.click(screen.getByText("Send notes (2)"))
		expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1)
		const compiled = defaultProps.onSubmit.mock.calls[0][0] as string
		expect(compiled).toContain("> Plan Title")
		expect(compiled).toContain("Note: Rename this section")
		expect(compiled).toContain("Note: Add a rollout step")
		expect(compiled).toContain("plans/plan.md")
		expect(compiled).toContain("Please address these notes and update the plan.")
	})

	it("clears drafts after sending (panel stays open for the next review round)", async () => {
		render(<PlanReviewSurface {...defaultProps} />)
		await addTwoNotes()
		fireEvent.click(screen.getByText("Send notes (2)"))
		expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1)
		// Send is disabled again until new notes are added.
		expect(screen.getByText("Send notes").closest("button")).toBeDisabled()
	})

	it("reports drafts via onDraftsChanged and clears them on resetSignal bump", async () => {
		const onDraftsChanged = vi.fn()
		const { rerender } = render(
			<PlanReviewSurface {...defaultProps} onDraftsChanged={onDraftsChanged} resetSignal={0} />,
		)
		await addTwoNotes()
		const [compiled, count] = onDraftsChanged.mock.calls.at(-1)!
		expect(count).toBe(2)
		expect(compiled).toContain("Note: Rename this section")

		// Host consumed the drafts (user clicked Approve) → resetSignal bump clears.
		rerender(<PlanReviewSurface {...defaultProps} onDraftsChanged={onDraftsChanged} resetSignal={1} />)
		const [afterReset, afterCount] = onDraftsChanged.mock.calls.at(-1)!
		expect(afterCount).toBe(0)
		expect(afterReset).toBe("")
		expect(screen.getByText("Send notes").closest("button")).toBeDisabled()
	})

	it("close button (X) calls onClose", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		// The X button has aria-label "Cancel" (reuses cancel i18n key).
		const closeBtn = screen.getByLabelText("Cancel")
		fireEvent.click(closeBtn)
		expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
	})

	it("cancel button in footer calls onClose", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		const cancelButtons = screen.getAllByText("Cancel")
		const footerCancel = cancelButtons.find((el) => el.tagName === "BUTTON")
		expect(footerCancel).toBeTruthy()
		fireEvent.click(footerCancel!)
		expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
	})

	it("shows filePath in header when provided", () => {
		render(<PlanReviewSurface {...defaultProps} filePath="plans/plan.md" />)
		expect(screen.getByText("plans/plan.md")).toBeInTheDocument()
	})

	it("does not show filePath in header when not provided", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		expect(screen.queryByText("plans/plan.md")).not.toBeInTheDocument()
	})

	describe("change highlighting (baselineMarkdown)", () => {
		it("shows no diff badge or highlights without a baseline", () => {
			render(<PlanReviewSurface {...defaultProps} />)
			expect(screen.queryByTestId("plan-diff-badge")).not.toBeInTheDocument()
			expect(screen.queryByTestId("plan-diff-changed")).not.toBeInTheDocument()
		})

		it("shows no diff badge when baseline equals current content", () => {
			render(<PlanReviewSurface {...defaultProps} baselineMarkdown={defaultProps.markdown} />)
			expect(screen.queryByTestId("plan-diff-badge")).not.toBeInTheDocument()
			expect(screen.queryByTestId("plan-diff-changed")).not.toBeInTheDocument()
		})

		it("highlights blocks changed since the baseline and shows the badge", () => {
			render(
				<PlanReviewSurface
					{...defaultProps}
					markdown={"# Title\n\nintro\n\nnew step added by the model"}
					baselineMarkdown={"# Title\n\nintro"}
				/>,
			)
			expect(screen.getByTestId("plan-diff-badge")).toBeInTheDocument()
			const changed = screen.getByTestId("plan-diff-changed")
			expect(changed).toHaveTextContent("new step added by the model")
			// Unchanged content is rendered outside the highlighted block.
			const blocks = screen.getAllByTestId("markdown-block")
			expect(blocks.some((b) => b.textContent?.includes("intro"))).toBe(true)
		})

		it("shows a struck-through strip for content removed since the baseline", () => {
			render(
				<PlanReviewSurface
					{...defaultProps}
					markdown={"# Title\n\nend"}
					baselineMarkdown={"# Title\n\ndropped step\n\nend"}
				/>,
			)
			const removed = screen.getByTestId("plan-diff-removed")
			expect(removed).toHaveTextContent("dropped step")
			expect(screen.getByTestId("plan-diff-badge")).toBeInTheDocument()
		})
	})
})
