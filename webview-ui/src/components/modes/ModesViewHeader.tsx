import React, { useState, useEffect } from "react"
import { Trans } from "react-i18next"
import { Download } from "lucide-react"

import { vscode } from "@src/utils/vscode"
import { buildDocLink } from "@src/utils/docLinks"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip, Link } from "@src/components/ui"

type ModesViewHeaderProps = {
	onImport: () => void
	isImporting: boolean
}

/** Title row of the modes page: the mode config file menu, the marketplace and import buttons. */
export const ModesViewHeader = ({ onImport, isImporting }: ModesViewHeaderProps) => {
	const { t } = useAppTranslation()
	const [showConfigMenu, setShowConfigMenu] = useState(false)

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

	return (
		<>
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
							onClick={onImport}
							disabled={isImporting}
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
		</>
	)
}
