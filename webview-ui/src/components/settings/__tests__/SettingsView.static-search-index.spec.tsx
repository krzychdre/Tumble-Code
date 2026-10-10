/**
 * Static search index (settingsSearchIndex.ts): the Modes and MCP tabs are
 * searchable WITHOUT being mounted — their lazy chunks must not load. The mock
 * factories double as fetch counters (same pattern as
 * SettingsView.lazy-tabs.spec.tsx).
 *
 * NOTE: this spec deliberately does NOT mock ../SettingsSearch — the real
 * component drives the search pipeline end-to-end (input → fzf → results →
 * navigate).
 */
// npx vitest run src/components/settings/__tests__/SettingsView.static-search-index.spec.tsx

import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { vi, describe, it, expect, beforeEach } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import React from "react"

// Mock vscode API
const mockPostMessage = vi.fn()
const mockVscode = {
	postMessage: mockPostMessage,
}
;(global as any).acquireVsCodeApi = () => mockVscode

// jsdom in this workspace runs without pretendToBeVisual, so
// window.requestAnimationFrame is undefined — but the search index registry
// batches registration updates through rAF. Route rAF through setTimeout
// (waitFor polls on real timers, so the callback lands inside the wait).
if (typeof window.requestAnimationFrame !== "function") {
	window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
		setTimeout(() => cb(performance.now()), 0)) as typeof window.requestAnimationFrame
	window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame
}

const { importCounts } = vi.hoisted(() => ({ importCounts: { modes: 0, mcp: 0 } }))

// Fetch counters: each factory runs exactly once per actual module fetch.
vi.mock("@src/components/modes/ModesView", () => {
	importCounts.modes++
	return { default: () => <div data-testid="modes-view">Modes View</div> }
})

vi.mock("@src/components/mcp/McpView", () => {
	importCounts.mcp++
	return { default: () => <div data-testid="mcp-view">MCP View</div> }
})

// Mock i18next: bare `t` is undefined in webview-ui vitest (known trap) —
// mock the translation hook AND the underlying i18next instance, and assert
// on the translated label rendered from the mock dictionary below.
const { mockT } = vi.hoisted(() => ({
	mockT: vi.fn((key: string, options?: Record<string, any>) => {
		const dict: Record<string, string> = {
			"settings:sections.modes": "Modes",
			"settings:sections.mcp": "MCP Servers",
			"settings:sections.providers": "Providers",
			"settings:sections.autoApprove": "Auto-Approving",
			"prompts:modes.createNewMode": "Create new mode",
			"mcp:editGlobalMCP": "Edit Global MCP",
			"mcp:networkTimeout.label": "Network Timeout",
			"settings:autoApprove.enabled": "Enable auto-approval",
		}
		const value = dict[key] ?? key
		// Minimal {{interpolation}} support for options-bearing keys.
		if (options) {
			return Object.entries(options).reduce(
				(acc, [name, val]) => acc.replace(new RegExp(`{{\\s*${name}\\s*}}`, "g"), String(val)),
				value,
			)
		}
		return value
	}),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({ t: mockT, i18n: { language: "en" } }),
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: mockT, i18n: { language: "en" } }),
	Trans: ({ children }: any) => <>{children}</>,
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// Import the component under test AFTER the mocks are registered.
import SettingsView from "../SettingsView"

const mockState = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: mockState.fn,
	useExtensionSelector: (selector: (s: never) => unknown) => selector(mockState.fn() as never),
}))

