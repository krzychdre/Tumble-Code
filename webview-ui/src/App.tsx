import React, { Suspense, useCallback, useEffect, useRef, useState, useMemo } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

import { SETTINGS_DEFAULTS, type ExtensionMessage } from "@tumble-code/types"

import { TranslationProvider, useAppTranslation } from "./i18n/TranslationContext"
import { MarketplaceViewStateManager } from "./components/marketplace/MarketplaceViewStateManager"

import { vscode } from "./utils/vscode"
import { useExtensionMessage } from "./utils/extensionBus"
import { lazyTab } from "./utils/lazyTab"
import { initializeSourceMaps, exposeSourceMapsForDebugging } from "./utils/sourceMapInitializer"
import { ExtensionStateContextProvider, useExtensionSelector } from "./context/ExtensionStateContext"
import ChatView, { ChatViewRef } from "./components/chat/ChatView"
import HistoryView from "./components/history/HistoryView"
import SettingsView, { SettingsViewRef } from "./components/settings/SettingsView"
import WelcomeView from "./components/welcome/WelcomeViewProvider"
import { CheckpointRestoreDialog } from "./components/chat/CheckpointRestoreDialog"
import { DeleteMessageDialog, EditMessageDialog } from "./components/chat/MessageModificationConfirmationDialog"
import ErrorBoundary from "./components/ErrorBoundary"
import { Spinner } from "./components/ui"
import { useAddNonInteractiveClickListener } from "./components/ui/hooks/useAddNonInteractiveClickListener"
import { useAutoApproveFrameAccent } from "./hooks/useAutoApproveFrameAccent"
import { TooltipProvider } from "./components/ui/tooltip"
import { STANDARD_TOOLTIP_DELAY } from "./components/ui/standard-tooltip"

// The Marketplace and Cloud views are off the chat critical path: each becomes
// its own chunk fetched on first open (P4). The chat view itself, Settings and
// History stay eager (Settings is the welcome-gate recovery path). lazyTab
// turns a chunk lost to a reinstall under a running window into a reload notice.
const MarketplaceView = lazyTab(() =>
	import("./components/marketplace/MarketplaceView").then((module) => ({ default: module.MarketplaceView })),
)
const CloudView = lazyTab(() =>
	import("./components/cloud/CloudView").then((module) => ({ default: module.CloudView })),
)

// Subtle fallback while a lazy tab's chunk arrives: the standard spinner.
const TabLoadingFallback = () => {
	const { t } = useAppTranslation()
	return (
		<div className="flex flex-1 items-center justify-center" data-testid="tab-loading">
			<Spinner label={t("common:loading")} />
		</div>
	)
}

type Tab = "settings" | "history" | "chat" | "marketplace" | "cloud"

interface DeleteMessageDialogState {
	isOpen: boolean
	messageTs: number
	hasCheckpoint: boolean
}

interface EditMessageDialogState {
	isOpen: boolean
	messageTs: number
	text: string
	hasCheckpoint: boolean
	images?: string[]
}

// Memoize dialog components to prevent unnecessary re-renders
const MemoizedDeleteMessageDialog = React.memo(DeleteMessageDialog)
const MemoizedEditMessageDialog = React.memo(EditMessageDialog)
const MemoizedCheckpointRestoreDialog = React.memo(CheckpointRestoreDialog)
const tabsByMessageAction: Partial<Record<NonNullable<ExtensionMessage["action"]>, Tab>> = {
	chatButtonClicked: "chat",
	settingsButtonClicked: "settings",
	historyButtonClicked: "history",
	marketplaceButtonClicked: "marketplace",
	cloudButtonClicked: "cloud",
}

