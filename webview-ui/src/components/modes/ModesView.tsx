import React, { useState, useEffect, useRef } from "react"
import { Trans } from "react-i18next"
import { ChevronDown, X, Upload, Download } from "lucide-react"

import type { ModeConfig, GroupEntry, PromptComponent, ToolGroup, ExtensionMessage } from "@roo-code/types"

import {
	Mode,
	getRoleDefinition,
	getWhenToUse,
	getDescription,
	getCustomInstructions,
	getAllModes,
	findModeBySlug,
	defaultModeSlug,
} from "@roo/modes"

import { vscode } from "@src/utils/vscode"
import { buildDocLink } from "@src/utils/docLinks"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { Section } from "@src/components/settings/Section"
import {
	Button,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Command,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandItem,
	CommandGroup,
	StandardTooltip,
	Link,
	LabeledCheckbox,
	ThemedTextArea,
	ThemedTextField,
} from "@src/components/ui"
import { DeleteModeDialog } from "@src/components/modes/DeleteModeDialog"
import McpServerRestriction from "@src/components/modes/McpServerRestriction"
import { useEscapeKey } from "@src/hooks/useEscapeKey"

import { CreateModeDialog } from "./CreateModeDialog"
import { ImportModeDialog } from "./ImportModeDialog"
import { availableGroups, getGroupName } from "./modeGroups"
import { useModeImportExport } from "./useModeImportExport"
import { onExtensionMessage } from "@src/utils/extensionBus"

type ModesViewProps = {
	/**
	 * Loads another API profile. ModesView lives inside SettingsView, whose Save buffer is
	 * replaced when the profile changes, so the owner decides whether unsaved edits allow it.
	 */
	onSelectApiConfiguration: (configName: string) => void
}

