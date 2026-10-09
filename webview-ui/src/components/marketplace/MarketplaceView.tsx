import { useState, useEffect, useMemo, useContext } from "react"
import { Tab, TabContent, TabHeader, TabTitle } from "../common/Tab"
import { MarketplaceViewStateManager } from "./MarketplaceViewStateManager"
import { useStateManager } from "./useStateManager"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { MarketplaceListView } from "./MarketplaceListView"
import { cn } from "@/lib/utils"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"

/** One tab of the MCP / Modes strip: description colour until active, a hover fill and the focus ring. */
const tabClass = (active: boolean) =>
	cn(
		"cursor-pointer flex items-center justify-center gap-2 flex-1 h-[26px] text-sm font-medium transition-colors relative z-10 bg-transparent border-0",
		"hover:bg-surface-hover hover:text-vscode-foreground focus-ring",
		active ? "text-vscode-foreground" : "text-vscode-descriptionForeground",
	)

interface MarketplaceViewProps {
	onDone?: () => void
	stateManager: MarketplaceViewStateManager
	targetTab?: "mcp" | "mode"
}
export function MarketplaceView({ stateManager, onDone, targetTab }: MarketplaceViewProps) {
	const { t } = useAppTranslation()
	const [state, manager] = useStateManager(stateManager)
	const [hasReceivedInitialState, setHasReceivedInitialState] = useState(false)
	const extensionState = useContext(ExtensionStateContext)
	const [lastOrganizationSettingsVersion, setLastOrganizationSettingsVersion] = useState<number>(
		extensionState?.organizationSettingsVersion ?? -1,
	)

	useEffect(() => {
		const currentVersion = extensionState?.organizationSettingsVersion ?? -1
		if (currentVersion !== lastOrganizationSettingsVersion) {
			vscode.postMessage({
				type: "fetchMarketplaceData",
			})
		}
		setLastOrganizationSettingsVersion(currentVersion)
	}, [extensionState?.organizationSettingsVersion, lastOrganizationSettingsVersion])

	// Track when we receive the initial state
	useEffect(() => {
		// Check if we already have items (state might have been received before mount)
		if (state.allItems.length > 0 && !hasReceivedInitialState) {
			setHasReceivedInitialState(true)
		}
	}, [state.allItems, hasReceivedInitialState])

	useEffect(() => {
		if (targetTab && (targetTab === "mcp" || targetTab === "mode")) {
			manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: targetTab } })
		}
	}, [targetTab, manager])

	// Ensure marketplace state manager processes messages when component mounts
	useEffect(() => {
		// When the marketplace view first mounts, we need to trigger a state update
		// to ensure we get the current marketplace items. We do this by sending
		// a filter message with empty filters, which will cause the extension to
		// send back the full state including all marketplace items.
		if (!hasReceivedInitialState && state.allItems.length === 0) {
			// Fetch marketplace data on demand
			// Note: isFetching is already true by default for initial load
			vscode.postMessage({
				type: "fetchMarketplaceData",
			})
		}

		// Listen for state changes to know when initial data arrives
		const unsubscribe = manager.onStateChange((newState) => {
			// Mark as received initial state when we get any state update
			// This prevents infinite loops and ensures proper state handling
			if (!hasReceivedInitialState && (newState.allItems.length > 0 || newState.displayItems !== undefined)) {
				setHasReceivedInitialState(true)
			}
		})

		return () => {
			unsubscribe()
		}
	}, [manager, hasReceivedInitialState, state.allItems.length])

	// Memoize all available tags
	const allTags = useMemo(
		() => Array.from(new Set(state.allItems.flatMap((item) => item.tags || []))).sort(),
		[state.allItems],
	)

	// Memoize filtered tags
	const filteredTags = useMemo(() => allTags, [allTags])

	return (
		<TooltipProvider delayDuration={300}>
			<Tab>
				<TabHeader className="flex flex-col sticky top-0 z-10 px-3 py-2">
					<div className="flex items-center justify-between gap-2 px-2">
						<TabTitle
							title={t("marketplace:title")}
							backLabel={t("settings:back")}
							onBack={() => onDone?.()}
						/>
					</div>

					<div className="w-full mt-2">
						<div className="flex relative border-b border-frame">
							<div
								className={cn(
									"absolute w-1/2 h-[2px] -bottom-px bg-vscode-focusBorder transition-all duration-300 ease-in-out z-20",
									{
										"left-0": state.activeTab === "mcp",
										"left-1/2": state.activeTab === "mode",
									},
								)}
							/>
							<button
								className={tabClass(state.activeTab === "mcp")}
								onClick={() => manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: "mcp" } })}>
								MCP
							</button>
							<button
								className={tabClass(state.activeTab === "mode")}
								onClick={() =>
									manager.transition({ type: "SET_ACTIVE_TAB", payload: { tab: "mode" } })
								}>
								Modes
							</button>
						</div>
					</div>
				</TabHeader>

				<TabContent className="p-3 pt-2">
					{state.activeTab === "mcp" && (
						<MarketplaceListView
							stateManager={stateManager}
							allTags={allTags}
							filteredTags={filteredTags}
							filterByType="mcp"
						/>
					)}
					{state.activeTab === "mode" && (
						<MarketplaceListView
							stateManager={stateManager}
							allTags={allTags}
							filteredTags={filteredTags}
							filterByType="mode"
						/>
					)}
				</TabContent>
			</Tab>
		</TooltipProvider>
	)
}
