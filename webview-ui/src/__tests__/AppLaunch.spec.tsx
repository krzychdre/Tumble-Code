/**
 * P3 regression: the webview must post `webviewDidLaunch` exactly once on
 * startup. Both App.tsx and ExtensionStateContext used to post it (the shared
 * WEBVIEW_DID_LAUNCH_MESSAGE constant), and the host handler is not
 * idempotent — every copy triggers a full postStateToWebview().
 *
 * Unlike App.spec.tsx, this spec renders AppWithProviders with the REAL
 * ExtensionStateContextProvider so both mount effects are observed.
 */
// npx vitest run src/__tests__/AppLaunch.spec.tsx

import React from "react"
import { render, cleanup } from "@/utils/test-utils"

import AppWithProviders from "../App"

import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock the telemetry client (imported at App.tsx module level)
vi.mock("@src/utils/TelemetryClient", () => ({
	telemetryClient: {
		capture: vi.fn(),
		updateTelemetryState: vi.fn(),
	},
}))

// Pass-through translation provider; nothing renders before hydration anyway.
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

describe("App startup launch message", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		window.removeEventListener("message", () => {})
	})

	afterEach(() => {
		cleanup()
		window.removeEventListener("message", () => {})
	})

	it("posts webviewDidLaunch exactly once on mount", () => {
		render(<AppWithProviders />)

		const launchPosts = vi
			.mocked(vscode.postMessage)
			.mock.calls.map(([message]) => message)
			.filter((message) => message?.type === "webviewDidLaunch")

		expect(launchPosts).toHaveLength(1)
		expect(launchPosts[0]).toEqual({ type: "webviewDidLaunch", acceptsMessageAdded: true })
	})
})