const ModesView = ({ onSelectApiConfiguration }: ModesViewProps) => {
	const { t } = useAppTranslation()

	const {
		customModePrompts,
		listApiConfigMeta,
		currentApiConfigName,
		mode,
		customInstructions,
		setCustomInstructions,
		customModes,
		mcpServers,
	} = useExtensionState()

	// Use a local state to track the visually active mode
	// This prevents flickering when switching modes rapidly by:
	// 1. Updating the UI immediately when a mode is clicked
	// 2. Not syncing with the backend mode state (which would cause flickering)
	// 3. Still sending the mode change to the backend for persistence
	const [visualMode, setVisualMode] = useState(mode)

	// Build modes fresh each render so search reflects inline rename updates immediately
	const modes = getAllModes(customModes)

	const [isDialogOpen, setIsDialogOpen] = useState(false)
	const [selectedPromptContent, setSelectedPromptContent] = useState("")
	const [selectedPromptTitle, setSelectedPromptTitle] = useState("")
	const [isToolsEditMode, setIsToolsEditMode] = useState(false)
	const [showConfigMenu, setShowConfigMenu] = useState(false)
	const [isCreateModeDialogOpen, setIsCreateModeDialogOpen] = useState(false)
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
	const [modeToDelete, setModeToDelete] = useState<{
		slug: string
		name: string
		source?: string
		rulesFolderPath?: string
	} | null>(null)

	// State for mode selection popover and search
	const [open, setOpen] = useState(false)
	const [searchValue, setSearchValue] = useState("")
	const searchInputRef = useRef<HTMLInputElement>(null)

	// Inline rename state for the mode dropdown row
	const [isRenamingMode, setIsRenamingMode] = useState(false)
	const [renameInputValue, setRenameInputValue] = useState("")
	const renameInputRef = useRef<any>(null)

	// Optimistic rename map so search reflects new names immediately
	const [localRenames, setLocalRenames] = useState<Record<string, string>>({})
	// Display list that overlays optimistic names
	const displayModes = modes.map((m) => (localRenames[m.slug] ? { ...m, name: localRenames[m.slug] } : m))

	const updateAgentPrompt = (mode: Mode, promptData: PromptComponent) => {
		const existingPrompt = customModePrompts?.[mode] as PromptComponent
		const updatedPrompt = { ...existingPrompt, ...promptData }

		// Only include properties that differ from defaults
		if (updatedPrompt.roleDefinition === getRoleDefinition(mode)) {
			delete updatedPrompt.roleDefinition
		}
		if (updatedPrompt.description === getDescription(mode)) {
			delete updatedPrompt.description
		}
		if (updatedPrompt.whenToUse === getWhenToUse(mode)) {
			delete updatedPrompt.whenToUse
		}

		vscode.postMessage({
			type: "updatePrompt",
			promptMode: mode,
			customPrompt: updatedPrompt,
		})
	}

	const updateCustomMode = (slug: string, modeConfig: ModeConfig) => {
		vscode.postMessage({
			type: "updateCustomMode",
			slug,
			modeConfig: {
				...modeConfig,
				source: modeConfig.source || "global", // Ensure source is set
			},
		})
	}

	const switchMode = (slug: string) => {
		vscode.postMessage({
			type: "mode",
			text: slug,
		})
	}

	// Handle mode switching with explicit state initialization
	const handleModeSwitch = (modeConfig: ModeConfig) => {
		if (modeConfig.slug === visualMode) return // Prevent unnecessary updates

		// Immediately update visual state for instant feedback
		setVisualMode(modeConfig.slug)

		// Then send the mode change message to the backend
		switchMode(modeConfig.slug)

		// Exit tools edit mode when switching modes
		setIsToolsEditMode(false)
	}

	// Sync visualMode with backend mode changes to prevent desync
	useEffect(() => {
		setVisualMode(mode)
	}, [mode])

	// Handler for popover open state change
	const onOpenChange = (open: boolean) => {
		setOpen(open)
		// Reset search when closing the popover
		if (!open) {
			setTimeout(() => setSearchValue(""), 100)
		}
	}

	// Use the shared ESC key handler hook
	useEscapeKey(open, () => setOpen(false))

	// Handler for clearing search input
	const onClearSearch = () => {
		setSearchValue("")
		searchInputRef.current?.focus()
	}

	// Focus rename input when entering rename mode
	useEffect(() => {
		if (isRenamingMode) {
			const id = setTimeout(() => renameInputRef.current?.focus(), 0)
			return () => clearTimeout(id)
		}
	}, [isRenamingMode])

	const handleStartRenameMode = () => {
		const customMode = findModeBySlug(visualMode, customModes)
		if (customMode) {
			setIsRenamingMode(true)
			setRenameInputValue(customMode.name)
		}
	}

	const handleCancelRenameMode = () => {
		setIsRenamingMode(false)
		setRenameInputValue("")
	}

	const handleSaveRenameMode = () => {
		const customMode = findModeBySlug(visualMode, customModes)
		const trimmed = renameInputValue.trim()
		if (!customMode || !trimmed) {
			setIsRenamingMode(false)
			return
		}
		// Prevent duplicate names against other modes
		const nameTaken = modes.some(
			(m) => m.name.toLowerCase() === trimmed.toLowerCase() && m.slug !== customMode.slug,
		)
		if (nameTaken) {
			// simple guard: do nothing if taken
			return
		}
		updateCustomMode(visualMode, {
			...customMode,
			name: trimmed,
			source: customMode.source || "global",
		})
		// Optimistically reflect rename in UI/search immediately
		setLocalRenames((prev) => ({ ...prev, [visualMode]: trimmed }))
		setIsRenamingMode(false)
	}

	// Helper function to get current mode's config
	const getCurrentMode = (): ModeConfig | undefined => {
		const findMode = (m: ModeConfig): boolean => m.slug === visualMode
		return customModes?.find(findMode) || modes.find(findMode)
	}

	const importExport = useModeImportExport({
		currentSlug: getCurrentMode()?.slug,
		onImported: (slug) => {
			const importedMode = modes.find((m) => m.slug === slug)
			if (importedMode) {
				handleModeSwitch(importedMode)
			} else {
				// Slug not yet in state (race condition): select the default mode
				setVisualMode(defaultModeSlug)
				switchMode(defaultModeSlug)
			}
		},
	})

	const handleCreateMode = (newMode: ModeConfig) => {
		updateCustomMode(newMode.slug, newMode)
		// Immediately select the newly created mode in the UI
		setVisualMode(newMode.slug)
		switchMode(newMode.slug)
		setIsCreateModeDialogOpen(false)
	}

	// Handler for group checkbox changes
	const handleGroupChange =
		(group: ToolGroup, isCustomMode: boolean, customMode: ModeConfig | undefined) =>
		(e: Event | React.FormEvent<HTMLElement>) => {
			if (!isCustomMode) return // Prevent changes to built-in modes
			const target = (e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
			const checked = target.checked
			const oldGroups = customMode?.groups || []
			let newGroups: GroupEntry[]
			if (checked) {
				newGroups = [...oldGroups, group]
			} else {
				newGroups = oldGroups.filter((g) => getGroupName(g) !== group)
			}
			if (customMode) {
				updateCustomMode(customMode.slug, {
					...customMode,
					groups: newGroups,
					source: customMode.source || "global",
				})
			}
		}

	// Handle clicks outside the config menu
	useEffect(() => {
		const handleClickOutside = () => {
			if (showConfigMenu) {
				setShowConfigMenu(false)
			}
		}

		document.addEventListener("click", handleClickOutside)
		return () => document.removeEventListener("click", handleClickOutside)
	}, [showConfigMenu])

	// The message listener below is registered once; it reads modeToDelete through this ref.
	const modeToDeleteRef = useRef(modeToDelete)
	useEffect(() => {
		modeToDeleteRef.current = modeToDelete
	}, [modeToDelete])

	useEffect(() => {
		const handler = (message: ExtensionMessage) => {
			if (message.type === "systemPrompt") {
				if (message.text) {
					setSelectedPromptContent(message.text)
					setSelectedPromptTitle(`System Prompt (${message.mode} mode)`)
					setIsDialogOpen(true)
				}
			} else if (message.type === "deleteCustomModeCheck") {
				const currentModeToDelete = modeToDeleteRef.current
				if (message.slug && currentModeToDelete && currentModeToDelete.slug === message.slug) {
					setModeToDelete({
						...currentModeToDelete,
						rulesFolderPath: message.rulesFolderPath,
					})
					setShowDeleteConfirm(true)
				}
			}
		}

		return onExtensionMessage(["systemPrompt", "deleteCustomModeCheck"], handler)
	}, [])

	const handleAgentReset = (
		modeSlug: string,
		type: "roleDefinition" | "description" | "whenToUse" | "customInstructions",
	) => {
		// Only reset for built-in modes
		const existingPrompt = customModePrompts?.[modeSlug] as PromptComponent
		const updatedPrompt = { ...existingPrompt }
		delete updatedPrompt[type] // Remove the field entirely to ensure it reloads from defaults

		vscode.postMessage({
			type: "updatePrompt",
			promptMode: modeSlug,
			customPrompt: updatedPrompt,
		})
	}

	return (
		<div>
			<Section>
				<div>
					<div onClick={(e) => e.stopPropagation()} className="flex justify-between items-center mb-3">
						<h3 className="text-[1.25em] font-semibold text-vscode-foreground mt-4 mb-2">
							{t("prompts:modes.title")}
						</h3>
						<div className="flex gap-2">
							<div className="relative inline-block">
								<StandardTooltip content={t("prompts:modes.editModesConfig")}>
									<Button
										variant="ghost"
										size="icon"
										className="flex"
										onClick={(e: React.MouseEvent) => {
											e.preventDefault()
											e.stopPropagation()
											setShowConfigMenu((prev) => !prev)
										}}
										onBlur={() => {
											// Add slight delay to allow menu item clicks to register
											setTimeout(() => setShowConfigMenu(false), 200)
										}}>
										<span className="codicon codicon-json"></span>
									</Button>
								</StandardTooltip>
								{showConfigMenu && (
									<div
										onClick={(e) => e.stopPropagation()}
										onMouseDown={(e) => e.stopPropagation()}
										className="absolute top-full right-0 w-[200px] mt-1 bg-vscode-editor-background border border-vscode-input-border rounded shadow-md z-[1000]">
										<div
											className="p-2 cursor-pointer text-vscode-foreground text-sm"
											onMouseDown={(e) => {
												e.preventDefault() // Prevent blur
												vscode.postMessage({
													type: "openCustomModesSettings",
												})
												setShowConfigMenu(false)
											}}
											onClick={(e) => e.preventDefault()}>
											{t("prompts:modes.editGlobalModes")}
										</div>
										<div
											className="p-2 cursor-pointer text-vscode-foreground text-sm border-t border-vscode-input-border"
											onMouseDown={(e) => {
												e.preventDefault() // Prevent blur
												vscode.postMessage({
													type: "openFile",
													text: "./.roomodes",
													values: {
														create: true,
														content: JSON.stringify({ customModes: [] }, null, 2),
													},
												})
												setShowConfigMenu(false)
											}}
											onClick={(e) => e.preventDefault()}>
											{t("prompts:modes.editProjectModes")}
										</div>
									</div>
								)}
							</div>
							<StandardTooltip content={t("chat:modeSelector.marketplace")}>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										window.postMessage(
											{
												type: "action",
												action: "marketplaceButtonClicked",
												values: { marketplaceTab: "mode" },
											},
											"*",
										)
									}}>
									<span className="codicon codicon-extensions"></span>
								</Button>
							</StandardTooltip>

							<StandardTooltip content={t("prompts:modes.importMode")}>
								<Button
									variant="ghost"
									size="icon"
									onClick={importExport.openImportDialog}
									disabled={importExport.isImporting}
									title={t("prompts:modes.importMode")}
									data-testid="import-mode-toolbar-button">
									<Download className="h-4 w-4" />
								</Button>
							</StandardTooltip>
						</div>
					</div>

					<div className="text-sm text-vscode-descriptionForeground mb-3">
						<Trans i18nKey="prompts:modes.createModeHelpText">
							<Link
								href={buildDocLink("basic-usage/using-modes", "prompts_view_modes")}
								style={{ display: "inline" }}
								aria-label="Learn about using modes"></Link>
							<Link
								href={buildDocLink("features/custom-modes", "prompts_view_modes")}
								style={{ display: "inline" }}
								aria-label="Learn about customizing modes"></Link>
						</Trans>
					</div>

					<div className="flex items-center gap-1 mb-3">
						{isRenamingMode ? (
							<>
								<ThemedTextField
									ref={renameInputRef}
									value={renameInputValue}
									onInput={(e: unknown) => {
										const target = e as { target: { value: string } }
										setRenameInputValue(target.target.value)
									}}
									className="grow"
									placeholder={t("prompts:createModeDialog.name.placeholder")}
								/>
								<StandardTooltip content={t("settings:common.save")}>
									<Button
										variant="ghost"
										size="icon"
										disabled={!renameInputValue.trim()}
										onClick={handleSaveRenameMode}
										data-testid="save-mode-rename-button">
										<span className="codicon codicon-check" />
									</Button>
								</StandardTooltip>
								<StandardTooltip content={t("settings:common.cancel")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={handleCancelRenameMode}
										data-testid="cancel-mode-rename-button">
										<span className="codicon codicon-close" />
									</Button>
								</StandardTooltip>
							</>
						) : (
							<>
								<Popover open={open} onOpenChange={onOpenChange}>
									<PopoverTrigger asChild>
										<Button
											variant="combobox"
											role="combobox"
											aria-expanded={open}
											className="justify-between grow"
											data-testid="mode-select-trigger">
											<div className="truncate">
												{localRenames[visualMode] ??
													getCurrentMode()?.name ??
													t("prompts:modes.selectMode")}
											</div>
											<ChevronDown className="opacity-50" />
										</Button>
									</PopoverTrigger>
									<PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]">
										<Command>
											<div className="relative">
												<CommandInput
													ref={searchInputRef}
													value={searchValue}
													onValueChange={setSearchValue}
													placeholder={t("prompts:modes.selectMode")}
													className="h-9 mr-4"
													data-testid="mode-search-input"
												/>
												{searchValue.length > 0 && (
													<div className="absolute right-2 top-0 bottom-0 flex items-center justify-center">
														<X
															className="text-vscode-input-foreground opacity-50 hover:opacity-100 size-4 p-0.5 cursor-pointer"
															onClick={onClearSearch}
														/>
													</div>
												)}
											</div>
											<CommandList>
												<CommandEmpty>
													{searchValue && (
														<div className="py-2 px-1 text-sm">
															{t("prompts:modes.noMatchFound")}
														</div>
													)}
												</CommandEmpty>
												<CommandGroup>
													{displayModes
														.filter((modeConfig) =>
															searchValue
																? modeConfig.name
																		.toLowerCase()
																		.includes(searchValue.toLowerCase())
																: true,
														)
														.map((modeConfig) => (
															<CommandItem
																key={modeConfig.slug}
																value={`${modeConfig.name} ${modeConfig.slug}`}
																onSelect={() => {
																	handleModeSwitch(modeConfig)
																	setOpen(false)
																}}
																data-testid={`mode-option-${modeConfig.slug}`}>
																<div className="flex items-center justify-between w-full">
																	<span
																		style={{
																			whiteSpace: "nowrap",
																			overflow: "hidden",
																			textOverflow: "ellipsis",
																			flex: 2,
																			minWidth: 0,
																		}}>
																		{modeConfig.name}
																	</span>
																	<span
																		className="text-foreground"
																		style={{
																			whiteSpace: "nowrap",
																			overflow: "hidden",
																			textOverflow: "ellipsis",
																			direction: "rtl",
																			textAlign: "right",
																			flex: 1,
																			minWidth: 0,
																			marginLeft: "0.5em",
																		}}>
																		{modeConfig.slug}
																	</span>
																</div>
															</CommandItem>
														))}
												</CommandGroup>
											</CommandList>
										</Command>
									</PopoverContent>
								</Popover>

								{/* New mode (+) moved here from the top bar */}
								<StandardTooltip content={t("prompts:modes.createNewMode")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => setIsCreateModeDialogOpen(true)}
										data-testid="add-mode-button">
										<span className="codicon codicon-add" />
									</Button>
								</StandardTooltip>

								{/* Edit (rename) mode - only enabled for custom modes */}
								<StandardTooltip content={t("settings:providers.renameProfile")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={handleStartRenameMode}
										data-testid="rename-mode-button"
										disabled={!findModeBySlug(visualMode, customModes)}>
										<span className="codicon codicon-edit" />
									</Button>
								</StandardTooltip>

								{/* Delete mode - disabled for built-in modes */}
								<StandardTooltip content={t("prompts:createModeDialog.deleteMode")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => {
											const customMode = findModeBySlug(visualMode, customModes)
											if (customMode) {
												setModeToDelete({
													slug: customMode.slug,
													name: customMode.name,
													source: customMode.source || "global",
												})
												vscode.postMessage({
													type: "deleteCustomMode",
													slug: customMode.slug,
													checkOnly: true,
												})
											}
										}}
										data-testid="delete-mode-button"
										disabled={!findModeBySlug(visualMode, customModes)}>
										<span className="codicon codicon-trash" />
									</Button>
								</StandardTooltip>

								{/* Export mode (kept here to the right of the dropdown) */}
								<StandardTooltip content={t("prompts:exportMode.title")}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => {
											const currentMode = getCurrentMode()
											if (currentMode?.slug) {
												importExport.exportMode(currentMode.slug)
											}
										}}
										disabled={importExport.isExporting}
										title={t("prompts:exportMode.title")}
										data-testid="export-mode-toolbar-button">
										<Upload className="h-4 w-4" />
									</Button>
								</StandardTooltip>
							</>
						)}
					</div>

					{/* API Configuration - Moved Here */}
					<div className="mb-3">
						<div className="font-bold mb-1">{t("prompts:apiConfiguration.title")}</div>
						<div className="text-sm text-vscode-descriptionForeground mb-2">
							{t("prompts:apiConfiguration.select")}
						</div>
						<div className="mb-2">
							<Select value={currentApiConfigName} onValueChange={onSelectApiConfiguration}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder={t("settings:common.select")} />
								</SelectTrigger>
								<SelectContent>
									{(listApiConfigMeta || []).map((config) => (
										<SelectItem key={config.id} value={config.name}>
											{config.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>

				{/* Role Definition section */}
				<div className="mb-4">
					<div className="flex justify-between items-center mb-1">
						<div className="font-bold">{t("prompts:roleDefinition.title")}</div>
						{!findModeBySlug(visualMode, customModes) && (
							<StandardTooltip content={t("prompts:roleDefinition.resetToDefault")}>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "roleDefinition")
										}
									}}
									data-testid="role-definition-reset">
									<span className="codicon codicon-discard"></span>
								</Button>
							</StandardTooltip>
						)}
					</div>
					<div className="text-sm text-vscode-descriptionForeground mb-2">
						{t("prompts:roleDefinition.description")}
					</div>
					<ThemedTextArea
						resize="vertical"
						value={(() => {
							const customMode = findModeBySlug(visualMode, customModes)
							const prompt = customModePrompts?.[visualMode] as PromptComponent
							return customMode?.roleDefinition ?? prompt?.roleDefinition ?? getRoleDefinition(visualMode)
						})()}
						onChange={(e) => {
							const value =
								(e as unknown as CustomEvent)?.detail?.target?.value ??
								((e as any).target as HTMLTextAreaElement).value
							const customMode = findModeBySlug(visualMode, customModes)
							if (customMode) {
								// For custom modes, update the JSON file
								updateCustomMode(visualMode, {
									...customMode,
									roleDefinition: value.trim() || "",
									source: customMode.source || "global",
								})
							} else {
								// For built-in modes, update the prompts
								updateAgentPrompt(visualMode, {
									roleDefinition: value.trim() || undefined,
								})
							}
						}}
						className="w-full"
						rows={5}
						data-testid={`${getCurrentMode()?.slug || "code"}-prompt-textarea`}
					/>
				</div>

				{/* Description section */}
				<div className="mb-4">
					<div className="flex justify-between items-center mb-1">
						<div className="font-bold">{t("prompts:description.title")}</div>
						{!findModeBySlug(visualMode, customModes) && (
							<StandardTooltip content={t("prompts:description.resetToDefault")}>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "description")
										}
									}}
									data-testid="description-reset">
									<span className="codicon codicon-discard"></span>
								</Button>
							</StandardTooltip>
						)}
					</div>
					<div className="text-sm text-vscode-descriptionForeground mb-2">
						{t("prompts:description.description")}
					</div>
					<ThemedTextField
						value={(() => {
							const customMode = findModeBySlug(visualMode, customModes)
							const prompt = customModePrompts?.[visualMode] as PromptComponent
							return customMode?.description ?? prompt?.description ?? getDescription(visualMode)
						})()}
						onChange={(e) => {
							const value =
								(e as unknown as CustomEvent)?.detail?.target?.value ??
								((e as any).target as HTMLTextAreaElement).value
							const customMode = findModeBySlug(visualMode, customModes)
							if (customMode) {
								// For custom modes, update the JSON file
								updateCustomMode(visualMode, {
									...customMode,
									description: value.trim() || undefined,
									source: customMode.source || "global",
								})
							} else {
								// For built-in modes, update the prompts
								updateAgentPrompt(visualMode, {
									description: value.trim() || undefined,
								})
							}
						}}
						className="w-full"
						data-testid={`${getCurrentMode()?.slug || "code"}-description-textfield`}
					/>
				</div>

				{/* When to Use section */}
				<div className="mb-4">
					<div className="flex justify-between items-center mb-1">
						<div className="font-bold">{t("prompts:whenToUse.title")}</div>
						{!findModeBySlug(visualMode, customModes) && (
							<StandardTooltip content={t("prompts:whenToUse.resetToDefault")}>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "whenToUse")
										}
									}}
									data-testid="when-to-use-reset">
									<span className="codicon codicon-discard"></span>
								</Button>
							</StandardTooltip>
						)}
					</div>
					<div className="text-sm text-vscode-descriptionForeground mb-2">
						{t("prompts:whenToUse.description")}
					</div>
					<ThemedTextArea
						resize="vertical"
						value={(() => {
							const customMode = findModeBySlug(visualMode, customModes)
							const prompt = customModePrompts?.[visualMode] as PromptComponent
							return customMode?.whenToUse ?? prompt?.whenToUse ?? getWhenToUse(visualMode)
						})()}
						onChange={(e) => {
							const value =
								(e as unknown as CustomEvent)?.detail?.target?.value ??
								((e as any).target as HTMLTextAreaElement).value
							const customMode = findModeBySlug(visualMode, customModes)
							if (customMode) {
								// For custom modes, update the JSON file
								updateCustomMode(visualMode, {
									...customMode,
									whenToUse: value.trim() || undefined,
									source: customMode.source || "global",
								})
							} else {
								// For built-in modes, update the prompts
								updateAgentPrompt(visualMode, {
									whenToUse: value.trim() || undefined,
								})
							}
						}}
						className="w-full"
						rows={4}
						data-testid={`${getCurrentMode()?.slug || "code"}-when-to-use-textarea`}
					/>
				</div>

				{/* Mode settings */}
				<>
					{/* Show tools for all modes */}
					<div className="mb-4">
						<div className="flex justify-between items-center mb-1">
							<div className="font-bold">{t("prompts:tools.title")}</div>
							{findModeBySlug(visualMode, customModes) && (
								<StandardTooltip
									content={
										isToolsEditMode ? t("prompts:tools.doneEditing") : t("prompts:tools.editTools")
									}>
									<Button
										variant="ghost"
										size="icon"
										onClick={() => setIsToolsEditMode(!isToolsEditMode)}>
										<span
											className={`codicon codicon-${isToolsEditMode ? "check" : "edit"}`}></span>
									</Button>
								</StandardTooltip>
							)}
						</div>
						{!findModeBySlug(visualMode, customModes) && (
							<div className="text-sm text-vscode-descriptionForeground mb-2">
								{t("prompts:tools.builtInModesText")}
							</div>
						)}
						{isToolsEditMode && findModeBySlug(visualMode, customModes) ? (
							<>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
									{availableGroups.map((group) => {
										const currentMode = getCurrentMode()
										const isCustomMode = findModeBySlug(visualMode, customModes)
										const customMode = isCustomMode
										const isGroupEnabled = isCustomMode
											? customMode?.groups?.some((g) => getGroupName(g) === group)
											: currentMode?.groups?.some((g) => getGroupName(g) === group)

										return (
											<LabeledCheckbox
												key={group}
												checked={isGroupEnabled}
												onChange={handleGroupChange(group, Boolean(isCustomMode), customMode)}
												disabled={!isCustomMode}>
												{t(`prompts:tools.toolNames.${group}`)}
												{group === "edit" && (
													<div className="text-xs text-vscode-descriptionForeground mt-0.5">
														{t("prompts:tools.allowedFiles")}{" "}
														{(() => {
															const currentMode = getCurrentMode()
															const editGroup = currentMode?.groups?.find(
																(g) =>
																	Array.isArray(g) &&
																	g[0] === "edit" &&
																	g[1]?.fileRegex,
															)
															if (!Array.isArray(editGroup)) return t("prompts:allFiles")
															return (
																editGroup[1].description ||
																`/${editGroup[1].fileRegex}/`
															)
														})()}
													</div>
												)}
											</LabeledCheckbox>
										)
									})}
								</div>
								{/* MCP Server Restriction — shown when the mcp group is enabled. Uses a
								    local cached-state buffer + 150 ms debounced flush to avoid host
								    round-trip flicker. See McpServerRestriction.tsx. */}
								{(() => {
									const customMode = findModeBySlug(visualMode, customModes)
									const isMcpEnabled = customMode?.groups?.some((g) => getGroupName(g) === "mcp")
									if (!customMode || !isMcpEnabled) return null
									return (
										<McpServerRestriction
											slug={customMode.slug}
											value={customMode.allowedMcpServers}
											mcpServers={mcpServers}
											onChange={(next) =>
												updateCustomMode(customMode.slug, {
													...customMode,
													allowedMcpServers: next,
													source: customMode.source || "global",
												})
											}
										/>
									)
								})()}
							</>
						) : (
							<>
								<div className="text-sm text-vscode-foreground mb-2 leading-relaxed">
									{(() => {
										const currentMode = getCurrentMode()
										const enabledGroups = currentMode?.groups || []

										// If there are no enabled groups, display translated "None"
										if (enabledGroups.length === 0) {
											return t("prompts:tools.noTools")
										}

										return enabledGroups
											.map((group) => {
												const groupName = getGroupName(group)
												const displayName = t(`prompts:tools.toolNames.${groupName}`)
												if (Array.isArray(group) && group[1]?.fileRegex) {
													const description =
														group[1].description || `/${group[1].fileRegex}/`
													return `${displayName} (${description})`
												}
												return displayName
											})
											.join(", ")
									})()}
								</div>
								{/* MCP Server Restriction for built-in modes. Built-in modes have no editable
								    ModeConfig and no "edit tools" toggle, so the allowlist is persisted via the
								    customModePrompts override path (updateAgentPrompt → updatePrompt). Shown only
								    when the built-in mode includes the mcp tool group. */}
								{(() => {
									const isBuiltIn = !findModeBySlug(visualMode, customModes)
									const currentMode = getCurrentMode()
									const isMcpEnabled = currentMode?.groups?.some((g) => getGroupName(g) === "mcp")
									if (!isBuiltIn || !isMcpEnabled) return null
									const builtInPrompt = customModePrompts?.[visualMode] as PromptComponent | undefined
									return (
										<McpServerRestriction
											slug={visualMode}
											value={builtInPrompt?.allowedMcpServers}
											mcpServers={mcpServers}
											onChange={(next) =>
												updateAgentPrompt(visualMode, { allowedMcpServers: next })
											}
										/>
									)
								})()}
							</>
						)}
					</div>
				</>

				{/* Role definition for both built-in and custom modes */}
				<div className="mb-2">
					<div className="flex justify-between items-center mb-1">
						<div className="font-bold">{t("prompts:customInstructions.title")}</div>
						{!findModeBySlug(visualMode, customModes) && (
							<StandardTooltip content={t("prompts:customInstructions.resetToDefault")}>
								<Button
									variant="ghost"
									size="icon"
									onClick={() => {
										const currentMode = getCurrentMode()
										if (currentMode?.slug) {
											handleAgentReset(currentMode.slug, "customInstructions")
										}
									}}
									data-testid="custom-instructions-reset">
									<span className="codicon codicon-discard"></span>
								</Button>
							</StandardTooltip>
						)}
					</div>
					<div className="text-[13px] text-vscode-descriptionForeground mb-2">
						{t("prompts:customInstructions.description", {
							modeName: getCurrentMode()?.name || "Code",
						})}
					</div>
					<ThemedTextArea
						resize="vertical"
						value={(() => {
							const customMode = findModeBySlug(visualMode, customModes)
							const prompt = customModePrompts?.[visualMode] as PromptComponent
							return (
								customMode?.customInstructions ??
								prompt?.customInstructions ??
								getCustomInstructions(visualMode, customModes)
							)
						})()}
						onChange={(e) => {
							const value =
								(e as unknown as CustomEvent)?.detail?.target?.value ??
								((e as any).target as HTMLTextAreaElement).value
							const customMode = findModeBySlug(visualMode, customModes)
							if (customMode) {
								// For custom modes, update the JSON file
								updateCustomMode(visualMode, {
									...customMode,
									// Preserve empty string; only treat null/undefined as unset
									customInstructions: value ?? undefined,
									source: customMode.source || "global",
								})
							} else {
								// For built-in modes, update the prompts
								const existingPrompt = customModePrompts?.[visualMode] as PromptComponent
								updateAgentPrompt(visualMode, {
									...existingPrompt,
									customInstructions: value.trim() || undefined,
								})
							}
						}}
						rows={10}
						className="w-full"
						data-testid={`${getCurrentMode()?.slug || "code"}-custom-instructions-textarea`}
					/>
					<div className="text-xs text-vscode-descriptionForeground mt-1.5">
						<Trans
							i18nKey="prompts:customInstructions.loadFromFile"
							values={{
								mode: getCurrentMode()?.name || "Code",
								slug: getCurrentMode()?.slug || "code",
							}}
							components={{
								span: (
									<span
										className="text-vscode-textLink-foreground cursor-pointer underline"
										onClick={() => {
											const currentMode = getCurrentMode()
											if (!currentMode) return

											// Open or create an empty file
											vscode.postMessage({
												type: "openFile",
												text: `./.roo/rules-${currentMode.slug}/rules.md`,
												values: {
													create: true,
													content: "",
												},
											})
										}}
									/>
								),
								"0": (
									<Link
										href={buildDocLink(
											"features/custom-instructions#global-rules-directory",
											"prompts_mode_specific_global_rules",
										)}
										style={{ display: "inline" }}
										aria-label="Learn about global custom instructions for modes"
									/>
								),
							}}
						/>
					</div>
				</div>

				<div className="pb-4 border-b border-vscode-input-border">
					<div className="flex gap-2 mb-4">
						<Button
							variant="primary"
							onClick={() => {
								const currentMode = getCurrentMode()
								if (currentMode) {
									vscode.postMessage({
										type: "getSystemPrompt",
										mode: currentMode.slug,
									})
								}
							}}
							data-testid="preview-prompt-button">
							{t("prompts:systemPrompt.preview")}
						</Button>
						<StandardTooltip content={t("prompts:systemPrompt.copy")}>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => {
									const currentMode = getCurrentMode()
									if (currentMode) {
										vscode.postMessage({
											type: "copySystemPrompt",
											mode: currentMode.slug,
										})
									}
								}}
								data-testid="copy-prompt-button">
								<span className="codicon codicon-copy"></span>
							</Button>
						</StandardTooltip>
					</div>
				</div>

				<div className="pb-5">
					<h3 className="text-vscode-foreground mb-3">{t("prompts:globalCustomInstructions.title")}</h3>

					<div className="text-sm text-vscode-descriptionForeground mb-2">
						<Trans i18nKey="prompts:globalCustomInstructions.description">
							<Link
								href={buildDocLink(
									"features/custom-instructions#setting-up-global-rules",
									"prompts_global_custom_instructions",
								)}
								style={{ display: "inline" }}
								aria-label="Learn more about global custom instructions"></Link>
						</Trans>
					</div>
					<ThemedTextArea
						resize="vertical"
						value={customInstructions || ""}
						onChange={(e) => {
							const value =
								(e as unknown as CustomEvent)?.detail?.target?.value ??
								((e as any).target as HTMLTextAreaElement).value
							setCustomInstructions(value ?? undefined)
							vscode.postMessage({
								type: "customInstructions",
								text: value ?? undefined,
							})
						}}
						rows={4}
						className="w-full"
						data-testid="global-custom-instructions-textarea"
					/>
					<div className="text-xs text-vscode-descriptionForeground mt-1.5">
						<Trans
							i18nKey="prompts:globalCustomInstructions.loadFromFile"
							components={{
								span: (
									<span
										className="text-vscode-textLink-foreground cursor-pointer underline"
										onClick={() =>
											vscode.postMessage({
												type: "openFile",
												text: "./.roo/rules/rules.md",
												values: {
													create: true,
													content: "",
												},
											})
										}
									/>
								),
								"0": (
									<Link
										href={buildDocLink(
											"features/custom-instructions#setting-up-global-rules",
											"prompts_global_rules",
										)}
										style={{ display: "inline" }}
										aria-label="Learn about setting up global custom instructions"
									/>
								),
							}}
						/>
					</div>
				</div>
			</Section>

			{isCreateModeDialogOpen && (
				<CreateModeDialog
					modes={modes}
					mcpServers={mcpServers}
					onCreate={handleCreateMode}
					onClose={() => setIsCreateModeDialogOpen(false)}
				/>
			)}

			{isDialogOpen && (
				<div className="fixed inset-0 flex justify-end bg-black/50 z-[1000]">
					<div className="w-[calc(100vw-100px)] h-full bg-vscode-editor-background shadow-md flex flex-col relative">
						<div className="flex-1 p-5 overflow-y-auto min-h-0">
							<Button
								variant="ghost"
								size="icon"
								onClick={() => setIsDialogOpen(false)}
								className="absolute top-5 right-5">
								<span className="codicon codicon-close"></span>
							</Button>
							<h2 className="mb-4">
								{selectedPromptTitle ||
									t("prompts:systemPrompt.title", {
										modeName: getCurrentMode()?.name || "Code",
									})}
							</h2>
							<pre className="p-2 whitespace-pre-wrap break-words font-mono text-vscode-editor-font-size text-vscode-editor-foreground bg-vscode-editor-background border border-vscode-editor-lineHighlightBorder rounded overflow-y-auto">
								{selectedPromptContent}
							</pre>
						</div>
						<div className="flex justify-end p-3 px-5 border-t border-vscode-editor-lineHighlightBorder bg-vscode-editor-background">
							<Button variant="secondary" onClick={() => setIsDialogOpen(false)}>
								{t("prompts:createModeDialog.close")}
							</Button>
						</div>
					</div>
				</div>
			)}

			{importExport.isImportDialogOpen && (
				<ImportModeDialog
					importLevel={importExport.importLevel}
					onImportLevelChange={importExport.setImportLevel}
					isImporting={importExport.isImporting}
					onImport={importExport.startImport}
					onCancel={importExport.closeImportDialog}
				/>
			)}

			{/* Delete Mode Confirmation Dialog */}
			<DeleteModeDialog
				open={showDeleteConfirm}
				onOpenChange={setShowDeleteConfirm}
				modeToDelete={modeToDelete}
				onConfirm={() => {
					if (modeToDelete) {
						vscode.postMessage({
							type: "deleteCustomMode",
							slug: modeToDelete.slug,
						})
						setShowDeleteConfirm(false)
						setModeToDelete(null)
					}
				}}
			/>
		</div>
	)
}

export default ModesView
