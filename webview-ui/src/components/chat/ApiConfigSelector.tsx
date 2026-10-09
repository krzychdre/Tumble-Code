import { useState, useMemo, useCallback } from "react"
import { Fzf } from "fzf"

import { cn } from "@/lib/utils"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { IconButton, Input, Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { Button } from "@/components/ui"
import { ModeIcon, modeLabel } from "./modeIcon"

// Above this many target modes, applying requires an explicit confirmation step.
const LARGE_MODE_ASSIGN_THRESHOLD = 10

interface ApiConfigSelectorProps {
	value: string
	displayName: string
	disabled?: boolean
	title: string
	onChange: (value: string) => void
	triggerClassName?: string
	listApiConfigMeta: Array<{ id: string; name: string; modelId?: string }>
	pinnedApiConfigs?: Record<string, boolean>
	togglePinnedApiConfig: (id: string) => void
	lockApiConfigAcrossModes: boolean
	onToggleLockApiConfig: () => void
	availableModes?: Array<{ slug: string; name: string }>
	modeApiConfigs?: Record<string, string>
}

export const ApiConfigSelector = ({
	value,
	displayName,
	disabled = false,
	title,
	onChange,
	triggerClassName = "",
	listApiConfigMeta,
	pinnedApiConfigs,
	togglePinnedApiConfig,
	lockApiConfigAcrossModes,
	onToggleLockApiConfig,
	availableModes = [],
	modeApiConfigs,
}: ApiConfigSelectorProps) => {
	const { t } = useAppTranslation()
	const [open, setOpen] = useState(false)
	const [searchValue, setSearchValue] = useState("")
	const portalContainer = useRooPortal("roo-portal")

	// "Apply this profile to many modes" sub-panel state.
	const [showModesPanel, setShowModesPanel] = useState(false)
	const [selectedModeSlugs, setSelectedModeSlugs] = useState<Set<string>>(new Set())
	const [confirming, setConfirming] = useState(false)

	const openModesPanel = useCallback(() => {
		// All modes checked by default.
		setSelectedModeSlugs(new Set(availableModes.map((m) => m.slug)))
		setConfirming(false)
		setShowModesPanel(true)
	}, [availableModes])

	const closeModesPanel = useCallback(() => {
		setShowModesPanel(false)
		setConfirming(false)
	}, [])

	const toggleModeSlug = useCallback((slug: string) => {
		setConfirming(false)
		setSelectedModeSlugs((prev) => {
			const next = new Set(prev)
			if (next.has(slug)) {
				next.delete(slug)
			} else {
				next.add(slug)
			}
			return next
		})
	}, [])

	const handleApplyToModes = useCallback(() => {
		// Preserve mode order from availableModes rather than Set insertion order.
		const modeSlugs = availableModes.map((m) => m.slug).filter((slug) => selectedModeSlugs.has(slug))

		if (modeSlugs.length === 0) {
			return
		}

		// Gate large fan-outs behind an explicit confirmation.
		if (modeSlugs.length >= LARGE_MODE_ASSIGN_THRESHOLD && !confirming) {
			setConfirming(true)
			return
		}

		vscode.postMessage({
			type: "assignCurrentApiConfigToModes",
			values: { configId: value, modeSlugs },
		})

		setOpen(false)
		closeModesPanel()
	}, [availableModes, selectedModeSlugs, confirming, value, closeModesPanel])

	// Create searchable items for fuzzy search.
	const searchableItems = useMemo(
		() =>
			listApiConfigMeta.map((config) => ({
				original: config,
				searchStr: config.name,
			})),
		[listApiConfigMeta],
	)

	// Create Fzf instance.
	const fzfInstance = useMemo(
		() => new Fzf(searchableItems, { selector: (item) => item.searchStr }),
		[searchableItems],
	)

	// Filter configs based on search.
	const filteredConfigs = useMemo(() => {
		if (!searchValue) {
			return listApiConfigMeta
		}

		const matchingItems = fzfInstance.find(searchValue).map((result) => result.item.original)
		return matchingItems
	}, [listApiConfigMeta, searchValue, fzfInstance])

	// Separate pinned and unpinned configs.
	const { pinnedConfigs, unpinnedConfigs } = useMemo(() => {
		const pinned = filteredConfigs.filter((config) => pinnedApiConfigs?.[config.id])
		const unpinned = filteredConfigs.filter((config) => !pinnedApiConfigs?.[config.id])
		return { pinnedConfigs: pinned, unpinnedConfigs: unpinned }
	}, [filteredConfigs, pinnedApiConfigs])

	const handleSelect = useCallback(
		(configId: string) => {
			onChange(configId)
			setOpen(false)
			setSearchValue("")
		},
		[onChange],
	)

	const handleEditClick = useCallback(() => {
		vscode.postMessage({ type: "switchTab", tab: "settings" })
		setOpen(false)
	}, [])

	const renderConfigItem = useCallback(
		(config: { id: string; name: string; modelId?: string }, isPinned: boolean) => {
			const isCurrentConfig = config.id === value

			return (
				<div
					key={config.id}
					className={cn(
						"relative mx-1 px-2.5 py-1.5 text-sm cursor-pointer flex items-center group rounded-control",
						isCurrentConfig ? "bg-selected" : "hover:bg-surface-hover",
					)}>
					{/* A real button reachable with Tab; its ::before covers the whole row, so a
					    click anywhere on the row selects, while the pin button sits above it. */}
					<button
						type="button"
						aria-pressed={isCurrentConfig}
						onClick={() => handleSelect(config.id)}
						className={cn(
							"flex-1 min-w-0 flex items-center gap-1 overflow-hidden text-left cursor-pointer",
							"before:absolute before:inset-0 before:content-['']",
							"before:rounded-control",
							"focus-visible:outline-none focus-visible:before:outline focus-visible:before:outline-1 focus-visible:before:outline-vscode-focusBorder focus-visible:before:-outline-offset-1",
						)}>
						<span className="flex-shrink-0">{config.name}</span>
						{config.modelId && (
							<span
								className="text-vscode-descriptionForeground min-w-0 overflow-hidden"
								style={{ direction: "rtl", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
								{config.modelId}
							</span>
						)}
					</button>
					<div className="relative flex items-center gap-1">
						{isCurrentConfig && (
							<div className="size-5 p-1 flex items-center justify-center">
								<span className="codicon codicon-check text-xs text-vscode-focusBorder" aria-hidden="true" />
							</div>
						)}
						<StandardTooltip content={isPinned ? t("chat:unpin") : t("chat:pin")}>
							<Button
								aria-label={isPinned ? t("chat:unpin") : t("chat:pin")}
								variant="ghost"
								size="icon"
								onClick={(e) => {
									e.stopPropagation()
									togglePinnedApiConfig(config.id)
									vscode.postMessage({ type: "toggleApiConfigPin", text: config.id })
								}}
								className={cn(
									"size-5 flex items-center justify-center",
									isPinned
										? "bg-accent text-vscode-foreground"
										: "text-vscode-descriptionForeground hover:text-vscode-foreground",
								)}>
								<span className="codicon codicon-pin text-xs" />
							</Button>
						</StandardTooltip>
					</div>
				</div>
			)
		},
		[value, handleSelect, t, togglePinnedApiConfig],
	)

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next)
				if (!next) {
					closeModesPanel()
				}
			}}
			data-testid="api-config-selector-root">
			<StandardTooltip content={title}>
				<PopoverTrigger
					disabled={disabled}
					data-testid="dropdown-trigger"
					className={cn(
						"min-w-0 inline-flex items-center relative whitespace-nowrap h-[22px] px-[7px] text-xs rounded-control",
						"bg-transparent border border-frame text-vscode-foreground",
						"transition-colors duration-150 focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-vscode-focusBorder",
						disabled
							? "opacity-50 cursor-not-allowed"
							: "hover:bg-surface-hover hover:border-frame-hover cursor-pointer",
						triggerClassName,
					)}>
					<span className="truncate">{displayName}</span>
				</PopoverTrigger>
			</StandardTooltip>
			<PopoverContent
				align="start"
				sideOffset={4}
				container={portalContainer}
				className="p-0 overflow-hidden w-[300px]">
				<div className="flex flex-col w-full">
					{showModesPanel ? (
						<div className="flex flex-col w-full">
							{/* Header */}
							<div className="p-3 border-b border-frame">
								<p className="text-xs text-vscode-descriptionForeground m-0">
									{t("chat:applyConfigToModes.description", { config: displayName })}
								</p>
							</div>

							{/* Select all / none */}
							<div className="flex flex-row items-center gap-2 px-3 py-1.5 border-b border-frame">
								<button
									type="button"
									className="text-xs text-vscode-textLink-foreground bg-transparent border-none p-0 cursor-pointer hover:underline"
									onClick={() => setSelectedModeSlugs(new Set(availableModes.map((m) => m.slug)))}>
									{t("chat:applyConfigToModes.selectAll")}
								</button>
								<span className="text-vscode-descriptionForeground" aria-hidden="true">
									·
								</span>
								<button
									type="button"
									className="text-xs text-vscode-textLink-foreground bg-transparent border-none p-0 cursor-pointer hover:underline"
									onClick={() => setSelectedModeSlugs(new Set())}>
									{t("chat:applyConfigToModes.selectNone")}
								</button>
							</div>

							{/* Mode checklist */}
							<div
								className="max-h-[300px] overflow-y-auto py-1"
								role="group"
								aria-label={t("chat:applyConfigToModes.modeList")}>
								{availableModes.map((mode) => {
									const alreadyAssigned = modeApiConfigs?.[mode.slug] === value
									return (
										<label
											key={mode.slug}
											className="mx-1 px-2.5 py-1.5 text-sm cursor-pointer flex items-center gap-2 rounded-control hover:bg-surface-hover">
											<input
												type="checkbox"
												aria-label={modeLabel(mode.name)}
												checked={selectedModeSlugs.has(mode.slug)}
												onChange={() => toggleModeSlug(mode.slug)}
											/>
											<ModeIcon slug={mode.slug} className="size-4" />
											<span className="flex-1 min-w-0 truncate">{modeLabel(mode.name)}</span>
											{alreadyAssigned && (
												<span className="text-vscode-descriptionForeground text-xs flex-shrink-0">
													{t("chat:applyConfigToModes.current")}
												</span>
											)}
										</label>
									)
								})}
							</div>

							{/* Footer */}
							<div className="flex flex-row items-center justify-between gap-2 px-2 py-2 border-t border-frame">
								<Button variant="ghost" size="sm" onClick={closeModesPanel}>
									{t("chat:applyConfigToModes.back")}
								</Button>
								{confirming ? (
									<div className="flex flex-row items-center gap-2 min-w-0">
										<span className="text-xs text-vscode-descriptionForeground truncate">
											{t("chat:applyConfigToModes.confirmPrompt", {
												count: selectedModeSlugs.size,
											})}
										</span>
										<Button size="sm" onClick={handleApplyToModes}>
											{t("chat:applyConfigToModes.confirm")}
										</Button>
									</div>
								) : (
									<Button
										size="sm"
										disabled={selectedModeSlugs.size === 0}
										onClick={handleApplyToModes}>
										{t("chat:applyConfigToModes.apply")}
									</Button>
								)}
							</div>
						</div>
					) : (
						<>
							{/* Search input or info blurb */}
							{listApiConfigMeta.length > 6 ? (
								<div className="relative p-2 border-b border-frame">
									<Input
										aria-label={t("common:ui.search_placeholder")}
										value={searchValue}
										onChange={(e) => setSearchValue(e.target.value)}
										placeholder={t("common:ui.search_placeholder")}
										className="text-xs pr-7"
										autoFocus
									/>
									{searchValue.length > 0 && (
										<div className="absolute right-4 top-0 bottom-0 flex items-center justify-center">
											<span
												className="codicon codicon-close text-vscode-descriptionForeground hover:text-vscode-foreground text-xs cursor-pointer"
												onClick={() => setSearchValue("")}
											/>
										</div>
									)}
								</div>
							) : (
								<div className="p-3 border-b border-frame">
									<p className="text-xs text-vscode-descriptionForeground m-0">
										{t("prompts:apiConfiguration.select")}
									</p>
								</div>
							)}

							{/* Config list - single scroll container */}
							{filteredConfigs.length === 0 && searchValue ? (
								<div className="py-2 px-3 text-sm text-vscode-descriptionForeground">
									{t("common:ui.no_results")}
								</div>
							) : (
								<div className="max-h-[300px] overflow-y-auto">
									{/* Pinned configs - sticky header */}
									{pinnedConfigs.length > 0 && (
										<div
											className={cn(
												"sticky top-0 z-10 bg-popover py-1",
												unpinnedConfigs.length > 0 && "border-b border-frame",
											)}
											role="group"
											aria-label={t("chat:apiConfigGroups.pinned")}>
											<div
												aria-hidden="true"
												className="px-3.5 pt-1 pb-0.5 text-[10.5px] uppercase tracking-wide text-vscode-descriptionForeground">
												{t("chat:apiConfigGroups.pinned")}
											</div>
											{pinnedConfigs.map((config) => renderConfigItem(config, true))}
										</div>
									)}

									{/* Unpinned configs */}
									{unpinnedConfigs.length > 0 && (
										<div className="py-1" role="group" aria-label={t("chat:apiConfigGroups.all")}>
											{pinnedConfigs.length > 0 && (
												<div
													aria-hidden="true"
													className="px-3.5 pt-1 pb-0.5 text-[10.5px] uppercase tracking-wide text-vscode-descriptionForeground">
													{t("chat:apiConfigGroups.all")}
												</div>
											)}
											{unpinnedConfigs.map((config) => renderConfigItem(config, false))}
										</div>
									)}
								</div>
							)}

							{/* Bottom bar with buttons on left and title on right */}
							<div className="flex flex-row items-center justify-between px-2 py-2 border-t border-frame">
								<div className="flex flex-row gap-1">
									<IconButton
										icon="codicon-settings-gear"
										title={t("chat:edit")}
										onClick={handleEditClick}
										tooltip={false}
									/>
									<IconButton
										icon={lockApiConfigAcrossModes ? "codicon-lock" : "codicon-unlock"}
										title={
											lockApiConfigAcrossModes
												? t("chat:unlockApiConfigAcrossModes")
												: t("chat:lockApiConfigAcrossModes")
										}
										className={
											lockApiConfigAcrossModes
												? "text-vscode-focusBorder"
												: "text-vscode-descriptionForeground"
										}
										onClick={onToggleLockApiConfig}
									/>
									{availableModes.length > 0 && (
										<IconButton
											icon="codicon-checklist"
											title={t("chat:applyConfigToModes.button")}
											className="text-vscode-descriptionForeground"
											onClick={openModesPanel}
										/>
									)}
								</div>

								{/* Info icon and title on the right with matching spacing */}
								<div className="flex items-center gap-1 pr-1">
									{listApiConfigMeta.length > 6 && (
										<StandardTooltip content={t("prompts:apiConfiguration.select")}>
											<span
												className="codicon codicon-info text-xs text-vscode-descriptionForeground hover:text-vscode-foreground cursor-help"
												aria-hidden="true"
											/>
										</StandardTooltip>
									)}
									<h4 className="m-0 font-medium text-sm text-vscode-descriptionForeground">
										{t("prompts:apiConfiguration.title")}
									</h4>
								</div>
							</div>
						</>
					)}
				</div>
			</PopoverContent>
		</Popover>
	)
}