// Mock UI components: partial mock of the barrel; stub the tooltip exports
// (the real Tooltip needs a TooltipProvider — same trap as the i18next mock).
vi.mock("@src/components/ui", async (importOriginal) => {
	const original = await importOriginal<any>()
	return {
		...original,
		Tooltip: ({ children }: any) => <>{children}</>,
		TooltipContent: ({ children }: any) => <>{children}</>,
		TooltipTrigger: ({ children }: any) => <>{children}</>,
		StandardTooltip: ({ children }: any) => <>{children}</>,
		Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
		ToggleSwitch: ({ checked, onChange, ...props }: any) => (
			<button role="switch" aria-checked={checked} onClick={onChange} {...props} />
		),
		AlertDialog: ({ open, children }: any) => (open ? <div data-testid="alert-dialog">{children}</div> : null),
		AlertDialogContent: ({ children }: any) => <div>{children}</div>,
		AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
		AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
		AlertDialogCancel: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
		AlertDialogAction: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
		AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
		Select: ({ children, ...props }: any) => <select {...props}>{children}</select>,
		SelectTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
		SelectValue: ({ children }: any) => <>{children}</>,
		SelectContent: ({ children }: any) => <>{children}</>,
		SelectItem: ({ children, ...props }: any) => <option {...props}>{children}</option>,
		Collapsible: ({ children }: any) => <div>{children}</div>,
		CollapsibleTrigger: ({ children, ...props }: any) => <div {...props}>{children}</div>,
		CollapsibleContent: ({ children }: any) => <div>{children}</div>,
		Dialog: ({ children }: any) => <div>{children}</div>,
		DialogContent: ({ children }: any) => <div>{children}</div>,
		DialogHeader: ({ children }: any) => <div>{children}</div>,
		DialogTitle: ({ children }: any) => <div>{children}</div>,
		DialogDescription: ({ children }: any) => <div>{children}</div>,
		DialogFooter: ({ children }: any) => <div>{children}</div>,
	}
})

// Keep the eager sections cheap and isolated; they are not under test here.
vi.mock("../ApiConfigManager", () => ({ default: () => null }))
vi.mock("../ApiOptions", () => ({ default: () => null }))
// AutoApproveSettings stands in for ALL eager sections: render a REAL
// SearchableSetting so runtime registration into the live index is exercised.
vi.mock("../AutoApproveSettings", async () => {
	const { SearchableSetting } = await import("../SearchableSetting")
	return {
		AutoApproveSettings: () => (
			<SearchableSetting
				settingId="auto-approve-enabled"
				section="autoApprove"
				label={mockT("settings:autoApprove.enabled")}>
				<div>auto-approve body</div>
			</SearchableSetting>
		),
	}
})
vi.mock("../SectionHeader", () => ({ SectionHeader: ({ children }: any) => <div>{children}</div> }))
vi.mock("../Section", () => ({ Section: ({ children }: any) => <div>{children}</div> }))
vi.mock("../CheckpointSettings", () => ({ CheckpointSettings: () => null }))
vi.mock("../NotificationSettings", () => ({ NotificationSettings: () => null }))
vi.mock("../ContextManagementSettings", () => ({ ContextManagementSettings: () => null }))
vi.mock("../TerminalSettings", () => ({ TerminalSettings: () => null }))
vi.mock("../ExperimentalSettings", () => ({ ExperimentalSettings: () => null }))
vi.mock("../LanguageSettings", () => ({ LanguageSettings: () => null }))
vi.mock("../About", () => ({ About: () => null }))
vi.mock("../PromptsSettings", () => ({ default: () => null }))
vi.mock("../UISettings", () => ({ UISettings: () => null }))
vi.mock("../SkillsSettings", () => ({ SkillsSettings: () => null }))
vi.mock("../SubagentSettings", () => ({ SubagentSettings: () => null }))
vi.mock("../MemorySettings", () => ({ MemorySettings: () => null }))
vi.mock("../WebToolsSettings", () => ({ WebToolsSettings: () => null }))
vi.mock("../WorktreesView", () => ({ WorktreesView: () => null }))
vi.mock("@src/components/worktrees/WorktreesView", () => ({ WorktreesView: () => null }))
// NOTE: ../useSettingsSearch is deliberately NOT mocked — the real registry,
// provider and SearchableSetting registration must flow into the real index.
vi.mock("@src/utils/extensionBus", () => ({
	onExtensionMessage: () => () => {},
	useExtensionMessage: () => {},
}))
const createExtensionState = (overrides = {}) => ({
	currentApiConfigName: "default",
	listApiConfigMeta: [],
	uriScheme: "vscode",
	settingsImportedAt: undefined,
	apiConfiguration: {
		apiProvider: "openai",
		apiModelId: "",
	},
	alwaysAllowReadOnly: false,
	alwaysAllowReadOnlyOutsideWorkspace: false,
	allowedCommands: [],
	deniedCommands: [],
	allowedMaxRequests: undefined,
	allowedMaxCost: undefined,
	language: "en",
	alwaysAllowMcp: false,
	mcpEnabled: false,
	experiments: {},
	customSupportPrompts: {},
	profileThresholds: {},
	...overrides,
})

