import React, {
	Suspense,
	forwardRef,
	lazy,
	memo,
	useCallback,
	useEffect,
	useImperativeHandle,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import {
	CheckCheck,
	Bot,
	GitBranch,
	Bell,
	Brain,
	Database,
	SquareTerminal,
	FlaskConical,
	Globe,
	Info,
	MessageSquare,
	LucideIcon,
	SquareSlash,
	Glasses,
	Plug,
	Server,
	Users2,
	GitCommitVertical,
	GlobeLock,
	GraduationCap,
} from "lucide-react"

import { vscode } from "@src/utils/vscode"
import { cn } from "@src/lib/utils"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import {
	Button,
	Spinner,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
	StandardTooltip,
} from "@src/components/ui"

import { Tab, TabContent, TabHeader, TabList, TabTitle, TabTrigger } from "../common/Tab"
import StorageErrorBanner from "../common/StorageErrorBanner"
import { DiscardChangesDialog } from "../common/DiscardChangesDialog"
import { buildUpdatedSettings } from "./schema"
import { useCachedSettings } from "./useCachedSettings"
import { SettingsDraftProvider } from "./SettingsDraftContext"
import { SectionHeader } from "./SectionHeader"
import ApiConfigManager from "./ApiConfigManager"
import ApiOptions from "./ApiOptions"
import { AutoApproveSettings } from "./AutoApproveSettings"
import { CheckpointSettings } from "./CheckpointSettings"
import { MemorySettings } from "./MemorySettings"
import { WebToolsSettings } from "./WebToolsSettings"
import { NotificationSettings } from "./NotificationSettings"
import { ContextManagementSettings } from "./ContextManagementSettings"
import { SubagentSettings } from "./SubagentSettings"
import { TerminalSettings } from "./TerminalSettings"
import { ExperimentalSettings } from "./ExperimentalSettings"
import { LanguageSettings } from "./LanguageSettings"
import { About } from "./About"
import { Section } from "./Section"
import PromptsSettings from "./PromptsSettings"
import { SlashCommandsSettings } from "./SlashCommandsSettings"
import { SkillsSettings } from "./SkillsSettings"
import { UISettings } from "./UISettings"
import { WorktreesView } from "../worktrees/WorktreesView"
import { SettingsSearch } from "./SettingsSearch"
import { useSearchIndexRegistry, SearchIndexProvider } from "./useSettingsSearch"
import { resolveStaticSearchIndex } from "./settingsSearchIndex"
import { onExtensionMessage } from "@src/utils/extensionBus"

// The Modes and MCP tabs are large modules off the chat critical path: each
// becomes its own chunk fetched on first open (P4). All other settings
// sections stay eager.
const ModesView = lazy(() => import("../modes/ModesView"))
const McpView = lazy(() => import("../mcp/McpView"))

// Subtle fallback while a lazy tab's chunk arrives: the standard spinner.
const TabLoadingFallback = () => {
	const { t } = useAppTranslation()
	return (
		<div className="flex flex-1 items-center justify-center" data-testid="tab-loading">
			<Spinner label={t("common:loading")} />
		</div>
	)
}

export const settingsTabsContainer = "flex flex-1 overflow-hidden [&.narrow_.tab-label]:hidden"
export const settingsTabList =
	"w-48 data-[compact=true]:w-12 flex-shrink-0 flex flex-col overflow-y-auto overflow-x-hidden border-r border-vscode-sideBar-background"
export const settingsTabTrigger =
	"whitespace-nowrap overflow-hidden min-w-0 h-12 px-4 py-3 box-border flex items-center border-l-2 border-transparent text-vscode-foreground opacity-70 hover:bg-vscode-list-hoverBackground data-[compact=true]:w-12 data-[compact=true]:p-4"
export const settingsTabTriggerActive = "opacity-100 border-vscode-focusBorder bg-vscode-list-activeSelectionBackground"

export interface SettingsViewRef {
	checkUnsaveChanges: (then: () => void) => void
}

export const sectionNames = [
	"providers",
	"autoApprove",
	"slashCommands",
	"skills",
	"checkpoints",
	"memory",
	"web",
	"notifications",
	"contextManagement",
	"terminal",
	"modes",
	"mcp",
	"worktrees",
	"subagents",
	"prompts",
	"ui",
	"experimental",
	"language",
	"about",
] as const

export type SectionName = (typeof sectionNames)[number]

/**
 * §2.10: marks unsaved edits on the Save button and on each tab that has
 * them. A small square (square corners, §1) in the text colour, decorative:
 * the tab adds screen-reader text and Save is only enabled when dirty.
 */
const UnsavedDot = ({ className }: { className?: string }) => (
	<span
		data-testid="unsaved-dot"
		aria-hidden="true"
		className={cn("inline-block size-1.5 shrink-0 bg-current", className)}
	/>
)

type SettingsViewProps = {
	onDone: () => void
	targetSection?: string
}

const SettingsView = forwardRef<SettingsViewRef, SettingsViewProps>(({ onDone, targetSection }, ref) => {
	const { t } = useAppTranslation()

	const extensionState = useExtensionState()
	const { currentApiConfigName, listApiConfigMeta, uriScheme, settingsImportedAt } = extensionState

	const [isDiscardDialogShow, setDiscardDialogShow] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
	const [activeTab, setActiveTab] = useState<SectionName>(
		targetSection && sectionNames.includes(targetSection as SectionName)
			? (targetSection as SectionName)
			: "providers",
	)

	const scrollPositions = useRef<Record<SectionName, number>>(
		Object.fromEntries(sectionNames.map((s) => [s, 0])) as Record<SectionName, number>,
	)
	const contentRef = useRef<HTMLDivElement | null>(null)

	const prevApiConfigName = useRef(currentApiConfigName)
	const confirmDialogHandler = useRef<(() => void) | undefined>(undefined)

	const {
		store: draftStore,
		cachedState: settings,
		isChangeDetected,
		dirtyScopes,
		setChangeDetected,
		setApiConfigurationField,
		mergeFromState,
		resetToState,
	} = useCachedSettings(extensionState)

	const apiConfiguration = useMemo(() => settings.apiConfiguration ?? {}, [settings.apiConfiguration])

	useEffect(() => {
		// Update only when currentApiConfigName is changed.
		// Expected to be triggered by loadApiConfiguration/upsertApiConfiguration.
		if (prevApiConfigName.current === currentApiConfigName) {
			return
		}

		mergeFromState(extensionState)
		prevApiConfigName.current = currentApiConfigName
	}, [currentApiConfigName, extensionState, mergeFromState])

	// Bust the cache when settings are imported, once per import. The host
	// clears settingsImportedAt with `undefined` right after the import push,
	// but postMessage drops undefined values and mergeExtensionState keeps the
	// old timestamp, so the flag stays truthy for every later state push. React
	// to a new timestamp only, otherwise unrelated updates discard unsaved edits.
	// Seeded with the value at mount: the buffer already starts from the
	// imported state, so a timestamp left over from an earlier import is handled.
	const handledImportRef = useRef(settingsImportedAt)
	useEffect(() => {
		if (settingsImportedAt && settingsImportedAt !== handledImportRef.current) {
			handledImportRef.current = settingsImportedAt
			mergeFromState(extensionState)
		}
	}, [settingsImportedAt, extensionState, mergeFromState])

	const isSettingValid = !errorMessage

	const handleSubmit = () => {
		if (isSettingValid) {
			vscode.postMessage({ type: "updateSettings", updatedSettings: buildUpdatedSettings(settings) })

			// These have more complex logic so they aren't (yet) handled
			// by the `updateSettings` message.
			vscode.postMessage({ type: "upsertApiConfiguration", text: currentApiConfigName, apiConfiguration })
			vscode.postMessage({ type: "telemetrySetting", text: settings.telemetrySetting })
			vscode.postMessage({ type: "debugSetting", bool: settings.debug })

			setChangeDetected(false)
		}
	}

	const checkUnsaveChanges = useCallback(
		(then: () => void) => {
			if (isChangeDetected) {
				confirmDialogHandler.current = then
				setDiscardDialogShow(true)
			} else {
				then()
			}
		},
		[isChangeDetected],
	)

	useImperativeHandle(ref, () => ({ checkUnsaveChanges }), [checkUnsaveChanges])

	const onConfirmDialogResult = useCallback(
		(confirm: boolean) => {
			if (confirm) {
				// Discard changes: revert the buffer to the live state and clear the flag
				resetToState(extensionState)
				confirmDialogHandler.current?.() // Execute the pending action (e.g., tab switch)
			}
			// If confirm is false (Cancel), do nothing, dialog closes automatically
		},
		[extensionState, resetToState], // Depend on extensionState to get the latest original state
	)

	// Handle tab changes with unsaved changes check
	const handleTabChange = useCallback(
		(newTab: SectionName) => {
			if (contentRef.current) {
				scrollPositions.current[activeTab] = contentRef.current.scrollTop
			}
			setActiveTab(newTab)
		},
		[activeTab],
	)

	useLayoutEffect(() => {
		if (contentRef.current) {
			contentRef.current.scrollTop = scrollPositions.current[activeTab] ?? 0
		}
	}, [activeTab])

	// §2.10: edits are attributed to the open tab, so every tab with unsaved
	// edits gets a dot. Only the open tab is mounted, so its edits happen after
	// this runs.
	useLayoutEffect(() => {
		draftStore.setScope(activeTab)
	}, [draftStore, activeTab])

	// Store direct DOM element refs for each tab
	const tabRefs = useRef<Record<SectionName, HTMLButtonElement | null>>(
		Object.fromEntries(sectionNames.map((name) => [name, null])) as Record<SectionName, HTMLButtonElement | null>,
	)

	// Track whether we're in compact mode
	const [isCompactMode, setIsCompactMode] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	// Setup resize observer to detect when we should switch to compact mode
	useEffect(() => {
		if (!containerRef.current) return

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// If container width is less than 500px, switch to compact mode
				setIsCompactMode(entry.contentRect.width < 500)
			}
		})

		observer.observe(containerRef.current)

		return () => {
			observer?.disconnect()
		}
	}, [])

	const sections: { id: SectionName; icon: LucideIcon }[] = useMemo(
		() => [
			{ id: "providers", icon: Plug },
			{ id: "modes", icon: Users2 },
			{ id: "skills", icon: GraduationCap },
			{ id: "slashCommands", icon: SquareSlash },
			{ id: "autoApprove", icon: CheckCheck },
			{ id: "mcp", icon: Server },
			{ id: "checkpoints", icon: GitCommitVertical },
			{ id: "memory", icon: Brain },
			{ id: "web", icon: GlobeLock },
			{ id: "notifications", icon: Bell },
			{ id: "contextManagement", icon: Database },
			{ id: "terminal", icon: SquareTerminal },
			{ id: "prompts", icon: MessageSquare },
			{ id: "worktrees", icon: GitBranch },
			{ id: "subagents", icon: Bot },
			{ id: "ui", icon: Glasses },
			{ id: "experimental", icon: FlaskConical },
			{ id: "language", icon: Globe },
			{ id: "about", icon: Info },
		],
		[], // No dependencies needed now
	)

	// Update target section logic to set active tab
	useEffect(() => {
		if (targetSection && sectionNames.includes(targetSection as SectionName)) {
			setActiveTab(targetSection as SectionName)
		}
	}, [targetSection])

	// Function to scroll the active tab into view for vertical layout
	const scrollToActiveTab = useCallback(() => {
		const activeTabElement = tabRefs.current[activeTab]

		if (activeTabElement) {
			activeTabElement.scrollIntoView({
				behavior: "auto",
				block: "nearest",
			})
		}
	}, [activeTab])

	// Effect to scroll when the active tab changes
	useEffect(() => {
		scrollToActiveTab()
	}, [activeTab, scrollToActiveTab])

	// Effect to scroll when the webview becomes visible
	useLayoutEffect(() => {
		return onExtensionMessage("action", (message) => {
			if (message.action === "didBecomeVisible") {
				scrollToActiveTab()
			}
		})
	}, [scrollToActiveTab])

	// Search index: a static, declarative index (tab titles, Modes/MCP
	// headings, experiment flags) is available immediately, so search never
	// needs to mount tabs. Eager tabs still augment the index at runtime via
	// SearchableSetting registration (batched by the registry).
	const getSectionLabel = useCallback((section: SectionName) => t(`settings:sections.${section}`), [t])
	const { contextValue: searchContextValue, index: runtimeIndex } = useSearchIndexRegistry(getSectionLabel)

	const staticIndex = useMemo(() => resolveStaticSearchIndex(t, getSectionLabel), [t, getSectionLabel])

	const searchIndex = useMemo(() => {
		// Static entries are keyed with their own ids (`tab-*`, `modes-*`,
		// `mcp-*`, `experimental-*`); runtime entries use the setting ids the
		// components pass. Neither set can collide, and since the lazy
		// Modes/MCP tabs never register at runtime, nothing double-lists.
		const merged = new Map(staticIndex.map((entry) => [entry.settingId, entry]))
		for (const entry of runtimeIndex) {
			merged.set(entry.settingId, entry)
		}
		return Array.from(merged.values())
	}, [staticIndex, runtimeIndex])

	// Render only the active tab (no indexing cycle that force-mounts tabs).
	const renderTab = activeTab

	// Handle search navigation - switch to the correct tab and scroll to the element
	const handleSearchNavigate = useCallback(
		(section: SectionName, settingId: string) => {
			// Switch to the correct tab
			handleTabChange(section)

			// Wait for the tab to render, then find element by settingId and scroll to it
			requestAnimationFrame(() => {
				setTimeout(() => {
					const element = document.querySelector(`[data-setting-id="${settingId}"]`)
					if (element) {
						element.scrollIntoView({ behavior: "smooth", block: "center" })

						// Add highlight animation
						element.classList.add("settings-highlight")
						setTimeout(() => {
							element.classList.remove("settings-highlight")
						}, 1500)
					}
				}, 100) // Small delay to ensure tab content is rendered
			})
		},
		[handleTabChange],
	)

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center gap-2">
				<div className="grow">
					<TabTitle
						title={t("settings:header.title")}
						backLabel={t("settings:common.done")}
						backTooltip={t("settings:header.doneButtonTooltip")}
						onBack={() => checkUnsaveChanges(onDone)}
					/>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					<SettingsSearch index={searchIndex} onNavigate={handleSearchNavigate} sections={sections} />
					<StandardTooltip
						content={
							!isSettingValid
								? errorMessage
								: isChangeDetected
									? t("settings:header.saveButtonTooltip")
									: t("settings:header.nothingChangedTooltip")
						}>
						<Button
							variant={isSettingValid ? "primary" : "secondary"}
							className={!isSettingValid ? "!border-vscode-errorForeground" : ""}
							onClick={handleSubmit}
							disabled={!isChangeDetected || !isSettingValid}
							data-testid="save-button">
							{t("settings:common.save")}
							{isChangeDetected && <UnsavedDot className="ml-1.5" />}
						</Button>
					</StandardTooltip>
				</div>
			</TabHeader>

			<StorageErrorBanner />

			{/* Vertical tabs layout */}
			<div ref={containerRef} className={cn(settingsTabsContainer, isCompactMode && "narrow")}>
				{/* Tab sidebar */}
				<TabList
					value={activeTab}
					onValueChange={(value) => handleTabChange(value as SectionName)}
					className={cn(settingsTabList)}
					data-compact={isCompactMode}
					data-testid="settings-tab-list">
					{sections.map(({ id, icon: Icon }) => {
						const isSelected = id === activeTab
						const hasUnsavedEdits = dirtyScopes.has(id)
						const onSelect = () => handleTabChange(id)

						// Base TabTrigger component definition
						// We pass isSelected manually for styling, but onSelect is handled conditionally
						const triggerComponent = (
							<TabTrigger
								ref={(element) => {
									tabRefs.current[id] = element
								}}
								value={id}
								isSelected={isSelected} // Pass manually for styling state
								className={cn(
									isSelected // Use manual isSelected for styling
										? `${settingsTabTrigger} ${settingsTabTriggerActive}`
										: settingsTabTrigger,
									"cursor-pointer",
								)}
								data-testid={`tab-${id}`}
								data-unsaved={hasUnsavedEdits}
								data-compact={isCompactMode}>
								<div className={cn("flex items-center gap-2", isCompactMode && "justify-center")}>
									<Icon className="w-4 h-4" />
									<span className="tab-label">{t(`settings:sections.${id}`)}</span>
									{hasUnsavedEdits && (
										<>
											<UnsavedDot />
											<span className="sr-only">{t("settings:header.unsavedChanges")}</span>
										</>
									)}
								</div>
							</TabTrigger>
						)

						if (isCompactMode) {
							// Wrap in Tooltip and manually add onClick to the trigger
							return (
								<TooltipProvider key={id} delayDuration={300}>
									<Tooltip>
										<TooltipTrigger asChild onClick={onSelect}>
											{/* Clone to avoid ref issues if triggerComponent itself had a key */}
											{React.cloneElement(triggerComponent)}
										</TooltipTrigger>
										<TooltipContent side="right" className="text-base">
											<p className="m-0">{t(`settings:sections.${id}`)}</p>
										</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							)
						} else {
							// Render trigger directly; TabList will inject onSelect via cloning
							// Ensure the element passed to TabList has the key
							return React.cloneElement(triggerComponent, { key: id })
						}
					})}
				</TabList>

				{/* Content area - renders only the active tab */}
				<TabContent ref={contentRef} className={cn("p-0 flex-1 overflow-auto")} data-testid="settings-content">
					<SettingsDraftProvider value={draftStore}>
						<SearchIndexProvider value={searchContextValue}>
							{/* Providers Section */}
							{renderTab === "providers" && (
								<div>
									<SectionHeader>{t("settings:sections.providers")}</SectionHeader>

									<Section>
										<ApiConfigManager
											currentApiConfigName={currentApiConfigName}
											listApiConfigMeta={listApiConfigMeta}
											onSelectConfig={(configName: string) =>
												checkUnsaveChanges(() =>
													vscode.postMessage({
														type: "loadApiConfiguration",
														text: configName,
													}),
												)
											}
											onDeleteConfig={(configName: string) =>
												vscode.postMessage({ type: "deleteApiConfiguration", text: configName })
											}
											onRenameConfig={(oldName: string, newName: string) => {
												vscode.postMessage({
													type: "renameApiConfiguration",
													values: { oldName, newName },
													apiConfiguration,
												})
												prevApiConfigName.current = newName
											}}
											onUpsertConfig={(configName: string) =>
												vscode.postMessage({
													type: "upsertApiConfiguration",
													text: configName,
													apiConfiguration,
												})
											}
										/>
										<ApiOptions
											uriScheme={uriScheme}
											apiConfiguration={apiConfiguration}
											setApiConfigurationField={setApiConfigurationField}
											errorMessage={errorMessage}
											setErrorMessage={setErrorMessage}
										/>
									</Section>
								</div>
							)}

							{/* Auto-Approve Section */}
							{renderTab === "autoApprove" && <AutoApproveSettings />}

							{/* Slash Commands Section */}
							{renderTab === "slashCommands" && <SlashCommandsSettings />}

							{/* Skills Section */}
							{renderTab === "skills" && <SkillsSettings />}

							{/* Checkpoints Section */}
							{renderTab === "checkpoints" && <CheckpointSettings />}

							{/* Memory Section */}
							{renderTab === "memory" && <MemorySettings listApiConfigMeta={listApiConfigMeta ?? []} />}

							{/* Web Tools Section */}
							{renderTab === "web" && <WebToolsSettings />}

							{/* Notifications Section */}
							{renderTab === "notifications" && <NotificationSettings />}

							{/* Context Management Section */}
							{renderTab === "contextManagement" && (
								<ContextManagementSettings listApiConfigMeta={listApiConfigMeta ?? []} />
							)}

							{/* Terminal Section */}
							{renderTab === "terminal" && (
								<TerminalSettings onTerminalProfilePickerOpened={() => setChangeDetected(true)} />
							)}

							{/* Modes Section */}
							{renderTab === "modes" && (
								<Suspense fallback={<TabLoadingFallback />}>
									<ModesView
										onSelectApiConfiguration={(configName: string) =>
											checkUnsaveChanges(() =>
												vscode.postMessage({ type: "loadApiConfiguration", text: configName }),
											)
										}
									/>
								</Suspense>
							)}

							{/* MCP Section */}
							{renderTab === "mcp" && (
								<Suspense fallback={<TabLoadingFallback />}>
									<McpView />
								</Suspense>
							)}

							{/* Worktrees Section */}
							{renderTab === "worktrees" && <WorktreesView />}

							{/* Subagents Section */}
							{renderTab === "subagents" && <SubagentSettings />}

							{/* Prompts Section */}
							{renderTab === "prompts" && <PromptsSettings />}

							{/* UI Section */}
							{renderTab === "ui" && <UISettings />}

							{/* Experimental Section */}
							{renderTab === "experimental" && <ExperimentalSettings />}

							{/* Language Section */}
							{renderTab === "language" && <LanguageSettings />}

							{/* About Section */}
							{renderTab === "about" && <About />}
						</SearchIndexProvider>
					</SettingsDraftProvider>
				</TabContent>
			</div>

			<DiscardChangesDialog
				open={isDiscardDialogShow}
				onOpenChange={setDiscardDialogShow}
				onResult={onConfirmDialogResult}
			/>
		</Tab>
	)
})

export default memo(SettingsView)
