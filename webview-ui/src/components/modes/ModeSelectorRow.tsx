import { ModeIcon, modeLabel } from "@src/components/chat/modeIcon"
import { useState, useEffect, useRef } from "react"
import { ChevronDown, X, Upload } from "lucide-react"

import type { ModeConfig } from "@roo-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	Button,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Command,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandItem,
	CommandGroup,
	Input,
	StandardTooltip,
} from "@src/components/ui"
import { useEscapeKey } from "@src/hooks/useEscapeKey"

type ModeSelectorRowProps = {
	/** Every mode (built-in and custom), in display order. */
	modes: ModeConfig[]
	/** The mode shown in the page. */
	visualMode: string
	/** Its config, if it is a custom mode (only custom modes can be renamed or deleted). */
	customMode: ModeConfig | undefined
	/** Its display name, if the mode exists. */
	currentModeName: string | undefined
	onSelectMode: (modeConfig: ModeConfig) => void
	onRename: (customMode: ModeConfig, name: string) => void
	onCreate: () => void
	onDelete: (customMode: ModeConfig) => void
	onExport: () => void
	isExporting: boolean
}

/**
 * The mode picker with its search, and the create / rename / delete / export buttons next to it.
 * A rename shows at once (an optimistic name overlay) before the host pushes the saved mode back.
 */
export const ModeSelectorRow = ({
	modes,
	visualMode,
	customMode,
	currentModeName,
	onSelectMode,
	onRename,
	onCreate,
	onDelete,
	onExport,
	isExporting,
}: ModeSelectorRowProps) => {
	const { t } = useAppTranslation()

	// State for mode selection popover and search
	const [open, setOpen] = useState(false)
	const [searchValue, setSearchValue] = useState("")
	const searchInputRef = useRef<HTMLInputElement>(null)

	// Inline rename state for the mode dropdown row
	const [isRenamingMode, setIsRenamingMode] = useState(false)
	const [renameInputValue, setRenameInputValue] = useState("")
	const renameInputRef = useRef<HTMLInputElement>(null)

	// Optimistic rename map so search reflects new names immediately
	const [localRenames, setLocalRenames] = useState<Record<string, string>>({})
	// Display list that overlays optimistic names
	const displayModes = modes.map((m) => (localRenames[m.slug] ? { ...m, name: localRenames[m.slug] } : m))

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

	// Focus rename input when entering rename mode, with the name selected so typing replaces it
	useEffect(() => {
		if (isRenamingMode) {
			const id = setTimeout(() => {
				renameInputRef.current?.focus()
				renameInputRef.current?.select()
			}, 0)
			return () => clearTimeout(id)
		}
	}, [isRenamingMode])

	const handleStartRenameMode = () => {
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
		onRename(customMode, trimmed)
		// Optimistically reflect rename in UI/search immediately
		setLocalRenames((prev) => ({ ...prev, [visualMode]: trimmed }))
		setIsRenamingMode(false)
	}

	return (
		<div className="flex items-center gap-1 mb-block">
			{isRenamingMode ? (
				<>
					<Input
						ref={renameInputRef}
						value={renameInputValue}
						onChange={(e) => setRenameInputValue(e.target.value)}
						className="grow"
						placeholder={t("prompts:createModeDialog.name.placeholder")}
					/>
					<StandardTooltip content={t("settings:common.save")}>
						<Button
							aria-label={t("settings:common.save")}
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
							aria-label={t("settings:common.cancel")}
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
								<div className="flex items-center gap-1.5 truncate">
									<ModeIcon slug={visualMode} className="size-4" />
									<span className="truncate">
										{modeLabel(
											localRenames[visualMode] ??
												currentModeName ??
												t("prompts:modes.selectMode"),
										)}
									</span>
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
											<div className="py-2 px-1 text-sm">{t("prompts:modes.noMatchFound")}</div>
										)}
									</CommandEmpty>
									<CommandGroup>
										{displayModes
											.filter((modeConfig) =>
												searchValue
													? modeConfig.name.toLowerCase().includes(searchValue.toLowerCase())
													: true,
											)
											.map((modeConfig) => (
												<CommandItem
													key={modeConfig.slug}
													value={`${modeConfig.name} ${modeConfig.slug}`}
													onSelect={() => {
														onSelectMode(modeConfig)
														setOpen(false)
													}}
													data-testid={`mode-option-${modeConfig.slug}`}>
													<div className="flex items-center justify-between w-full">
														<ModeIcon slug={modeConfig.slug} className="size-4 mr-1.5" />
														<span
															style={{
																whiteSpace: "nowrap",
																overflow: "hidden",
																textOverflow: "ellipsis",
																flex: 2,
																minWidth: 0,
															}}>
															{modeLabel(modeConfig.name)}
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
							aria-label={t("prompts:modes.createNewMode")}
							variant="ghost"
							size="icon"
							onClick={onCreate}
							data-testid="add-mode-button">
							<span className="codicon codicon-add" />
						</Button>
					</StandardTooltip>

					{/* Edit (rename) mode - only enabled for custom modes */}
					<StandardTooltip content={t("settings:providers.renameProfile")}>
						<Button
							aria-label={t("settings:providers.renameProfile")}
							variant="ghost"
							size="icon"
							onClick={handleStartRenameMode}
							data-testid="rename-mode-button"
							disabled={!customMode}>
							<span className="codicon codicon-edit" />
						</Button>
					</StandardTooltip>

					{/* Delete mode - disabled for built-in modes */}
					<StandardTooltip content={t("prompts:createModeDialog.deleteMode")}>
						<Button
							aria-label={t("prompts:createModeDialog.deleteMode")}
							variant="ghost"
							size="icon"
							onClick={() => {
								if (customMode) {
									onDelete(customMode)
								}
							}}
							data-testid="delete-mode-button"
							disabled={!customMode}>
							<span className="codicon codicon-trash" />
						</Button>
					</StandardTooltip>

					{/* Export mode (kept here to the right of the dropdown) */}
					<StandardTooltip content={t("prompts:exportMode.title")}>
						<Button
							variant="ghost"
							size="icon"
							onClick={onExport}
							disabled={isExporting}
							title={t("prompts:exportMode.title")}
							data-testid="export-mode-toolbar-button">
							<Upload className="h-4 w-4" />
						</Button>
					</StandardTooltip>
				</>
			)}
		</div>
	)
}