let queryClient: QueryClient

const renderSettingsView = () =>
	render(
		<QueryClientProvider client={queryClient}>
			<SettingsView onDone={vi.fn()} />
		</QueryClientProvider>,
	)

describe("SettingsView static search index", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		importCounts.modes = 0
		importCounts.mcp = 0
		queryClient = new QueryClient({
			defaultOptions: {
				queries: { retry: false },
				mutations: { retry: false },
			},
		})
		;(mockState.fn as any).mockReturnValue(createExtensionState())
	})

	it("search input is available immediately (no indexing cycle)", () => {
		renderSettingsView()
		expect(screen.getByTestId("settings-search-input")).toBeInTheDocument()
	})

	it("finds Modes-section entries without mounting the Modes tab", () => {
		renderSettingsView()

		const input = screen.getByTestId("settings-search-input")
		fireEvent.change(input, { target: { value: "create new mode" } })
		fireEvent.focus(input)

		// The static entry (prompts:modes.createNewMode) is a search result.
		expect(screen.getByRole("option", { name: /Create new mode/ })).toBeInTheDocument()
		// And it was found WITHOUT loading the Modes chunk.
		expect(importCounts.modes).toBe(0)
	})

	it("finds MCP-section entries without mounting the MCP tab", () => {
		renderSettingsView()

		const input = screen.getByTestId("settings-search-input")
		fireEvent.change(input, { target: { value: "edit global mcp" } })
		fireEvent.focus(input)

		expect(screen.getByRole("option", { name: /Edit Global MCP/ })).toBeInTheDocument()
		expect(importCounts.mcp).toBe(0)
	})

	it("navigating a Modes result switches to the Modes tab and loads it", async () => {
		renderSettingsView()

		const input = screen.getByTestId("settings-search-input")
		fireEvent.change(input, { target: { value: "create new mode" } })
		fireEvent.focus(input)

		fireEvent.click(screen.getByRole("option", { name: /Create new mode/ }))

		// Tab switched to Modes and the lazy chunk actually loads now.
		expect(await screen.findByTestId("modes-view")).toBeInTheDocument()
		expect(importCounts.modes).toBe(1)
	})

	it("navigating an MCP result switches to the MCP tab and loads it", async () => {
		renderSettingsView()

		const input = screen.getByTestId("settings-search-input")
		fireEvent.change(input, { target: { value: "network timeout" } })
		fireEvent.focus(input)

		fireEvent.click(screen.getByRole("option", { name: /Network Timeout/ }))

		expect(await screen.findByTestId("mcp-view")).toBeInTheDocument()
		expect(importCounts.mcp).toBe(1)
	})

	it("search still lists eager-section entries (runtime registration intact)", async () => {
		renderSettingsView()

		// Switch to the autoApprove tab so its SearchableSetting registers.
		fireEvent.click(screen.getByTestId("tab-autoApprove"))

		const input = screen.getByTestId("settings-search-input")
		fireEvent.change(input, { target: { value: "auto-approval" } })
		fireEvent.focus(input)

		await waitFor(() => {
			// fzf splits the label into highlight segments (span + mark), so
			// the accessible name may lose inter-segment whitespace — match
			// tolerantly.
			expect(screen.getByRole("option", { name: /Enable\s*auto-approval/ })).toBeInTheDocument()
		})
	})
})
