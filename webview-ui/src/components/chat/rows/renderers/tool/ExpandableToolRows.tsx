import { useTranslation } from "react-i18next"
import { ThemedBadge } from "@src/components/ui"

import { ToolBlock } from "@src/components/common/ToolBlock"

import { headerStyle, toolIcon } from "../shared"
import type { ToolRendererProps } from "../types"

// Skill and slash command asks: a header, then a box with the name and source
// that expands to the description and arguments.

const boxClass = "mt-1 border border-vscode-editorGroup-border overflow-hidden"
const boxHeaderClass = "px-3 py-2.5"
const boxBodyClass = "font-display px-4 py-3 border-t border-vscode-editorGroup-border flex flex-col gap-2"

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
			<ToolBlock
				className={boxClass}
				headerClassName={boxHeaderClass}
				bodyClassName={boxBodyClass}
				isExpanded={isExpanded}
				onToggleExpand={toggleExpand}
				title={
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
				}>
				{(skillInfo.args || skillInfo.description) && (
					<>
						{skillInfo.description && (
							<div style={{ color: "var(--vscode-descriptionForeground)" }}>{skillInfo.description}</div>
						)}
						{skillInfo.args && (
							<div>
								<span style={{ fontWeight: "500" }}>Arguments: </span>
								<span style={{ color: "var(--vscode-descriptionForeground)" }}>{skillInfo.args}</span>
							</div>
						)}
					</>
				)}
			</ToolBlock>
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
			<ToolBlock
				className={boxClass}
				headerClassName={boxHeaderClass}
				bodyClassName={boxBodyClass}
				isExpanded={isExpanded}
				onToggleExpand={toggleExpand}
				title={
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
				}>
				{(slashCommandInfo.args || slashCommandInfo.description) && (
					<>
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
					</>
				)}
			</ToolBlock>
		</>
	)
}
