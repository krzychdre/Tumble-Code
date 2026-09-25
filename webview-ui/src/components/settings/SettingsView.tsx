import React, {
	forwardRef,
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
	ArrowLeft,
	GitCommitVertical,
	GlobeLock,
	GraduationCap,
} from "lucide-react"

import { vscode } from "@src/utils/vscode"
import { cn } from "@src/lib/utils"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, StandardTooltip } from "@src/components/ui"

import { Tab, TabContent, TabHeader, TabList, TabTrigger } from "../common/Tab"
import StorageErrorBanner from "../common/StorageErrorBanner"
import { DiscardChangesDialog } from "../common/DiscardChangesDialog"
import { buildUpdatedSettings } from "./schema"
import { useCachedSettings } from "./useCachedSettings"
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
import ModesView from "../modes/ModesView"
import McpView from "../mcp/McpView"
import { WorktreesView } from "../worktrees/WorktreesView"
import { SettingsSearch } from "./SettingsSearch"
import { useSearchIndexRegistry, SearchIndexProvider } from "./useSettingsSearch"

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
	const confirmDialogHandler = useRef<() => void>()

	const {
		cachedState: settings,
		isChangeDetected,
		setChangeDetected,
		setCachedStateField,
		setApiConfigurationField,
		setExperimentEnabled,
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
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "action" && message.action === "didBecomeVisible") {
				scrollToActiveTab()
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [scrollToActiveTab])

	// Search index registry - settings register themselves on mount
	const getSectionLabel = useCallback((section: SectionName) => t(`settings:sections.${section}`), [t])
	const { contextValue: searchContextValue, index: searchIndex } = useSearchIndexRegistry(getSectionLabel)

	// Track which tabs have been indexed (visited at least once)
	const [indexingTabIndex, setIndexingTabIndex] = useState(0)
	const initialTab = useRef<SectionName>(activeTab)
	const isIndexing = indexingTabIndex < sectionNames.length
	const isIndexingComplete = !isIndexing
	const tabTitlesRegistered = useRef(false)

	// Index all tabs by cycling through them on mount
	useLayoutEffect(() => {
		if (indexingTabIndex >= sectionNames.length) {
			// All tabs indexed, now register tab titles as searchable items
			if (!tabTitlesRegistered.current && searchContextValue) {
				sections.forEach(({ id }) => {
					const tabTitle = t(`settings:sections.${id}`)
					// Register each tab title as a searchable item
					// Using a special naming convention for tab titles: "tab-{sectionName}"
					searchContextValue.registerSetting({
						settingId: `tab-${id}`,
						section: id,
						label: tabTitle,
					})
				})
				tabTitlesRegistered.current = true
				// Return to initial tab
				setActiveTab(initialTab.current)
			}
			return
		}

		// Move to the next tab on next render
		setIndexingTabIndex((prev) => prev + 1)
	}, [indexingTabIndex, searchContextValue, sections, t])

	// Determine which tab content to render (for indexing or active display)
	const renderTab = isIndexing ? sectionNames[indexingTabIndex] : activeTab

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
				<div className="flex items-center gap-2 grow">
					<StandardTooltip content={t("settings:header.doneButtonTooltip")}>
						<Button variant="ghost" className="px-1.5 -ml-2" onClick={() => checkUnsaveChanges(onDone)}>
							<ArrowLeft />
							<span className="sr-only">{t("settings:common.done")}</span>
						</Button>
					</StandardTooltip>
					<h3 className="text-vscode-foreground m-0 flex-shrink-0">{t("settings:header.title")}</h3>
				</div>
				<div className="flex items-center gap-2 shrink-0">
					{isIndexingComplete && (
						<SettingsSearch index={searchIndex} onNavigate={handleSearchNavigate} sections={sections} />
					)}
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
						const onSelect = () => handleTabChange(id)

						// Base TabTrigger component definition
						// We pass isSelected manually for styling, but onSelect is handled conditionally
						const triggerComponent = (
							<TabTrigger
								ref={(element) => (tabRefs.current[id] = element)}
								value={id}
								isSelected={isSelected} // Pass manually for styling state
								className={cn(
									isSelected // Use manual isSelected for styling
										? `${settingsTabTrigger} ${settingsTabTriggerActive}`
										: settingsTabTrigger,
									"cursor-pointer focus:ring-0", // Remove the focus ring styling
								)}
								data-testid={`tab-${id}`}
								data-compact={isCompactMode}>
								<div className={cn("flex items-center gap-2", isCompactMode && "justify-center")}>
									<Icon className="w-4 h-4" />
									<span className="tab-label">{t(`settings:sections.${id}`)}</span>
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

				{/* Content area - renders only the active tab (or indexing tab during initial indexing) */}
				<TabContent
					ref={contentRef}
					className={cn("p-0 flex-1 overflow-auto", isIndexing && "opacity-0")}
					data-testid="settings-content">
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
												vscode.postMessage({ type: "loadApiConfiguration", text: configName }),
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
						{renderTab === "autoApprove" && (
							<AutoApproveSettings
								alwaysAllowReadOnly={settings.alwaysAllowReadOnly}
								alwaysAllowReadOnlyOutsideWorkspace={settings.alwaysAllowReadOnlyOutsideWorkspace}
								alwaysAllowWrite={settings.alwaysAllowWrite}
								alwaysAllowWriteOutsideWorkspace={settings.alwaysAllowWriteOutsideWorkspace}
								alwaysAllowWriteProtected={settings.alwaysAllowWriteProtected}
								alwaysAllowMcp={settings.alwaysAllowMcp}
								alwaysAllowModeSwitch={settings.alwaysAllowModeSwitch}
								alwaysAllowSubtasks={settings.alwaysAllowSubtasks}
								alwaysApprovePlan={settings.alwaysApprovePlan}
								alwaysAllowExecute={settings.alwaysAllowExecute}
								alwaysAllowFollowupQuestions={settings.alwaysAllowFollowupQuestions}
								followupAutoApproveTimeoutMs={settings.followupAutoApproveTimeoutMs}
								allowedCommands={settings.allowedCommands}
								allowedMaxRequests={settings.allowedMaxRequests ?? undefined}
								allowedMaxCost={settings.allowedMaxCost ?? undefined}
								deniedCommands={settings.deniedCommands}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Slash Commands Section */}
						{renderTab === "slashCommands" && <SlashCommandsSettings />}

						{/* Skills Section */}
						{renderTab === "skills" && <SkillsSettings />}

						{/* Checkpoints Section */}
						{renderTab === "checkpoints" && (
							<CheckpointSettings
								enableCheckpoints={settings.enableCheckpoints}
								checkpointTimeout={settings.checkpointTimeout}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Memory Section */}
						{renderTab === "memory" && (
							<MemorySettings
								autoMemoryEnabled={settings.autoMemoryEnabled}
								autoMemoryDirectory={settings.autoMemoryDirectory}
								autoMemoryShareWithClaudeCode={settings.autoMemoryShareWithClaudeCode}
								memoryRecallEnabled={settings.memoryRecallEnabled}
								autoDreamEnabled={settings.autoDreamEnabled}
								autoDreamMinHours={settings.autoDreamMinHours}
								autoDreamMinSessions={settings.autoDreamMinSessions}
								memoryWriterApiConfigId={settings.memoryWriterApiConfigId}
								listApiConfigMeta={listApiConfigMeta ?? []}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Web Tools Section */}
						{renderTab === "web" && (
							<WebToolsSettings
								webToolsEnabled={settings.webToolsEnabled}
								searxngBaseUrl={settings.searxngBaseUrl}
								webSearchMaxResults={settings.webSearchMaxResults}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Notifications Section */}
						{renderTab === "notifications" && (
							<NotificationSettings
								soundEnabled={settings.soundEnabled}
								soundVolume={settings.soundVolume}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Context Management Section */}
						{renderTab === "contextManagement" && (
							<ContextManagementSettings
								autoCondenseContext={settings.autoCondenseContext}
								autoCondenseContextPercent={settings.autoCondenseContextPercent}
								autoCondenseContextApiConfigId={settings.autoCondenseContextApiConfigId}
								pruneBeforeCondense={settings.pruneBeforeCondense}
								pruneToolResultBudget={settings.pruneToolResultBudget}
								listApiConfigMeta={listApiConfigMeta ?? []}
								maxOpenTabsContext={settings.maxOpenTabsContext}
								maxWorkspaceFiles={settings.maxWorkspaceFiles ?? 200}
								showRooIgnoredFiles={settings.showRooIgnoredFiles}
								enableSubfolderRules={settings.enableSubfolderRules}
								maxImageFileSize={settings.maxImageFileSize}
								maxTotalImageSize={settings.maxTotalImageSize}
								profileThresholds={settings.profileThresholds}
								includeDiagnosticMessages={settings.includeDiagnosticMessages}
								maxDiagnosticMessages={settings.maxDiagnosticMessages}
								writeDelayMs={settings.writeDelayMs}
								includeCurrentTime={settings.includeCurrentTime}
								includeCurrentCost={settings.includeCurrentCost}
								maxGitStatusFiles={settings.maxGitStatusFiles}
								customSupportPrompts={settings.customSupportPrompts || {}}
								setCustomSupportPrompts={(prompts) =>
									setCachedStateField("customSupportPrompts", prompts)
								}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Terminal Section */}
						{renderTab === "terminal" && (
							<TerminalSettings
								terminalOutputPreviewSize={settings.terminalOutputPreviewSize}
								terminalShellIntegrationTimeout={settings.terminalShellIntegrationTimeout}
								terminalShellIntegrationDisabled={settings.terminalShellIntegrationDisabled}
								terminalCommandDelay={settings.terminalCommandDelay}
								terminalPowershellCounter={settings.terminalPowershellCounter}
								terminalZshClearEolMark={settings.terminalZshClearEolMark}
								terminalZshOhMy={settings.terminalZshOhMy}
								terminalZshP10k={settings.terminalZshP10k}
								terminalZdotdir={settings.terminalZdotdir}
								terminalProfile={settings.terminalProfile}
								onTerminalProfilePickerOpened={() => setChangeDetected(true)}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Modes Section */}
						{renderTab === "modes" && (
							<ModesView
								onSelectApiConfiguration={(configName: string) =>
									checkUnsaveChanges(() =>
										vscode.postMessage({ type: "loadApiConfiguration", text: configName }),
									)
								}
							/>
						)}

						{/* MCP Section */}
						{renderTab === "mcp" && <McpView />}

						{/* Worktrees Section */}
						{renderTab === "worktrees" && <WorktreesView />}

						{/* Subagents Section */}
						{renderTab === "subagents" && (
							<SubagentSettings
								parallelTasksMaxConcurrency={settings.parallelTasksMaxConcurrency}
								subagentFollowupTimeoutSec={settings.subagentFollowupTimeoutSec}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Prompts Section */}
						{renderTab === "prompts" && (
							<PromptsSettings
								customSupportPrompts={settings.customSupportPrompts || {}}
								setCustomSupportPrompts={(prompts) =>
									setCachedStateField("customSupportPrompts", prompts)
								}
								includeTaskHistoryInEnhance={settings.includeTaskHistoryInEnhance}
								setIncludeTaskHistoryInEnhance={(value) =>
									setCachedStateField("includeTaskHistoryInEnhance", value)
								}
							/>
						)}

						{/* UI Section */}
						{renderTab === "ui" && (
							<UISettings
								reasoningBlockCollapsed={settings.reasoningBlockCollapsed ?? true}
								enterBehavior={settings.enterBehavior ?? "send"}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* Experimental Section */}
						{renderTab === "experimental" && (
							<ExperimentalSettings
								setExperimentEnabled={setExperimentEnabled}
								experiments={settings.experiments}
								apiConfiguration={apiConfiguration}
								setApiConfigurationField={setApiConfigurationField}
								imageGenerationProvider={settings.imageGenerationProvider}
								openRouterImageApiKey={settings.openRouterImageApiKey as string | undefined}
								openRouterImageGenerationSelectedModel={
									settings.openRouterImageGenerationSelectedModel as string | undefined
								}
								setImageGenerationProvider={(provider) =>
									setCachedStateField("imageGenerationProvider", provider)
								}
								setOpenRouterImageApiKey={(apiKey) =>
									setCachedStateField("openRouterImageApiKey", apiKey)
								}
								setImageGenerationSelectedModel={(model) =>
									setCachedStateField("openRouterImageGenerationSelectedModel", model)
								}
							/>
						)}

						{/* Language Section */}
						{renderTab === "language" && (
							<LanguageSettings
								language={settings.language || "en"}
								setCachedStateField={setCachedStateField}
							/>
						)}

						{/* About Section */}
						{renderTab === "about" && (
							<About
								telemetrySetting={settings.telemetrySetting}
								setTelemetrySetting={(setting) => setCachedStateField("telemetrySetting", setting)}
								debug={settings.debug}
								setDebug={(debug) => setCachedStateField("debug", debug)}
							/>
						)}
					</SearchIndexProvider>
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
