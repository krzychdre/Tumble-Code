import React, { useEffect, useMemo, useRef, useState } from "react"
import { getIconForFilePath, getIconUrlByName, getIconForDirectoryPath } from "vscode-material-icons"
import { t } from "i18next"
import { Settings } from "lucide-react"

import type { ModeConfig, Command } from "@tumble-code/types"

import {
	ContextMenuOptionType,
	ContextMenuQueryItem,
	getContextMenuOptions,
	SearchResult,
} from "@src/utils/context-mentions"
import { removeLeadingNonAlphanumeric } from "@src/utils/removeLeadingNonAlphanumeric"
import { vscode } from "@src/utils/vscode"
import { cn } from "@src/lib/utils"

interface ContextMenuProps {
	onSelect: (type: ContextMenuOptionType, value?: string) => void
	searchQuery: string
	inputValue: string
	onMouseDown: () => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	selectedType: ContextMenuOptionType | null
	queryItems: ContextMenuQueryItem[]
	modes?: ModeConfig[]
	loading?: boolean
	dynamicSearchResults?: SearchResult[]
	commands?: Command[]
}

/** Stable DOM id for a listbox option, used by `aria-activedescendant` (§2.5). */
const contextMenuOptionId = (option: ContextMenuQueryItem | undefined): string =>
	`context-menu-option-${option ? `${option.type}-${option.value ?? "none"}` : "none"}`

