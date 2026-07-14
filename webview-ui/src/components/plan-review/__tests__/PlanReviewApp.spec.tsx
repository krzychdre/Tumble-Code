import React from "react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, act, waitFor, fireEvent } from "@/utils/test-utils"

// Mock vscode.postMessage — vi.mock is hoisted, so we use vi.hoisted to create
// the mock function before the factory runs.
const { mockPostMessage } = vi.hoisted(() => ({ mockPostMessage: vi.fn() }))
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: mockPostMessage,
	},
}))

// Mock MarkdownBlock to just render text.
vi.mock("../../common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown?: string }) => <div data-testid="markdown-block">{markdown}</div>,
}))

// Mock i18n translation.
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
				"chat:planReview.loading": "Loading plan…",
			}
			return map[key] ?? key
		},
	}),
	TranslationProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock react-i18next useTranslation to return predictable strings.
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const map: Record<string, string> = {
				"chat:planReview.loading": "Loading plan…",
				"chat:planReview.title": "Review plan",
				"chat:planReview.send": "Send notes",
				"chat:planReview.cancel": "Cancel",
				"chat:planReview.emptyState": "Select text in the plan to add a note.",
				"chat:planReview.addNote": "Add note",
				"chat:planReview.notePlaceholder": "Write your note…",
				"chat:planReview.editNote": "Edit note",
				"chat:planReview.deleteNote": "Delete note",
				"chat:planReview.save": "Save",
			}
			return map[key] ?? key
		},
		i18n: { changeLanguage: vi.fn() },
	}),
}))

// Mock i18n setup to avoid loading real translations.
vi.mock("@src/i18n/setup", () => ({
	default: {
		changeLanguage: vi.fn(),
	},
	loadTranslations: vi.fn(),
}))

// Mock ErrorBoundary to pass through.
vi.mock("@src/components/ErrorBoundary", () => ({
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Mock ExtensionStateContextProvider to provide minimal defaults.
vi.mock("@src/context/ExtensionStateContext", () => ({
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	useExtensionState: () => ({
		language: "en",
		apiConfiguration: {},
		customModes: [],
		mcpServers: [],
		alwaysAllowMcp: false,
		currentCheckpoint: undefined,
		mode: "architect",
		clineMessages: [],
		currentTaskItem: undefined,
	}),
}))

import PlanReviewApp from "../PlanReviewApp"

function dispatchMessage(data: { type: string; planReview?: Record<string, unknown> }) {
	act(() => {
		window.dispatchEvent(new MessageEvent("message", { data }))
	})
}

describe("PlanReviewApp", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("shows loading state before init", () => {
		render(<PlanReviewApp />)
		expect(screen.getByText("Loading plan…")).toBeInTheDocument()
	})

	it("posts planReviewReady on mount", () => {
		render(<PlanReviewApp />)
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "planReviewReady" })
	})

	it("renders markdown after planReviewInit", async () => {
		render(<PlanReviewApp />)
		dispatchMessage({
			type: "planReviewInit",
			planReview: {
				markdown: "# My Plan\n\nThis is the plan content.",
				filePath: "plans/plan.md",
				language: "en",
			},
		})
		await waitFor(() => {
			expect(screen.getByTestId("markdown-block")).toBeInTheDocument()
		})
		expect(screen.getByTestId("markdown-block")).toHaveTextContent("My Plan")
		expect(screen.getByText("plans/plan.md")).toBeInTheDocument()
	})

	it("swaps markdown on planReviewUpdate (surface stays mounted)", async () => {
		render(<PlanReviewApp />)
		dispatchMessage({
			type: "planReviewInit",
			planReview: {
				markdown: "# Original Plan",
				filePath: "plans/plan.md",
				language: "en",
			},
		})
		await waitFor(() => {
			expect(screen.getByTestId("markdown-block")).toHaveTextContent("Original Plan")
		})

		dispatchMessage({
			type: "planReviewUpdate",
			planReview: {
				markdown: "# Updated Plan",
			},
		})
		await waitFor(() => {
			expect(screen.getByTestId("markdown-block")).toHaveTextContent("Updated Plan")
		})
	})

	it("handles planReviewDraftsConsumed without crashing (drafts reset propagated)", async () => {
		render(<PlanReviewApp />)
		dispatchMessage({
			type: "planReviewInit",
			planReview: {
				markdown: "# Plan",
				filePath: "plans/plan.md",
				language: "en",
			},
		})
		await waitFor(() => {
			expect(screen.getByTestId("markdown-block")).toBeInTheDocument()
		})

		dispatchMessage({ type: "planReviewDraftsConsumed" })
		// Still rendered, send disabled (no drafts).
		expect(screen.getByTestId("markdown-block")).toBeInTheDocument()
		expect(screen.getByText("Send notes").closest("button")).toBeDisabled()
	})

	it("close button posts planReviewClose", async () => {
		render(<PlanReviewApp />)
		dispatchMessage({
			type: "planReviewInit",
			planReview: {
				markdown: "# Plan",
				language: "en",
			},
		})
		await waitFor(() => {
			expect(screen.getByTestId("markdown-block")).toBeInTheDocument()
		})

		// Click the X close button (aria-label "Cancel").
		const closeBtn = screen.getByLabelText("Cancel")
		fireEvent.click(closeBtn)
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "planReviewClose" })
	})
})
