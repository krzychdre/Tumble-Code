import React from "react"

import type {
	ModeConfig,
	GroupEntry,
	PromptComponent,
	ToolGroup,
	CustomModePrompts,
	McpServer,
} from "@tumble-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Button, StandardTooltip, LabeledCheckbox } from "@src/components/ui"
import McpServerRestriction from "@src/components/modes/McpServerRestriction"

import { availableGroups, getGroupName } from "./modeGroups"

type ModeToolsSectionProps = {
	visualMode: string
	/** The selected mode (built-in or custom), if it exists. */
	currentMode: ModeConfig | undefined
	/** Its config if it is a custom mode: only custom modes can change their tool groups. */
	customMode: ModeConfig | undefined
	customModePrompts: CustomModePrompts | undefined
	mcpServers: McpServer[]
	isToolsEditMode: boolean
	onToggleToolsEditMode: () => void
	onUpdateCustomMode: (slug: string, modeConfig: ModeConfig) => void
	onUpdateAgentPrompt: (promptData: PromptComponent) => void
}

/**
 * The tool groups of the selected mode: a read-only list, or checkboxes while a custom mode is in
 * tools edit mode, plus the MCP server allowlist when the mode has the mcp group.
 */
export const ModeToolsSection = ({
	visualMode,
	currentMode,
	customMode,
	customModePrompts,
	mcpServers,
	isToolsEditMode,
	onToggleToolsEditMode,
	onUpdateCustomMode,
	onUpdateAgentPrompt,
}: ModeToolsSectionProps) => {
	const { t } = useAppTranslation()

	// Handler for group checkbox changes
	const handleGroupChange =
		(group: ToolGroup, customMode: ModeConfig | undefined) => (e: Event | React.FormEvent<HTMLElement>) => {
			if (!customMode) return // Prevent changes to built-in modes
			const target = (e as CustomEvent)?.detail?.target || (e.target as HTMLInputElement)
			const checked = target.checked
			const oldGroups = customMode.groups || []
			let newGroups: GroupEntry[]
			if (checked) {
				newGroups = [...oldGroups, group]
			} else {
				newGroups = oldGroups.filter((g) => getGroupName(g) !== group)
			}
			onUpdateCustomMode(customMode.slug, {
				...customMode,
				groups: newGroups,
				source: customMode.source || "global",
			})
		}

	return (
		<div className="mb-section">
			<div className="flex justify-between items-center mb-1">
				<div className="font-bold">{t("prompts:tools.title")}</div>
				{customMode && (
					<StandardTooltip
						content={isToolsEditMode ? t("prompts:tools.doneEditing") : t("prompts:tools.editTools")}>
						<Button
							aria-label={isToolsEditMode ? t("prompts:tools.doneEditing") : t("prompts:tools.editTools")}
							variant="ghost"
							size="icon"
							onClick={onToggleToolsEditMode}>
							<span className={`codicon codicon-${isToolsEditMode ? "check" : "edit"}`}></span>
						</Button>
					</StandardTooltip>
				)}
			</div>
			{!customMode && (
				<div className="text-sm text-vscode-descriptionForeground mb-row">
					{t("prompts:tools.builtInModesText")}
				</div>
			)}
			{isToolsEditMode && customMode ? (
				<>
					<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
						{availableGroups.map((group) => {
							const isGroupEnabled = customMode.groups?.some((g) => getGroupName(g) === group)

							return (
								<LabeledCheckbox
									key={group}
									checked={isGroupEnabled}
									onChange={handleGroupChange(group, customMode)}>
									{t(`prompts:tools.toolNames.${group}`)}
									{group === "edit" && (
										<div className="text-xs text-vscode-descriptionForeground mt-0.5">
											{t("prompts:tools.allowedFiles")}{" "}
											{(() => {
												const editGroup = currentMode?.groups?.find(
													(g) => Array.isArray(g) && g[0] === "edit" && g[1]?.fileRegex,
												)
												if (!Array.isArray(editGroup)) return t("prompts:allFiles")
												return editGroup[1].description || `/${editGroup[1].fileRegex}/`
											})()}
										</div>
									)}
								</LabeledCheckbox>
							)
						})}
					</div>
					{/* MCP Server Restriction: shown when the mcp group is enabled. Uses a
					    local cached-state buffer + 150 ms debounced flush to avoid host
					    round-trip flicker. See McpServerRestriction.tsx. */}
					{customMode.groups?.some((g) => getGroupName(g) === "mcp") && (
						<McpServerRestriction
							slug={customMode.slug}
							value={customMode.allowedMcpServers}
							mcpServers={mcpServers}
							onChange={(next) =>
								onUpdateCustomMode(customMode.slug, {
									...customMode,
									allowedMcpServers: next,
									source: customMode.source || "global",
								})
							}
						/>
					)}
				</>
			) : (
				<>
					<div className="text-sm text-vscode-foreground mb-row leading-relaxed">
						{(() => {
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
										const description = group[1].description || `/${group[1].fileRegex}/`
										return `${displayName} (${description})`
									}
									return displayName
								})
								.join(", ")
						})()}
					</div>
					{/* MCP Server Restriction for built-in modes. Built-in modes have no editable
					    ModeConfig and no "edit tools" toggle, so the allowlist is persisted via the
					    customModePrompts override path (updateAgentPrompt, then updatePrompt). Shown only
					    when the built-in mode includes the mcp tool group. */}
					{!customMode && currentMode?.groups?.some((g) => getGroupName(g) === "mcp") && (
						<McpServerRestriction
							slug={visualMode}
							value={(customModePrompts?.[visualMode] as PromptComponent | undefined)?.allowedMcpServers}
							mcpServers={mcpServers}
							onChange={(next) => onUpdateAgentPrompt({ allowedMcpServers: next })}
						/>
					)}
				</>
			)}
		</div>
	)
}