const ContextMenu: React.FC<ContextMenuProps> = ({
	onSelect,
	searchQuery,
	onMouseDown,
	selectedIndex,
	setSelectedIndex,
	selectedType,
	queryItems,
	modes,
	dynamicSearchResults = [],
	commands = [],
}) => {
	const [materialIconsBaseUri, setMaterialIconsBaseUri] = useState("")
	const menuRef = useRef<HTMLDivElement>(null)

	const filteredOptions = useMemo(() => {
		return getContextMenuOptions(searchQuery, selectedType, queryItems, dynamicSearchResults, modes, commands)
	}, [searchQuery, selectedType, queryItems, dynamicSearchResults, modes, commands])

	useEffect(() => {
		if (menuRef.current) {
			const selectedElement = menuRef.current.children[selectedIndex] as HTMLElement
			if (selectedElement) {
				const menuRect = menuRef.current.getBoundingClientRect()
				const selectedRect = selectedElement.getBoundingClientRect()

				if (selectedRect.bottom > menuRect.bottom) {
					menuRef.current.scrollTop += selectedRect.bottom - menuRect.bottom
				} else if (selectedRect.top < menuRect.top) {
					menuRef.current.scrollTop -= menuRect.top - selectedRect.top
				}
			}
		}
	}, [selectedIndex])

	// get the icons base uri on mount
	useEffect(() => {
		const w = window as any
		setMaterialIconsBaseUri(w.MATERIAL_ICONS_BASE_URI)
	}, [])

	const renderOptionContent = (option: ContextMenuQueryItem) => {
		switch (option.type) {
			case ContextMenuOptionType.SectionHeader:
				return (
					<span className="text-[10.5px] font-semibold uppercase tracking-wide text-vscode-descriptionForeground">
						{option.label}
					</span>
				)
			case ContextMenuOptionType.Mode:
				return (
					<div className="flex flex-col gap-0.5 min-w-0">
						<div className="leading-[1.2]">
							<span>{option.slashCommand}</span>
						</div>
						{option.description && (
							<span className="text-[0.9em] leading-[1.2] truncate text-vscode-descriptionForeground">
								{option.description}
							</span>
						)}
					</div>
				)
			case ContextMenuOptionType.Command:
				return (
					<div className="flex flex-col gap-0.5 min-w-0">
						<div className="leading-[1.2] flex items-center gap-1.5">
							<span>{option.slashCommand}</span>
							{option.argumentHint && (
								<span className="text-[0.9em] leading-[1.2] text-vscode-descriptionForeground">
									{option.argumentHint}
								</span>
							)}
						</div>
						{option.description && (
							<span className="text-[0.9em] leading-[1.2] truncate text-vscode-descriptionForeground">
								{option.description}
							</span>
						)}
					</div>
				)
			case ContextMenuOptionType.Problems:
				return <span>{t("chat:contextMenu.problems")}</span>
			case ContextMenuOptionType.Terminal:
				return <span>{t("chat:contextMenu.terminal")}</span>
			case ContextMenuOptionType.URL:
				return <span>{t("chat:contextMenu.url")}</span>
			case ContextMenuOptionType.NoResults:
				return <span>{t("chat:contextMenu.noResults")}</span>
			case ContextMenuOptionType.Git:
				if (option.value) {
					return (
						<div className="flex flex-col gap-0 min-w-0">
							<span className="leading-[1.2]">{option.label}</span>
							<span className="text-[0.85em] leading-[1.2] truncate text-vscode-descriptionForeground">
								{option.description}
							</span>
						</div>
					)
				} else {
					return <span>{t("chat:contextMenu.gitCommits")}</span>
				}
			case ContextMenuOptionType.File:
			case ContextMenuOptionType.OpenedFile:
			case ContextMenuOptionType.Folder:
				if (option.value) {
					// remove trailing slash
					const path = removeLeadingNonAlphanumeric(option.value || "").replace(/\/$/, "")
					const pathList = path.split("/")
					const filename = pathList.at(-1)
					const folderPath = pathList.slice(0, -1).join("/")
					return (
						<div className="flex-1 overflow-hidden flex gap-[0.5em] whitespace-nowrap items-center justify-between text-left">
							<span>{filename}</span>
							<span
								className="flex-1 truncate text-right text-[0.75em] text-vscode-descriptionForeground"
								style={{ direction: "rtl" }}>
								{folderPath}
							</span>
						</div>
					)
				} else {
					return <span>Add {option.type === ContextMenuOptionType.File ? "File" : "Folder"}</span>
				}
		}
	}

	const getIconForOption = (option: ContextMenuQueryItem): string => {
		switch (option.type) {
			case ContextMenuOptionType.Mode:
				return "symbol-misc"
			case ContextMenuOptionType.Command:
				return "play"
			case ContextMenuOptionType.OpenedFile:
				return "window"
			case ContextMenuOptionType.File:
				return "file"
			case ContextMenuOptionType.Folder:
				return "folder"
			case ContextMenuOptionType.Problems:
				return "warning"
			case ContextMenuOptionType.Terminal:
				return "terminal"
			case ContextMenuOptionType.URL:
				return "link"
			case ContextMenuOptionType.Git:
				return "git-commit"
			case ContextMenuOptionType.NoResults:
				return "info"
			default:
				return "file"
		}
	}

	const getMaterialIconForOption = (option: ContextMenuQueryItem): string => {
		// only take the last part of the path to handle both file and folder icons
		// since material-icons have specific folder icons, we use them if available
		const name = option.value?.split("/").filter(Boolean).at(-1) ?? ""
		const iconName =
			option.type === ContextMenuOptionType.Folder ? getIconForDirectoryPath(name) : getIconForFilePath(name)
		return getIconUrlByName(iconName, materialIconsBaseUri)
	}

	const isOptionSelectable = (option: ContextMenuQueryItem): boolean => {
		return (
			option.type !== ContextMenuOptionType.NoResults &&
			option.type !== ContextMenuOptionType.URL &&
			option.type !== ContextMenuOptionType.SectionHeader
		)
	}

	const handleSettingsClick = (e: React.MouseEvent) => {
		// Prevent any default behavior
		e.preventDefault()
		// Skills are the user-defined "/" entries, so the button opens the Skills section
		vscode.postMessage({
			type: "switchTab",
			tab: "settings",
			values: { section: "skills" },
		})
	}

	return (
		<div
			className="absolute bottom-[calc(100%-10px)] left-[15px] right-[15px] overflow-x-hidden"
			onMouseDown={onMouseDown}>
			<div
				ref={menuRef}
				role="listbox"
				aria-label={t("chat:contextMenu.menuLabel")}
				{...(isOptionSelectable(filteredOptions[selectedIndex] ?? ({} as ContextMenuQueryItem))
					? { "aria-activedescendant": contextMenuOptionId(filteredOptions[selectedIndex]) }
					: {})}
				className={cn(
					"z-[1000] flex flex-col max-h-[300px] overflow-y-auto overflow-x-hidden py-1",
					"bg-vscode-dropdown-background text-vscode-dropdown-foreground",
					"border border-frame-hover rounded-floating shadow-[0_4px_10px_var(--vscode-widget-shadow)]",
				)}>
				{/* Header with a button to the Skills settings */}
				{searchQuery === "/" && (
					<div className="p-2 flex items-start gap-4 justify-between">
						{searchQuery.length === 1 && (
							<div className="text-sm">
								<p className="font-bold text-base text-vscode-foreground mt-1 mb-0.5">
									{t("chat:slashCommands.title")}
								</p>
								<p className="text-xs mt-0.5 -mb-1 text-vscode-descriptionForeground">
									{t("chat:slashCommands.description")}
								</p>
							</div>
						)}
						<button
							className={cn(
								"mt-1 p-0.5 cursor-pointer rounded-control bg-transparent border-none",
								"text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-surface-hover",
								"focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-vscode-focusBorder",
							)}
							onClick={handleSettingsClick}
							onMouseDown={(e) => {
								e.stopPropagation()
								e.preventDefault()
							}}
							title={t("chat:slashCommands.manageSkills")}
							aria-label={t("chat:slashCommands.manageSkills")}>
							<Settings size={16} />
						</button>
					</div>
				)}
				{filteredOptions && filteredOptions.length > 0 ? (
					filteredOptions.map((option, index) => {
						const isSectionHeader = option.type === ContextMenuOptionType.SectionHeader
						const isSelected = index === selectedIndex && isOptionSelectable(option)
						return (
							<div
								key={`${option.type}-${option.value || index}`}
								id={contextMenuOptionId(option)}
								role="option"
								aria-selected={isSelected}
								onClick={() => isOptionSelectable(option) && onSelect(option.type, option.value)}
								className={cn(
									"relative flex items-center justify-between",
									isSectionHeader
										? "mx-2 px-1 pt-3 pb-1 mb-0.5 border-b border-frame cursor-default"
										: "mx-1 px-2 py-1 rounded-control",
									!isSectionHeader &&
										(isOptionSelectable(option) ? "cursor-pointer" : "cursor-default"),
									isSelected && "bg-selected",
								)}
								onMouseEnter={() => isOptionSelectable(option) && setSelectedIndex(index)}>
								<div className="relative flex items-center flex-1 min-w-0 overflow-hidden">
									{(option.type === ContextMenuOptionType.File ||
										option.type === ContextMenuOptionType.Folder ||
										option.type === ContextMenuOptionType.OpenedFile) && (
										<img
											src={getMaterialIconForOption(option)}
											alt=""
											aria-hidden="true"
											className="mr-1.5 shrink-0 size-4"
										/>
									)}
									{option.type !== ContextMenuOptionType.Mode &&
										option.type !== ContextMenuOptionType.Command &&
										option.type !== ContextMenuOptionType.File &&
										option.type !== ContextMenuOptionType.Folder &&
										option.type !== ContextMenuOptionType.OpenedFile &&
										option.type !== ContextMenuOptionType.SectionHeader &&
										getIconForOption(option) && (
											<i
												className={`codicon codicon-${getIconForOption(option)} mr-1.5 shrink-0 text-[14px]`}
												aria-hidden="true"
											/>
										)}
									{renderOptionContent(option)}
								</div>
								{(option.type === ContextMenuOptionType.File ||
									option.type === ContextMenuOptionType.Folder ||
									option.type === ContextMenuOptionType.Git) &&
									!option.value && (
										<i
											className="codicon codicon-chevron-right text-[10px] shrink-0 ml-2 text-vscode-descriptionForeground"
											aria-hidden="true"
										/>
									)}
							</div>
						)
					})
				) : (
					<div
						role="option"
						aria-selected={false}
						aria-disabled={true}
						className="p-1 flex items-center justify-center text-vscode-descriptionForeground">
						<span>{t("chat:contextMenu.noResults")}</span>
					</div>
				)}
			</div>
		</div>
	)
}

export default ContextMenu
