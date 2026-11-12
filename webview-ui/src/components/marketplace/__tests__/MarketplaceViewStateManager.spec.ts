import type { Mock } from "vitest"
import { filterItems, MarketplaceViewStateManager } from "../MarketplaceViewStateManager"
import { vscode } from "@/utils/vscode"
import { MarketplaceInstalledMetadata, MarketplaceItem } from "@tumble-code/types"

// Mock vscode module
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

describe("MarketplaceViewStateManager", () => {
	let stateManager: MarketplaceViewStateManager
	let mockStateChangeHandler: Mock

	const mockMarketplaceItems: MarketplaceItem[] = [
		{
			id: "test-mcp-1",
			name: "Test MCP Server 1",
			description: "A test MCP server",
			type: "mcp",
			url: "https://example.com/test-mcp-1",
			content: "test content",
			tags: ["test", "mcp"],
		},
		{
			id: "test-mode-1",
			name: "Test Mode 1",
			description: "A test mode",
			type: "mode",
			content: "test content",
			tags: ["test", "mode"],
		},
		{
			id: "test-mcp-2",
			name: "Test MCP Server 2",
			description: "Another test MCP server",
			type: "mcp",
			url: "https://example.com/test-mcp-2",
			content: "test content",
			tags: ["test", "server"],
		},
	]

	const noFilters = {
		type: "",
		search: "",
		tags: [],
		installed: "all" as const,
	}

	beforeEach(() => {
		stateManager = new MarketplaceViewStateManager()
		mockStateChangeHandler = vi.fn()
		stateManager.onStateChange(mockStateChangeHandler)
	})

	afterEach(() => {
		stateManager.cleanup()
		vi.clearAllMocks()
	})

	describe("initialization", () => {
		it("should initialize with default state", () => {
			const state = stateManager.getState()

			expect(state.allItems).toEqual([])
			expect(state.organizationMcps).toEqual([])
			expect(state.isFetching).toBe(true)
			expect(state.activeTab).toBe("mcp")
			expect(state.filters).toEqual(noFilters)
		})
	})

	describe("loading items", () => {
		it("should store items from FETCH_COMPLETE", () => {
			stateManager.transition({
				type: "FETCH_COMPLETE",
				payload: { items: mockMarketplaceItems },
			})

			const state = stateManager.getState()
			expect(state.allItems).toEqual(mockMarketplaceItems)
			expect(state.isFetching).toBe(false)
		})

		it("should store items from a state message", () => {
			stateManager.handleMessage({
				type: "state",
				state: { marketplaceItems: mockMarketplaceItems },
			})

			const state = stateManager.getState()
			expect(state.allItems).toEqual(mockMarketplaceItems)
			expect(state.isFetching).toBe(false)
		})

		it("should store items, organization mcps and installed metadata from a marketplaceData message", () => {
			const installedMetadata: MarketplaceInstalledMetadata = { project: {}, global: {} }

			stateManager.handleMessage({
				type: "marketplaceData",
				marketplaceItems: mockMarketplaceItems,
				organizationMcps: [mockMarketplaceItems[0]],
				marketplaceInstalledMetadata: installedMetadata,
			})

			const state = stateManager.getState()
			expect(state.allItems).toEqual(mockMarketplaceItems)
			expect(state.organizationMcps).toEqual([mockMarketplaceItems[0]])
			expect(state.installedMetadata).toEqual(installedMetadata)
			expect(state.isFetching).toBe(false)
		})
	})

	describe("state change notifications", () => {
		it("should notify handlers when marketplace items are loaded", () => {
			stateManager.handleMessage({
				type: "state",
				state: { marketplaceItems: mockMarketplaceItems },
			})

			expect(mockStateChangeHandler).toHaveBeenCalled()
			const notifiedState = mockStateChangeHandler.mock.calls[0][0]
			expect(notifiedState.allItems).toEqual(mockMarketplaceItems)
		})

		it("should notify once per state message", () => {
			stateManager.handleMessage({
				type: "state",
				state: { marketplaceItems: [] },
			})
			stateManager.handleMessage({
				type: "state",
				state: { marketplaceItems: mockMarketplaceItems },
			})

			// Should have been called twice, not infinitely
			expect(mockStateChangeHandler).toHaveBeenCalledTimes(2)

			const finalState = stateManager.getState()
			expect(finalState.allItems).toEqual(mockMarketplaceItems)
		})
	})

	describe("filters", () => {
		it("should merge partial filters into state and notify the extension", () => {
			stateManager.transition({
				type: "UPDATE_FILTERS",
				payload: { filters: { search: "Mode" } },
			})

			expect(stateManager.getState().filters).toEqual({ ...noFilters, search: "Mode" })
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "filterMarketplaceItems",
				filters: { ...noFilters, search: "Mode" },
			})
		})
	})

	describe("filterItems", () => {
		it("returns every item when no filter is set", () => {
			expect(filterItems(mockMarketplaceItems, noFilters)).toEqual(mockMarketplaceItems)
		})

		it("filters by type", () => {
			const filtered = filterItems(mockMarketplaceItems, { ...noFilters, type: "mcp" })

			expect(filtered).toHaveLength(2)
			expect(filtered.every((item) => item.type === "mcp")).toBe(true)
		})

		it("filters by search across name and description", () => {
			const filtered = filterItems(mockMarketplaceItems, { ...noFilters, search: "mode" })

			expect(filtered.map((item) => item.id)).toEqual(["test-mode-1"])
		})

		it("filters by tag", () => {
			const filtered = filterItems(mockMarketplaceItems, { ...noFilters, tags: ["server"] })

			expect(filtered.map((item) => item.id)).toEqual(["test-mcp-2"])
		})

		it("filters by installed status", () => {
			const installedMetadata: MarketplaceInstalledMetadata = {
				project: { "test-mcp-1": { type: "mcp" } },
				global: {},
			}

			const installed = filterItems(
				mockMarketplaceItems,
				{ ...noFilters, installed: "installed" },
				installedMetadata,
			)
			expect(installed.map((item) => item.id)).toEqual(["test-mcp-1"])

			const notInstalled = filterItems(
				mockMarketplaceItems,
				{ ...noFilters, installed: "not_installed" },
				installedMetadata,
			)
			expect(notInstalled.map((item) => item.id)).toEqual(["test-mode-1", "test-mcp-2"])
		})
	})

	describe("tab switching", () => {
		it("should update active tab", () => {
			stateManager.transition({
				type: "SET_ACTIVE_TAB",
				payload: { tab: "mode" },
			})

			const state = stateManager.getState()
			expect(state.activeTab).toBe("mode")
		})

		it("should preserve items when switching tabs", () => {
			stateManager.handleMessage({
				type: "state",
				state: { marketplaceItems: mockMarketplaceItems },
			})

			stateManager.transition({
				type: "SET_ACTIVE_TAB",
				payload: { tab: "mode" },
			})

			const state = stateManager.getState()
			expect(state.activeTab).toBe("mode")
			expect(state.allItems).toEqual(mockMarketplaceItems)
		})
	})

	describe("error handling", () => {
		it("should handle fetch errors", () => {
			// First load some items
			stateManager.handleMessage({
				type: "state",
				state: { marketplaceItems: mockMarketplaceItems },
			})

			// Then trigger an error
			stateManager.transition({ type: "FETCH_ERROR" })

			const state = stateManager.getState()
			expect(state.isFetching).toBe(false)
			// Items should be preserved during error
			expect(state.allItems).toEqual(mockMarketplaceItems)
		})
	})

	describe("state copying and immutability", () => {
		it("should return new arrays in getState to prevent mutation", () => {
			const state1 = stateManager.getState()
			const state2 = stateManager.getState()

			expect(state1.allItems).not.toBe(state2.allItems)
			expect(state1.filters.tags).not.toBe(state2.filters.tags)
		})

		it("should not mutate original state when modifying returned state", () => {
			stateManager.handleMessage({
				type: "state",
				state: { marketplaceItems: mockMarketplaceItems },
			})

			const state = stateManager.getState()
			state.allItems.push({
				id: "mutated",
				name: "Mutated Item",
				description: "Should not affect original",
				type: "mcp",
				url: "https://example.com/mutated",
				content: "test",
			})

			const newState = stateManager.getState()
			expect(newState.allItems.length).toBe(mockMarketplaceItems.length)
			expect(newState.allItems.find((item) => item.id === "mutated")).toBeUndefined()
		})
	})
})
