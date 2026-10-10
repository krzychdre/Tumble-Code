/**
 * P4: the Modes and MCP tabs inside SettingsView are React.lazy chunks —
 * their module factories must not run until the corresponding settings tab is
 * selected. The mock factories double as fetch counters (same pattern as
 * MarkdownBlock.spec.tsx's importCounts).
 *
 * Since the static search index (settingsSearchIndex.ts) replaced the
 * cycle-render indexing, SettingsView must NOT mount any tab besides the
 * active one on startup — so the lazy factories must not fire AT ALL until
 * the user actually opens the Modes/MCP tab.
 */
// npx vitest run src/components/settings/__tests__/SettingsView.lazy-tabs.spec.tsx

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

// Import the actual component AFTER the mocks are registered.
import SettingsView from "../SettingsView"

const mockState = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: mockState.fn,
	useExtensionSelector: (selector: (s: never) => unknown) => selector(mockState.fn() as never),
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock UI components: partial mock of the barrel so every export SettingsView
// or its children reference resolves; only the interactive ones are stubbed.
vi.mock("@src/components/ui", async (importOriginal) => {
	const original = await importOriginal<any>()
	return {
		...original,
		// The real Tooltip needs a TooltipProvider; stub the tooltip exports.
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

// The REAL common/Tab components are used: TabList injects onSelect into each
// TabTrigger by cloning, which is how a tab click reaches handleTabChange.

// Mock the child components so the eager sections stay cheap and isolated.
vi.mock("../ApiConfigManager", () => ({ default: () => null }))
vi.mock("../ApiOptions", () => ({ default: () => null }))
vi.mock("../AutoApproveSettings", () => ({ AutoApproveSettings: () => null }))
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
vi.mock("../SettingsSearch", () => ({ SettingsSearch: () => null }))
vi.mock("../useSettingsSearch", async (importOriginal) => {
	const original = await importOriginal<any>()
	return { ...original, SearchIndexProvider: ({ children }: any) => <>{children}</> }
})

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

describe("SettingsView lazy Modes/MCP tabs (P4)", () => {
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

	// With the static search index there is no startup indexing cycle that
	// force-mounts every tab, so the lazy factories must not fire on mount.
	// The laziness claims to pin here: the factory fires ZERO times at
	// startup, exactly once when its tab is actually opened (React.lazy
	// caches its import), and never at SettingsView module scope.

	it("does not fetch the Modes chunk on startup, fetches once when opened", async () => {
		renderSettingsView()

		// The initial mount: NO fetch — nothing but the active tab renders.
		await waitFor(() => {
			expect(screen.getByTestId("save-button")).toBeInTheDocument()
		})
		expect(importCounts.modes).toBe(0)

		// Selecting the tab (again) must not re-fetch.
		const modesTrigger = screen.getByTestId("tab-modes")
		fireEvent.click(modesTrigger)
		expect(await screen.findByTestId("modes-view")).toBeInTheDocument()

		fireEvent.click(screen.getByTestId("tab-providers"))
		fireEvent.click(screen.getByTestId("tab-modes"))
		expect(await screen.findByTestId("modes-view")).toBeInTheDocument()

		expect(importCounts.modes).toBe(1)
	})

	it("does not fetch the MCP chunk on startup, fetches once when opened", async () => {
		renderSettingsView()

		await waitFor(() => {
			expect(screen.getByTestId("save-button")).toBeInTheDocument()
		})
		expect(importCounts.mcp).toBe(0)

		const mcpTrigger = screen.getByTestId("tab-mcp")
		fireEvent.click(mcpTrigger)
		expect(await screen.findByTestId("mcp-view")).toBeInTheDocument()

		fireEvent.click(screen.getByTestId("tab-providers"))
		fireEvent.click(screen.getByTestId("tab-mcp"))
		expect(await screen.findByTestId("mcp-view")).toBeInTheDocument()

		expect(importCounts.mcp).toBe(1)
	})

	it("shows the loading fallback while a lazy tab chunk is pending", async () => {
		vi.resetModules()
		vi.doMock("@src/components/mcp/McpView", () => new Promise(() => {}))

		const { default: FreshSettingsView } = await import("../SettingsView")
		render(
			<QueryClientProvider client={queryClient}>
				<FreshSettingsView onDone={vi.fn()} />
			</QueryClientProvider>,
		)

		const mcpTrigger = await screen.findByTestId("tab-mcp")
		fireEvent.click(mcpTrigger)

		expect(await screen.findByTestId("tab-loading")).toBeInTheDocument()
		expect(screen.queryByTestId("mcp-view")).not.toBeInTheDocument()
	})
})
