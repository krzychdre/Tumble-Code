import { useTranslation } from "react-i18next"
import { ThemedBadge } from "@src/components/ui"

import { ToolUseBlockHeader } from "@src/components/common/ToolUseBlock"

import { headerStyle, toolIcon } from "../shared"
import type { ToolRendererProps } from "../types"

// Skill and slash command asks: a header, then a box with the name and source
// that expands to the description and arguments.

const boxStyle = {
	marginTop: "4px",
	backgroundColor: "var(--vscode-editor-background)",
	border: "1px solid var(--vscode-editorGroup-border)",
	borderRadius: "4px",
	overflow: "hidden",
	cursor: "pointer",
} as const

const boxHeaderStyle = {
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "10px 12px",
} as const

const boxBodyStyle = {
	padding: "12px 16px",
	borderTop: "1px solid var(--vscode-editorGroup-border)",
	display: "flex",
	flexDirection: "column",
	gap: "8px",
} as const

/** A skill the model wants to load. */
export const SkillToolRow = ({ message, tool: skillInfo, isExpanded, toggleExpand }: ToolRendererProps) => {
	const { t } = useTranslation()
	return (
		<>
			<div style={headerStyle}>
				{toolIcon("book")}
				<span style={{ fontWeight: "bold" }}>
					{message.type === "ask" ? t("chat:skill.wantsToLoad") : t("chat:skill.didLoad")}
				</span>
			</div>
			<div style={boxStyle} onClick={toggleExpand}>
				<ToolUseBlockHeader className="group" style={boxHeaderStyle}>
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<span style={{ fontWeight: "500", fontSize: "var(--vscode-font-size)" }}>
							{skillInfo.skill}
						</span>
						{skillInfo.source && (
							<ThemedBadge style={{ fontSize: "calc(var(--vscode-font-size) - 2px)" }}>
								{skillInfo.source}
							</ThemedBadge>
						)}
					</div>
					<span
						className={`codicon codicon-chevron-${isExpanded ? "up" : "down"} opacity-0 group-hover:opacity-100 transition-opacity duration-200`}></span>
				</ToolUseBlockHeader>
				{isExpanded && (skillInfo.args || skillInfo.description) && (
					<div style={boxBodyStyle}>
						{skillInfo.description && (
							<div style={{ color: "var(--vscode-descriptionForeground)" }}>{skillInfo.description}</div>
						)}
						{skillInfo.args && (
							<div>
								<span style={{ fontWeight: "500" }}>Arguments: </span>
								<span style={{ color: "var(--vscode-descriptionForeground)" }}>{skillInfo.args}</span>
							</div>
						)}
					</div>
				)}
			</div>
		</>
	)
}

/** A slash command the model wants to run. */
export const RunSlashCommandToolRow = ({
	message,
	tool: slashCommandInfo,
	isExpanded,
	toggleExpand,
}: ToolRendererProps) => {
	const { t } = useTranslation()
	return (
		<>
			<div style={headerStyle}>
				{toolIcon("play")}
				<span style={{ fontWeight: "bold" }}>
					{message.type === "ask" ? t("chat:slashCommand.wantsToRun") : t("chat:slashCommand.didRun")}
				</span>
			</div>
			<div style={boxStyle} onClick={toggleExpand}>
				<ToolUseBlockHeader className="group" style={boxHeaderStyle}>
					<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
						<span style={{ fontWeight: "500", fontSize: "var(--vscode-font-size)" }}>
							/{slashCommandInfo.command}
						</span>
						{slashCommandInfo.source && (
							<ThemedBadge style={{ fontSize: "calc(var(--vscode-font-size) - 2px)" }}>
								{slashCommandInfo.source}
							</ThemedBadge>
						)}
					</div>
					<span
						className={`codicon codicon-chevron-${isExpanded ? "up" : "down"} opacity-0 group-hover:opacity-100 transition-opacity duration-200`}></span>
				</ToolUseBlockHeader>
				{isExpanded && (slashCommandInfo.args || slashCommandInfo.description) && (
					<div style={boxBodyStyle}>
						{slashCommandInfo.args && (
							<div>
								<span style={{ fontWeight: "500" }}>Arguments: </span>
								<span style={{ color: "var(--vscode-descriptionForeground)" }}>
									{slashCommandInfo.args}
								</span>
							</div>
						)}
						{slashCommandInfo.description && (
							<div style={{ color: "var(--vscode-descriptionForeground)" }}>
								{slashCommandInfo.description}
							</div>
						)}
					</div>
				)}
			</div>
		</>
	)
}
