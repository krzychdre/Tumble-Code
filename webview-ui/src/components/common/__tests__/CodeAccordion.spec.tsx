// §2.7 (ai_plans/2026-09-27_ui-modernization.md): a diff's file header is
// sticky, always shows "+N -M" (computed from the diff when the payload has
// no stats) and offers "Open diff", which opens the patch in an editor tab.

import { render, screen, fireEvent } from "@/utils/test-utils"

import { vscode } from "@src/utils/vscode"

import CodeAccordion from "../CodeAccordion"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, options?: { count?: number }) =>
			options?.count !== undefined ? `${key}:${options.count}` : key,
	}),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

vi.mock("@src/utils/highlightDiff", () => ({
	highlightHunks: vi.fn(async () => {
		throw new Error("no highlighter in tests")
	}),
}))

vi.mock("../CodeBlock", () => ({ default: () => null }))

const diff = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1,3 +1,4 @@", "-x", "+y", "+z", " keep", "-w", ""].join("\n")

const renderAccordion = (props: Partial<React.ComponentProps<typeof CodeAccordion>> = {}) =>
	render(
		<CodeAccordion
			path="src/a.ts"
			code={diff}
			language="diff"
			isExpanded={false}
			onToggleExpand={() => {}}
			{...props}
		/>,
	)

describe("CodeAccordion diff file header", () => {
	beforeEach(() => vi.mocked(vscode.postMessage).mockClear())

	it("shows +N -M counted from the diff when the payload carries no stats", () => {
		renderAccordion()

		expect(screen.getByText("+2")).toBeInTheDocument()
		expect(screen.getByText("-2")).toBeInTheDocument()
	})

	it("prefers the payload's stats when they are present", () => {
		renderAccordion({ diffStats: { added: 12, removed: 3 } })

		expect(screen.getByText("+12")).toBeInTheDocument()
		expect(screen.getByText("-3")).toBeInTheDocument()
	})

	it("offers an Open diff button that posts the patch without toggling the block", () => {
		const onToggleExpand = vi.fn()
		renderAccordion({ onToggleExpand })

		const button = screen.getByRole("button", { name: "chat:diffView.openDiff" })
		fireEvent.click(button)

		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "openDiff", text: diff.trim() })
		expect(onToggleExpand).not.toHaveBeenCalled()
	})

	it("does not offer Open diff for content that is not a diff", () => {
		renderAccordion({ language: "shell-session", code: "ls\na.ts" })

		expect(screen.queryByRole("button", { name: "chat:diffView.openDiff" })).toBeNull()
	})

	it("keeps the file header sticky so it stays in view while the diff scrolls past", () => {
		renderAccordion({ isExpanded: true })

		const header = screen.getByTestId("code-accordion-header")
		expect(header.className).toMatch(/\bsticky\b/)
		expect(header.className).toMatch(/\btop-0\b/)
		// An overflow-hidden ancestor would become the sticky scroll box and pin nothing.
		expect(header.parentElement?.className).not.toMatch(/overflow-hidden/)
	})

	it("renders the open-file control as a real button", () => {
		const onJumpToFile = vi.fn()
		renderAccordion({ onJumpToFile })

		fireEvent.click(screen.getByRole("button", { name: "chat:diffView.openFile" }))
		expect(onJumpToFile).toHaveBeenCalledTimes(1)
	})
})
