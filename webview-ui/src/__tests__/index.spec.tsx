// The webview entry picks the plan review app or the main app from a flag set by
// the host. The plan review app is only needed in its own panel, so it must be a
// lazy chunk the main panel never loads.

const { imports, rendered } = vi.hoisted(() => ({
	imports: { planReviewApp: 0 },
	rendered: [] as unknown[],
}))

vi.mock("react-dom/client", () => ({
	createRoot: () => ({ render: (element: unknown) => rendered.push(element) }),
}))

vi.mock("../utils/highlighter", () => ({ getHighlighter: () => Promise.resolve() }))

vi.mock("../App", () => ({ default: () => <div data-testid="main-app" /> }))

vi.mock("../components/plan-review/PlanReviewApp", () => {
	imports.planReviewApp++
	return { default: () => <div data-testid="plan-review-app" /> }
})

type PlanReviewWindow = Window & { PLAN_REVIEW_MODE?: boolean }

describe("webview entry", () => {
	beforeEach(() => {
		vi.resetModules()
		imports.planReviewApp = 0
		rendered.length = 0
		document.body.innerHTML = '<div id="root"></div>'
	})

	afterEach(() => {
		delete (window as PlanReviewWindow).PLAN_REVIEW_MODE
	})

	it("does not load the plan review app in the main panel", async () => {
		await import("../index")

		expect(rendered).toHaveLength(1)
		expect(imports.planReviewApp).toBe(0)
	})

	it("renders the plan review app in the plan review panel", async () => {
		;(window as PlanReviewWindow).PLAN_REVIEW_MODE = true
		const { render, screen } = await import("@/utils/test-utils")

		await import("../index")
		render(rendered[0] as React.ReactElement)

		expect(await screen.findByTestId("plan-review-app")).toBeInTheDocument()
		expect(screen.queryByTestId("main-app")).not.toBeInTheDocument()
	})
})
