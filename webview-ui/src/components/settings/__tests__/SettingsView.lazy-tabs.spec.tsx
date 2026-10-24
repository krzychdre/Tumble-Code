// P4: the Modes and MCP tabs are lazy chunks that load only when their tab
// opens, and the static search index (settingsSearchIndex.ts) finds their
// entries without loading them. The mock factories count the chunk loads; a
// module loads once per file, so each test below loads a different one.
//
// The real SettingsSearch drives the pipeline: input, fzf, results, navigate.

import { fireEvent, render, screen, waitFor } from "@/utils/test-utils"

import SettingsView from "../SettingsView"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))

// The search index registry batches registrations through rAF, which this
// jsdom lacks; route it through setTimeout so waitFor sees the callback.
if (typeof window.requestAnimationFrame !== "function") {
	window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
		setTimeout(() => cb(performance.now()), 0)) as typeof window.requestAnimationFrame
	window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame
}

const { importCounts } = vi.hoisted(() => ({ importCounts: { modes: 0, mcp: 0 } }))
vi.mock("@src/components/modes/ModesView", () => {
	importCounts.modes++
	return { default: () => <div data-testid="modes-view" /> }
})
vi.mock("@src/components/mcp/McpView", () => {
	importCounts.mcp++
	return { default: () => <div data-testid="mcp-view" /> }
})

// Bare i18next `t` is undefined in webview vitest: a small dictionary instead.
const { mockT } = vi.hoisted(() => {
	const dict: Record<string, string> = {
		"prompts:modes.createNewMode": "Create new mode",
		"mcp:networkTimeout.label": "Network Timeout",
		"settings:autoApprove.enabled": "Enable auto-approval",
	}
	return { mockT: (key: string) => dict[key] ?? key }
})
vi.mock("@src/i18n/TranslationContext", () => ({ useAppTranslation: () => ({ t: mockT }) }))

const mockState = vi.hoisted(() => ({
	current: {
		currentApiConfigName: "default",
		listApiConfigMeta: [],
		apiConfiguration: { apiProvider: "openai" },
		experiments: {},
	},
}))
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockState.current,
	useExtensionSelector: (selector: (s: never) => unknown) => selector(mockState.current as never),
}))

vi.mock("../ApiConfigManager", () => ({ default: () => null }))
vi.mock("../ApiOptions", () => ({ default: () => null }))
// Stands in for every eager section: a real SearchableSetting, so runtime
// registration into the live index is exercised.
vi.mock("../AutoApproveSettings", async () => {
	const { SearchableSetting } = await import("../SearchableSetting")
	return {
		AutoApproveSettings: () => (
			<SearchableSetting
				settingId="auto-approve-enabled"
				section="autoApprove"
				label={mockT("settings:autoApprove.enabled")}>
				<div />
			</SearchableSetting>
		),
	}
})

const search = (query: string) => {
	const input = screen.getByTestId("settings-search-input")
	fireEvent.change(input, { target: { value: query } })
	fireEvent.focus(input)
}

describe("SettingsView lazy tabs and the static search index", () => {
	it.each([
		{ tab: "modes" as const, query: "create new mode", label: /Create new mode/, view: "modes-view" },
		{ tab: "mcp" as const, query: "network timeout", label: /Network Timeout/, view: "mcp-view" },
	])(
		"$tab: found by search without loading the chunk; the result opens the tab and loads it",
		async ({ tab, query, label, view }) => {
			render(<SettingsView onDone={vi.fn()} />)

			search(query)
			const option = screen.getByRole("option", { name: label })
			expect(importCounts[tab]).toBe(0)

			fireEvent.click(option)

			expect(await screen.findByTestId(view)).toBeInTheDocument()
			expect(importCounts[tab]).toBe(1)
		},
	)

	it("search still lists the entries an eager section registers at runtime", async () => {
		render(<SettingsView onDone={vi.fn()} />)
		fireEvent.click(screen.getByTestId("tab-autoApprove"))

		search("auto-approval")

		// fzf splits the label into highlight segments, so whitespace may go.
		await waitFor(() => {
			expect(screen.getByRole("option", { name: /Enable\s*auto-approval/ })).toBeInTheDocument()
		})
	})

	it("shows the loading fallback while a lazy tab chunk is pending", async () => {
		vi.resetModules()
		vi.doMock("@src/components/mcp/McpView", () => new Promise(() => {}))
		const { default: FreshSettingsView } = await import("../SettingsView")
		render(<FreshSettingsView onDone={vi.fn()} />)

		fireEvent.click(await screen.findByTestId("tab-mcp"))

		expect(await screen.findByTestId("tab-loading")).toBeInTheDocument()
		expect(screen.queryByTestId("mcp-view")).not.toBeInTheDocument()
	})
})