const App = () => {
	// P1: narrow slices. App used to consume the whole extension state, so
	// every streamed token re-rendered the entire tab tree.
	const didHydrateState = useExtensionSelector((s) => s.didHydrateState)
	const showWelcome = useExtensionSelector((s) => s.showWelcome)
	const settingsImportedAt = useExtensionSelector((s) => s.settingsImportedAt)
	// §2.1 (ai_plans/2026-09-27_ui-modernization.md): the density choice rides
	// the root element, so the spacing tokens in index.css follow the setting.
	const uiDensity = useExtensionSelector((s) => s.uiDensity ?? SETTINGS_DEFAULTS.uiDensity)
	const shouldShowAnnouncement = useExtensionSelector((s) => s.shouldShowAnnouncement)
	const cloudUserInfo = useExtensionSelector((s) => s.cloudUserInfo)
	const cloudIsAuthenticated = useExtensionSelector((s) => s.cloudIsAuthenticated)
	const cloudApiUrl = useExtensionSelector((s) => s.cloudApiUrl)
	const cloudOrganizations = useExtensionSelector((s) => s.cloudOrganizations)
	const renderContext = useExtensionSelector((s) => s.renderContext)
	useAutoApproveFrameAccent()

	// Create a persistent state manager
	const marketplaceStateManager = useMemo(() => new MarketplaceViewStateManager(), [])

	const [showAnnouncement, setShowAnnouncement] = useState(false)
	const [tab, setTab] = useState<Tab>("chat")

	const [deleteMessageDialogState, setDeleteMessageDialogState] = useState<DeleteMessageDialogState>({
		isOpen: false,
		messageTs: 0,
		hasCheckpoint: false,
	})

	const [editMessageDialogState, setEditMessageDialogState] = useState<EditMessageDialogState>({
		isOpen: false,
		messageTs: 0,
		text: "",
		hasCheckpoint: false,
		images: [],
	})

	const settingsRef = useRef<SettingsViewRef>(null)
	const chatViewRef = useRef<ChatViewRef>(null)
	const handledImportRef = useRef<number | undefined>(undefined)

	const switchTab = useCallback((newTab: Tab) => {
		setCurrentSection(undefined)
		setCurrentMarketplaceTab(undefined)

		if (settingsRef.current?.checkUnsaveChanges) {
			settingsRef.current.checkUnsaveChanges(() => setTab(newTab))
		} else {
			setTab(newTab)
		}
	}, [])

	const [currentSection, setCurrentSection] = useState<string | undefined>(undefined)
	const [currentMarketplaceTab, setCurrentMarketplaceTab] = useState<string | undefined>(undefined)

	const onMessage = useCallback(
		(message: ExtensionMessage) => {
			if (message.type === "action" && message.action) {
				// Handle switchTab action with tab parameter
				if (message.action === "switchTab" && message.tab) {
					const targetTab = message.tab as Tab
					switchTab(targetTab)
					// Extract targetSection from values if provided
					const targetSection = message.values?.section as string | undefined
					setCurrentSection(targetSection)
					setCurrentMarketplaceTab(undefined)
				} else {
					// Handle other actions using the mapping
					const newTab = tabsByMessageAction[message.action]
					const section = message.values?.section as string | undefined
					const marketplaceTab = message.values?.marketplaceTab as string | undefined

					if (newTab) {
						switchTab(newTab)
						setCurrentSection(section)
						setCurrentMarketplaceTab(marketplaceTab)
					}
				}
			}

			if (message.type === "showDeleteMessageDialog" && message.messageTs) {
				setDeleteMessageDialogState({
					isOpen: true,
					messageTs: message.messageTs,
					hasCheckpoint: message.hasCheckpoint || false,
				})
			}

			if (message.type === "showEditMessageDialog" && message.messageTs && message.text) {
				setEditMessageDialogState({
					isOpen: true,
					messageTs: message.messageTs,
					text: message.text,
					hasCheckpoint: message.hasCheckpoint || false,
					images: message.images || [],
				})
			}

			if (message.type === "acceptInput") {
				chatViewRef.current?.acceptInput()
			}
		},
		[switchTab],
	)

	useExtensionMessage(["action", "showDeleteMessageDialog", "showEditMessageDialog", "acceptInput"], onMessage)

	useEffect(() => {
		if (shouldShowAnnouncement && tab === "chat") {
			setShowAnnouncement(true)
			vscode.postMessage({ type: "didShowAnnouncement" })
		}
	}, [shouldShowAnnouncement, tab])

	// When settings are imported while the welcome screen is still gating the UI
	// (e.g. the import cleared the provider config), make sure the user is not
	// stranded. Recover by routing them into Settings unless they are already on a
	// reachable tab (settings or marketplace). Runs once per import via the ref guard.
	useEffect(() => {
		const isRecoverableTab = tab === "settings" || tab === "marketplace"
		if (showWelcome && settingsImportedAt && settingsImportedAt !== handledImportRef.current) {
			handledImportRef.current = settingsImportedAt
			if (!isRecoverableTab) {
				setCurrentSection("providers")
				setCurrentMarketplaceTab(undefined)
				setTab("settings")
			}
		}
	}, [showWelcome, settingsImportedAt, tab])

	// Initialize source map support for better error reporting
	useEffect(() => {
		// Initialize source maps for better error reporting in production
		initializeSourceMaps()

		// Expose source map debugging utilities in production
		if (process.env.NODE_ENV === "production") {
			exposeSourceMapsForDebugging()
		}

		// Log initialization for debugging
		console.debug("App initialized with source map support")
	}, [])

	// Focus the WebView when non-interactive content is clicked (only in editor/tab mode)
	useAddNonInteractiveClickListener(
		useCallback(() => {
			// Only send focus request if we're in editor (tab) mode, not sidebar
			if (renderContext === "editor") {
				vscode.postMessage({ type: "focusPanelRequest" })
			}
		}, [renderContext]),
	)
	// §2.1 (ai_plans/2026-09-27_ui-modernization.md): publish the density
	// choice as a data attribute on the root, where the spacing tokens read it.
	useEffect(() => {
		document.documentElement.setAttribute("data-density", uiDensity)
	}, [uiDensity])

	if (!didHydrateState) {
		return null
	}

	// Do not conditionally load ChatView, it's expensive and there's state we
	// don't want to lose (user input, disableInput, askResponse promise, etc.)
	// Keep Settings and Marketplace reachable even while onboarding is gating the
	// rest of the UI, so an imported-but-incomplete config can still be recovered.
	const isSetupGatedTab = showWelcome && tab !== "settings" && tab !== "marketplace"
	return isSetupGatedTab ? (
		<WelcomeView />
	) : (
		<>
			{tab === "history" && <HistoryView onDone={() => switchTab("chat")} />}
			{tab === "settings" && (
				<SettingsView ref={settingsRef} onDone={() => setTab("chat")} targetSection={currentSection} />
			)}
			{tab === "marketplace" && (
				<Suspense fallback={<TabLoadingFallback />}>
					<MarketplaceView
						stateManager={marketplaceStateManager}
						onDone={() => switchTab("chat")}
						targetTab={currentMarketplaceTab as "mcp" | "mode" | undefined}
					/>
				</Suspense>
			)}
			{tab === "cloud" && (
				<Suspense fallback={<TabLoadingFallback />}>
					<CloudView
						userInfo={cloudUserInfo}
						isAuthenticated={cloudIsAuthenticated}
						cloudApiUrl={cloudApiUrl}
						organizations={cloudOrganizations}
					/>
				</Suspense>
			)}
			<ChatView
				ref={chatViewRef}
				isHidden={tab !== "chat"}
				showAnnouncement={showAnnouncement}
				hideAnnouncement={() => setShowAnnouncement(false)}
			/>
			{deleteMessageDialogState.hasCheckpoint ? (
				<MemoizedCheckpointRestoreDialog
					open={deleteMessageDialogState.isOpen}
					type="delete"
					hasCheckpoint={deleteMessageDialogState.hasCheckpoint}
					onOpenChange={(open: boolean) => setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={(restoreCheckpoint: boolean) => {
						vscode.postMessage({
							type: "deleteMessageConfirm",
							messageTs: deleteMessageDialogState.messageTs,
							restoreCheckpoint,
						})
						setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			) : (
				<MemoizedDeleteMessageDialog
					open={deleteMessageDialogState.isOpen}
					onOpenChange={(open: boolean) => setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={() => {
						vscode.postMessage({
							type: "deleteMessageConfirm",
							messageTs: deleteMessageDialogState.messageTs,
						})
						setDeleteMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			)}
			{editMessageDialogState.hasCheckpoint ? (
				<MemoizedCheckpointRestoreDialog
					open={editMessageDialogState.isOpen}
					type="edit"
					hasCheckpoint={editMessageDialogState.hasCheckpoint}
					onOpenChange={(open: boolean) => setEditMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={(restoreCheckpoint: boolean) => {
						vscode.postMessage({
							type: "editMessageConfirm",
							messageTs: editMessageDialogState.messageTs,
							text: editMessageDialogState.text,
							restoreCheckpoint,
						})
						setEditMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			) : (
				<MemoizedEditMessageDialog
					open={editMessageDialogState.isOpen}
					onOpenChange={(open: boolean) => setEditMessageDialogState((prev) => ({ ...prev, isOpen: open }))}
					onConfirm={() => {
						vscode.postMessage({
							type: "editMessageConfirm",
							messageTs: editMessageDialogState.messageTs,
							text: editMessageDialogState.text,
							images: editMessageDialogState.images,
						})
						setEditMessageDialogState((prev) => ({ ...prev, isOpen: false }))
					}}
				/>
			)}
		</>
	)
}

const queryClient = new QueryClient()

const AppWithProviders = () => (
	<ErrorBoundary>
		<ExtensionStateContextProvider>
			<TranslationProvider>
				<QueryClientProvider client={queryClient}>
					<TooltipProvider delayDuration={STANDARD_TOOLTIP_DELAY}>
						<App />
					</TooltipProvider>
				</QueryClientProvider>
			</TranslationProvider>
		</ExtensionStateContextProvider>
	</ErrorBoundary>
)

export default AppWithProviders
