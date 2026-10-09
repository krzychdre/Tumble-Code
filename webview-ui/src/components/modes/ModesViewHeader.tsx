import React, { useState, useEffect, useId, useRef } from "react"
import { Download } from "lucide-react"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip } from "@src/components/ui"

import { SectionHeader } from "../settings/SectionHeader"

type ModesViewHeaderProps = {
	onImport: () => void
	isImporting: boolean
}

/** Section header of the modes page, with the mode config file menu, the marketplace and import buttons. */
export const ModesViewHeader = ({ onImport, isImporting }: ModesViewHeaderProps) => {
	const { t } = useAppTranslation()
	const [showConfigMenu, setShowConfigMenu] = useState(false)
	const menuId = useId()
	const triggerRef = useRef<HTMLButtonElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)

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

	// Menu button pattern: an opened menu takes focus on its first item, so the
	// Arrow keys work at once. A mouse user does not see the move.
	useEffect(() => {
		if (showConfigMenu) {
			menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
		}
	}, [showConfigMenu])

	const closeMenuToTrigger = () => {
		setShowConfigMenu(false)
		triggerRef.current?.focus()
	}

	const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
		const current = items.indexOf(document.activeElement as HTMLButtonElement)
		const moveTo = (index: number) => items[(index + items.length) % items.length]?.focus()
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault()
				moveTo(current + 1)
				break
			case "ArrowUp":
				e.preventDefault()
				moveTo(current - 1)
				break
			case "Home":
				e.preventDefault()
				moveTo(0)
				break
			case "End":
				e.preventDefault()
				moveTo(items.length - 1)
				break
			case "Escape":
				e.preventDefault()
				e.stopPropagation()
				closeMenuToTrigger()
				break
		}
	}

	const pickMenuItem = (action: () => void) => {
		action()
		closeMenuToTrigger()
	}

	const menuItemClass =
		"block w-full text-left bg-transparent border-0 px-2 py-1.5 cursor-pointer rounded-control text-vscode-foreground text-sm hover:bg-surface-hover focus:bg-surface-hover focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-vscode-focusBorder"

	return (
		<SectionHeader
			description={t("prompts:modes.createModeHelpText")}
			actions={
				// Clicks inside the actions must not reach the document listener that closes the menu.
				<div onClick={(e) => e.stopPropagation()} className="flex gap-2">
					<div
						className="relative inline-block"
						onBlur={(e) => {
							// Close once focus leaves both the trigger and the menu (Tab away).
							if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
								setShowConfigMenu(false)
							}
						}}>
						<StandardTooltip content={t("prompts:modes.editModesConfig")}>
							<Button
								ref={triggerRef}
								aria-label={t("prompts:modes.editModesConfig")}
								aria-haspopup="menu"
								aria-expanded={showConfigMenu}
								aria-controls={showConfigMenu ? menuId : undefined}
								variant="ghost"
								size="icon"
								className="flex"
								onClick={(e: React.MouseEvent) => {
									e.preventDefault()
									e.stopPropagation()
									setShowConfigMenu((prev) => !prev)
								}}
								onKeyDown={(e: React.KeyboardEvent) => {
									if (e.key === "ArrowDown" && !showConfigMenu) {
										e.preventDefault()
										setShowConfigMenu(true)
									}
								}}>
								<span className="codicon codicon-json"></span>
							</Button>
						</StandardTooltip>
						{showConfigMenu && (
							<div
								ref={menuRef}
								id={menuId}
								role="menu"
								aria-label={t("prompts:modes.editModesConfig")}
								onKeyDown={onMenuKeyDown}
								onClick={(e) => e.stopPropagation()}
								onMouseDown={(e) => e.stopPropagation()}
								className="absolute top-full right-0 w-[200px] mt-1 p-1 bg-vscode-dropdown-background border border-frame-hover rounded-floating shadow-lg z-[1000]">
								<button
									type="button"
									role="menuitem"
									tabIndex={-1}
									className={menuItemClass}
									// Keep focus where it is while the mouse presses; the click does the work.
									onMouseDown={(e) => e.preventDefault()}
									onClick={() =>
										pickMenuItem(() =>
											vscode.postMessage({
												type: "openCustomModesSettings",
											}),
										)
									}>
									{t("prompts:modes.editGlobalModes")}
								</button>
								<button
									type="button"
									role="menuitem"
									tabIndex={-1}
									className={menuItemClass}
									onMouseDown={(e) => e.preventDefault()}
									onClick={() =>
										pickMenuItem(() =>
											vscode.postMessage({
												type: "openFile",
												text: "./.roomodes",
												values: {
													create: true,
													content: JSON.stringify({ customModes: [] }, null, 2),
												},
											}),
										)
									}>
									{t("prompts:modes.editProjectModes")}
								</button>
							</div>
						)}
					</div>
					<StandardTooltip content={t("chat:modeSelector.marketplace")}>
						<Button
							aria-label={t("chat:modeSelector.marketplace")}
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
							onClick={onImport}
							disabled={isImporting}
							title={t("prompts:modes.importMode")}
							data-testid="import-mode-toolbar-button">
							<Download className="h-4 w-4" />
						</Button>
					</StandardTooltip>
				</div>
			}>
			{t("prompts:modes.title")}
		</SectionHeader>
	)
}
