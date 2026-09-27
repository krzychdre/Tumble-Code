/**
 * P4: the Marketplace and Cloud views are React.lazy chunks — their module
 * factories must not run while the app sits on the chat tab, and must run
 * exactly once when the tab opens. The mock factories double as fetch
 * counters (same pattern as MarkdownBlock.spec.tsx's importCounts).
 *
 * SettingsView's Modes/MCP tabs are covered by
 * src/components/settings/__tests__/SettingsView.lazy-tabs.spec.tsx.
 */
// npx vitest run src/__tests__/AppLazyTabs.spec.tsx

import React from "react"
import { render, screen, act, cleanup } from "@/utils/test-utils"

import AppWithProviders from "../App"

const { importCounts } = vi.hoisted(() => ({
	importCounts: { marketplace: 0, cloud: 0 },
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@src/components/ErrorBoundary", () => ({
	__esModule: true,
	default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("@src/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: vi.fn(),
		updateTelemetryState: vi.fn(),
	},
}))

vi.mock("@src/components/chat/ChatView", () => ({
	__esModule: true,
	default: function ChatView() {
		return <div data-testid="chat-view">Chat View</div>
	},
}))

vi.mock("@src/components/settings/SettingsView", () => ({
	__esModule: true,
	default: function SettingsView() {
		return <div data-testid="settings-view">Settings View</div>
	},
}))

vi.mock("@src/components/welcome/WelcomeViewProvider", () => ({
	__esModule: true,
	default: function WelcomeView() {
		return <div data-testid="welcome-view">Welcome View</div>
	},
}))

vi.mock("@src/components/history/HistoryView", () => ({
	__esModule: true,
	default: function HistoryView() {
		return <div data-testid="history-view">History View</div>
	},
}))

vi.mock("@src/components/marketplace/MarketplaceView", () => {
	importCounts.marketplace++
	return {
		MarketplaceView: function MarketplaceView({ onDone }: { onDone?: () => void }) {
			return (
				<div data-testid="marketplace-view" onClick={onDone}>
					Marketplace View
				</div>
			)
		},
	}
})

vi.mock("@src/components/cloud/CloudView", () => {
	importCounts.cloud++
	return {
		CloudView: function CloudView() {
			return <div data-testid="cloud-view">Cloud View</div>
		},
	}
})

const mockUseExtensionState = vi.fn()

vi.mock("@src/i18n/TranslationContext", () => {
	const tFunction = (key: string) => key
	return {
		__esModule: true,
		default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
		useAppTranslation: () => ({
			t: tFunction,
			i18n: { t: tFunction, changeLanguage: vi.fn(() => Promise.resolve()) },
		}),
	}
})

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockUseExtensionState(),
	ExtensionStateContextProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const hydratedState = {
	didHydrateState: true,
	showWelcome: false,
	shouldShowAnnouncement: false,
	experiments: {},
	language: "en",
	telemetrySetting: "enabled",
}

const triggerMessage = (action: string) => {
	const messageEvent = new MessageEvent("message", {
		data: {
			type: "action",
			action,
		},
	})
	window.dispatchEvent(messageEvent)
}

describe("App lazy tabs (P4)", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		importCounts.marketplace = 0
		importCounts.cloud = 0
		window.removeEventListener("message", () => {})
		mockUseExtensionState.mockReturnValue({ ...hydratedState })
	})

	afterEach(() => {
		cleanup()
		window.removeEventListener("message", () => {})
	})

	it("does not fetch the Marketplace or Cloud chunks while on the chat tab", () => {
		render(<AppWithProviders />)

		expect(screen.getByTestId("chat-view")).toBeInTheDocument()
		expect(importCounts.marketplace).toBe(0)
		expect(importCounts.cloud).toBe(0)
	})

	it("fetches the Marketplace chunk exactly once when the marketplace tab opens", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("marketplaceButtonClicked")
		})

		expect(await screen.findByTestId("marketplace-view")).toBeInTheDocument()
		expect(importCounts.marketplace).toBe(1)

		// Leaving and returning does not re-fetch the chunk.
		act(() => {
			triggerMessage("chatButtonClicked")
		})
		act(() => {
			triggerMessage("marketplaceButtonClicked")
		})

		expect(await screen.findByTestId("marketplace-view")).toBeInTheDocument()
		expect(importCounts.marketplace).toBe(1)
	})

	it("fetches the Cloud chunk exactly once when the cloud tab opens", async () => {
		render(<AppWithProviders />)

		act(() => {
			triggerMessage("cloudButtonClicked")
		})

		expect(await screen.findByTestId("cloud-view")).toBeInTheDocument()
		expect(importCounts.cloud).toBe(1)
	})

	it("shows the loading fallback while the lazy chunk resolves", async () => {
		// Suspend the chunk: a factory that never resolves keeps the lazy
		// component in its pending state so the fallback is observable. The
		// App module and its lazy() thunk are cached, so this needs a fresh
		// module registry with the pending mock registered BEFORE App loads.
		vi.resetModules()
		vi.doMock("@src/components/marketplace/MarketplaceView", () => new Promise(() => {}))

		const { default: FreshApp } = await import("../App")
		render(<FreshApp />)

		act(() => {
			triggerMessage("marketplaceButtonClicked")
		})

		expect(await screen.findByTestId("tab-loading")).toBeInTheDocument()
		// Still pending: the view itself never appears.
		expect(screen.queryByTestId("marketplace-view")).not.toBeInTheDocument()
	})
})
