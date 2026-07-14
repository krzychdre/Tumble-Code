import React from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@/utils/test-utils"

import { PlanReviewSurface } from "../PlanReviewSurface"

// Mock MarkdownBlock to just render text — avoids complex markdown rendering in jsdom.
vi.mock("../../common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown?: string }) => <div data-testid="markdown-block">{markdown}</div>,
}))

// Mock the i18n translation to return predictable English strings.
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:planReview.title": "Review plan",
				"chat:planReview.addNote": "Add note",
				"chat:planReview.notePlaceholder": "Write your note…",
				"chat:planReview.overallPlaceholder": "Overall comments (optional)",
				"chat:planReview.send": "Send notes",
				"chat:planReview.cancel": "Cancel",
				"chat:planReview.emptyState": "Select text in the plan to add a note.",
				"chat:planReview.editNote": "Edit note",
				"chat:planReview.deleteNote": "Delete note",
				"chat:planReview.save": "Save",
				"chat:planReview.annotateTooltip": "Review & annotate",
			}
			return map[key] ?? key
		},
	}),
}))

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
		expect(screen.getByText("Select text in the plan to add a note.")).toBeInTheDocument()
	})

	it("send button is disabled with no notes and no overall comment", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		const sendButton = screen.getByText("Send notes")
		expect(sendButton.closest("button")).toBeDisabled()
	})

	it("typing overall comment enables send button", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		const textarea = screen.getByPlaceholderText("Overall comments (optional)")
		fireEvent.change(textarea, { target: { value: "Good plan" } })
		const sendButton = screen.getByText("Send notes")
		expect(sendButton.closest("button")).not.toBeDisabled()
	})

	it("clicking send calls onSubmit with compiled text containing Overall:", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		const textarea = screen.getByPlaceholderText("Overall comments (optional)")
		fireEvent.change(textarea, { target: { value: "Good plan" } })
		const sendButton = screen.getByText("Send notes")
		fireEvent.click(sendButton)
		expect(defaultProps.onSubmit).toHaveBeenCalledTimes(1)
		const compiled = defaultProps.onSubmit.mock.calls[0][0] as string
		expect(compiled).toContain("Overall: Good plan")
		expect(compiled).toContain("Please address these notes and update the plan.")
		// No annotations → no header.
		expect(compiled).not.toContain("I reviewed the plan and added notes on specific parts.")
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
		// Footer cancel button — find by text "Cancel" that's a button.
		const cancelButtons = screen.getAllByText("Cancel")
		// The footer cancel button is a Button component (renders as <button>)
		const footerCancel = cancelButtons.find((el) => el.tagName === "BUTTON")
		expect(footerCancel).toBeTruthy()
		fireEvent.click(footerCancel!)
		expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
	})

	it("send is disabled when annotations empty but overall whitespace-only", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		const textarea = screen.getByPlaceholderText("Overall comments (optional)")
		fireEvent.change(textarea, { target: { value: "   " } })
		const sendButton = screen.getByText("Send notes")
		expect(sendButton.closest("button")).toBeDisabled()
	})

	it("shows filePath in header when provided", () => {
		render(<PlanReviewSurface {...defaultProps} filePath="plans/plan.md" />)
		expect(screen.getByText("plans/plan.md")).toBeInTheDocument()
	})

	it("does not show filePath in header when not provided", () => {
		render(<PlanReviewSurface {...defaultProps} />)
		expect(screen.queryByText("plans/plan.md")).not.toBeInTheDocument()
	})
})
