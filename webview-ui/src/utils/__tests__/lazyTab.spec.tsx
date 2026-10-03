// npx vitest run src/utils/__tests__/lazyTab.spec.tsx
//
// Regression: reinstalling the VSIX while a window stays open left the running
// webview asking for chunk files the new install had replaced, and opening the
// Marketplace tab crashed the whole view into the error boundary with
// "Failed to fetch dynamically imported module".

import React, { Suspense } from "react"
import { render, screen, fireEvent } from "@testing-library/react"

import { isChunkLoadError, lazyTab } from "../lazyTab"

const mockPostMessage = vi.fn()
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: (message: unknown) => mockPostMessage(message),
	},
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: (key: string) => key }),
}))

class CatchBoundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
	state: { error?: Error } = {}
	static getDerivedStateFromError(error: Error) {
		return { error }
	}
	render() {
		return this.state.error ? <div data-testid="boundary">{this.state.error.message}</div> : this.props.children
	}
}

const renderLazy = (Tab: React.ComponentType) =>
	render(
		<CatchBoundary>
			<Suspense fallback={<div>loading</div>}>
				<Tab />
			</Suspense>
		</CatchBoundary>,
	)

describe("lazyTab", () => {
	beforeEach(() => {
		mockPostMessage.mockClear()
		vi.spyOn(console, "error").mockImplementation(() => {})
	})

	it("renders the tab when its chunk loads", async () => {
		const Tab = lazyTab(() => Promise.resolve({ default: () => <div data-testid="tab">tab</div> }))
		renderLazy(Tab)
		expect(await screen.findByTestId("tab")).toBeInTheDocument()
	})

	it("shows the reload notice instead of crashing when the chunk is gone", async () => {
		const Tab = lazyTab(() =>
			Promise.reject(
				new TypeError(
					"Failed to fetch dynamically imported module: https://file+.vscode-resource.vscode-cdn.net/x/assets/MarketplaceView-old.js",
				),
			),
		)
		renderLazy(Tab)

		expect(await screen.findByTestId("stale-build-notice")).toBeInTheDocument()
		expect(screen.queryByTestId("boundary")).not.toBeInTheDocument()

		fireEvent.click(screen.getByText("common:staleBuild.reload"))
		expect(mockPostMessage).toHaveBeenCalledWith({ type: "reloadWindow" })
	})

	it("rethrows any other import error to the error boundary", async () => {
		const Tab = lazyTab(() => Promise.reject(new Error("boom in module body")))
		renderLazy(Tab)
		expect(await screen.findByTestId("boundary")).toHaveTextContent("boom in module body")
	})
})

describe("isChunkLoadError", () => {
	it.each([
		"Failed to fetch dynamically imported module: x.js",
		"error loading dynamically imported module: x.js",
		"Importing a module script failed.",
	])("matches %s", (message) => {
		expect(isChunkLoadError(new TypeError(message))).toBe(true)
	})

	it("ignores unrelated errors and non-errors", () => {
		expect(isChunkLoadError(new Error("x is not a function"))).toBe(false)
		expect(isChunkLoadError("Failed to fetch dynamically imported module")).toBe(false)
	})
})
