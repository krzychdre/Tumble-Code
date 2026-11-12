import { ExtensionMessage, MarketplaceItem, MarketplaceInstalledMetadata, WebviewMessage } from "@tumble-code/types"

import { vscode } from "../../utils/vscode"

export interface ViewState {
	allItems: MarketplaceItem[]
	organizationMcps: MarketplaceItem[]
	isFetching: boolean
	activeTab: "mcp" | "mode"
	filters: {
		type: string
		search: string
		tags: string[]
		installed: "all" | "installed" | "not_installed" // Filter by installation status
	}
	installedMetadata?: MarketplaceInstalledMetadata // Installed metadata for filtering
}

type TransitionPayloads = {
	FETCH_ITEMS: undefined
	FETCH_COMPLETE: { items: MarketplaceItem[] }
	FETCH_ERROR: undefined
	SET_ACTIVE_TAB: { tab: ViewState["activeTab"] }
	UPDATE_FILTERS: { filters: Partial<ViewState["filters"]> }
}

export interface ViewStateTransition {
	type: keyof TransitionPayloads
	payload?: TransitionPayloads[keyof TransitionPayloads]
}

export type StateChangeHandler = (state: ViewState) => void

export function filterItems(
	items: MarketplaceItem[],
	filters: ViewState["filters"],
	installedMetadata?: MarketplaceInstalledMetadata,
): MarketplaceItem[] {
	const { type, search, tags, installed } = filters
	const searchLower = search?.toLowerCase()

	return items.filter((item) => {
		if (type && item.type !== type) {
			return false
		}

		if (searchLower) {
			const nameMatch = item.name.toLowerCase().includes(searchLower)
			const descriptionMatch = (item.description || "").toLowerCase().includes(searchLower)
			if (!nameMatch && !descriptionMatch) {
				return false
			}
		}

		if (tags.length > 0 && !item.tags?.some((tag) => tags.includes(tag))) {
			return false
		}

		if (installed !== "all" && installedMetadata) {
			const isInstalledGlobally = !!installedMetadata?.global?.[item.id]
			const isInstalledInProject = !!installedMetadata?.project?.[item.id]
			const isInstalled = isInstalledGlobally || isInstalledInProject

			if (installed === "installed" && !isInstalled) {
				return false
			}
			if (installed === "not_installed" && isInstalled) {
				return false
			}
		}

		return true
	})
}

/**
 * MarketplaceViewStateManager
 *
 * Manages the state for the marketplace view. Components subscribe through
 * useStateManager and derive the filtered lists with filterItems.
 */
export class MarketplaceViewStateManager {
	private state: ViewState = this.getDefaultState()
	private stateChangeHandlers: Set<StateChangeHandler> = new Set()

	private getDefaultState(): ViewState {
		return {
			allItems: [],
			organizationMcps: [],
			isFetching: true, // Start with loading state for initial load
			activeTab: "mcp",
			filters: {
				type: "",
				search: "",
				tags: [],
				installed: "all",
			},
		}
	}

	public initialize(): void {
		this.state = this.getDefaultState()
	}

	public onStateChange(handler: StateChangeHandler): () => void {
		this.stateChangeHandlers.add(handler)
		return () => this.stateChangeHandlers.delete(handler)
	}

	public cleanup(): void {
		// Reset fetching state
		if (this.state.isFetching) {
			this.state.isFetching = false
			this.notifyStateChange()
		}

		// Clear handlers but preserve state
		this.stateChangeHandlers.clear()
	}

	public getState(): ViewState {
		return {
			...this.state,
			allItems: [...this.state.allItems],
			organizationMcps: [...this.state.organizationMcps],
			filters: {
				...this.state.filters,
				tags: [...this.state.filters.tags],
			},
		}
	}

	private notifyStateChange(): void {
		const newState = this.getState()
		this.stateChangeHandlers.forEach((handler) => handler(newState))
	}

	public transition(transition: ViewStateTransition): void {
		switch (transition.type) {
			case "FETCH_ITEMS": {
				this.state = {
					...this.state,
					isFetching: true,
				}
				this.notifyStateChange()
				break
			}

			case "FETCH_COMPLETE": {
				const { items } = transition.payload as TransitionPayloads["FETCH_COMPLETE"]

				// Skip the update when the items are unchanged (keeps scroll position)
				if (JSON.stringify(items) === JSON.stringify(this.state.allItems)) {
					this.state = {
						...this.state,
						isFetching: false,
					}
					this.notifyStateChange()
					break
				}

				this.state = {
					...this.state,
					allItems: [...items],
					isFetching: false,
				}
				this.notifyStateChange()
				break
			}

			case "FETCH_ERROR": {
				// Preserve current filters and items
				const { filters, activeTab, allItems } = this.state

				this.state = {
					...this.getDefaultState(),
					filters,
					activeTab,
					allItems,
					isFetching: false,
				}
				this.notifyStateChange()
				break
			}

			case "SET_ACTIVE_TAB": {
				const { tab } = transition.payload as TransitionPayloads["SET_ACTIVE_TAB"]

				this.state = {
					...this.state,
					activeTab: tab,
				}
				this.notifyStateChange()
				break
			}

			case "UPDATE_FILTERS": {
				const { filters = {} } = (transition.payload as TransitionPayloads["UPDATE_FILTERS"]) || {}

				// Preserve existing values for undefined fields
				const updatedFilters = {
					type: filters.type !== undefined ? filters.type : this.state.filters.type,
					search: filters.search !== undefined ? filters.search : this.state.filters.search,
					tags: filters.tags !== undefined ? filters.tags : this.state.filters.tags,
					installed: filters.installed !== undefined ? filters.installed : this.state.filters.installed,
				}

				this.state = {
					...this.state,
					filters: updatedFilters,
				}

				vscode.postMessage({
					type: "filterMarketplaceItems",
					filters: updatedFilters,
				} as WebviewMessage)

				this.notifyStateChange()
				break
			}
		}
	}

	public handleMessage(message: ExtensionMessage): void {
		if (message.type === "state") {
			// state.marketplaceItems come from ClineProvider, see src/core/webview/ClineProvider.ts
			const marketplaceItems = message.state?.marketplaceItems

			if (marketplaceItems !== undefined) {
				this.state = {
					...this.state,
					isFetching: false,
					allItems: [...marketplaceItems],
					installedMetadata: message.state?.marketplaceInstalledMetadata || this.state.installedMetadata,
				}
			}

			this.notifyStateChange()
		}

		if (message.type === "marketplaceData") {
			const marketplaceItems = message.marketplaceItems

			if (marketplaceItems !== undefined) {
				this.state = {
					...this.state,
					isFetching: false,
					allItems: [...marketplaceItems],
					organizationMcps: [...(message.organizationMcps || [])],
					installedMetadata: message.marketplaceInstalledMetadata || this.state.installedMetadata,
				}
			}

			this.notifyStateChange()
		}
	}
}
