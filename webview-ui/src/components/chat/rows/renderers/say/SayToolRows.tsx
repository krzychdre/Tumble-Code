import { useTranslation } from "react-i18next"
import { FileCode2, History } from "lucide-react"
import { VSCodeBadge } from "@vscode/webview-ui-toolkit/react"

import type { ClineSayTool } from "@roo-code/types"

import { safeJsonParse } from "@roo/core"

import { ToolUseBlock, ToolUseBlockHeader } from "@src/components/common/ToolUseBlock"

import { headerStyle } from "../shared"
import type { RowRendererProps, SayToolRendererMap, ToolRendererProps } from "../types"

/** A slash command the model ran. */
export const RunSlashCommandSayRow = ({ tool: slashCommandInfo }: ToolRendererProps) => {
	const { t } = useTranslation()
	return (
		<>
			<div style={headerStyle}>
				<span
					className="codicon codicon-terminal-cmd"
					style={{
						color: "var(--vscode-foreground)",
						marginBottom: "-1.5px",
					}}></span>
				<span style={{ fontWeight: "bold" }}>{t("chat:slashCommand.didRun")}</span>
			</div>
			<div className="pl-6">
				<ToolUseBlock>
					<ToolUseBlockHeader
						style={{
							display: "flex",
							flexDirection: "column",
							alignItems: "flex-start",
							gap: "4px",
							padding: "10px 12px",
						}}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								width: "100%",
							}}>
							<span
								style={{
									fontWeight: "500",
									fontSize: "var(--vscode-font-size)",
								}}>
								/{slashCommandInfo.command}
							</span>
							{slashCommandInfo.args && (
								<span
									style={{
										color: "var(--vscode-descriptionForeground)",
										fontSize: "var(--vscode-font-size)",
									}}>
									{slashCommandInfo.args}
								</span>
							)}
						</div>
						{slashCommandInfo.description && (
							<div
								style={{
									color: "var(--vscode-descriptionForeground)",
									fontSize: "calc(var(--vscode-font-size) - 1px)",
								}}>
								{slashCommandInfo.description}
							</div>
						)}
						{slashCommandInfo.source && (
							<div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
								<VSCodeBadge style={{ fontSize: "calc(var(--vscode-font-size) - 2px)" }}>
									{slashCommandInfo.source}
								</VSCodeBadge>
							</div>
						)}
					</ToolUseBlockHeader>
				</ToolUseBlock>
			</div>
		</>
	)
}

/** A search of the task history, with the query. */
export const SearchTaskHistorySayRow = ({ tool: sayTool }: ToolRendererProps) => {
	const { t } = useTranslation()
	return (
		<div style={headerStyle}>
			<History className="w-4 shrink-0" aria-label="Search task history icon" />
			<span style={{ fontWeight: "bold" }}>{t("chat:searchTaskHistory.title")}</span>
			{sayTool.query && (
				<span className="text-xs ml-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
					({sayTool.query})
				</span>
			)}
		</div>
	)
}

const formatBytes = (bytes: number) => {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A read of a task artifact (or, in old histories, of a command's output): the range or the search. */
export const ReadArtifactSayRow = ({ tool: sayTool }: ToolRendererProps) => {
	const { t } = useTranslation()

	// Determine if this is a search operation
	const isSearch = sayTool.searchPattern !== undefined

	let infoText = ""
	if (isSearch) {
		// Search mode: show pattern and match count
		const matchText =
			sayTool.matchCount !== undefined
				? sayTool.matchCount === 1
					? "1 match"
					: `${sayTool.matchCount} matches`
				: ""
		infoText = `search: "${sayTool.searchPattern}"${matchText ? ` • ${matchText}` : ""}`
	} else if (sayTool.readStart !== undefined && sayTool.readEnd !== undefined && sayTool.totalBytes !== undefined) {
		// Read mode: show byte range
		infoText = `${formatBytes(sayTool.readStart)} - ${formatBytes(sayTool.readEnd)} of ${formatBytes(sayTool.totalBytes)}`
	} else if (sayTool.totalBytes !== undefined) {
		infoText = formatBytes(sayTool.totalBytes)
	}

	return (
		<div style={headerStyle}>
			<FileCode2 className="w-4 shrink-0" aria-label="Read artifact icon" />
			<span style={{ fontWeight: "bold" }}>
				{sayTool.tool === "readArtifact" ? t("chat:readArtifact.title") : t("chat:readCommandOutput.title")}
			</span>
			{infoText && (
				<span className="text-xs ml-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
					({infoText})
				</span>
			)}
		</div>
	)
}

/** Renderers for a say "tool" message, by the payload's `tool`. A tool with no entry renders nothing. */
export const SAY_TOOL_RENDERERS: SayToolRendererMap = {
	runSlashCommand: RunSlashCommandSayRow,
	searchTaskHistory: SearchTaskHistorySayRow,
	readArtifact: ReadArtifactSayRow,
	readCommandOutput: ReadArtifactSayRow,
}

/** A say "tool" message: dispatches on the payload's tool name. */
export const SayToolRow = (props: RowRendererProps) => {
	const sayTool = safeJsonParse<ClineSayTool>(props.message.text)
	if (!sayTool) return null
	const Renderer = SAY_TOOL_RENDERERS[sayTool.tool]
	return Renderer ? <Renderer {...props} tool={sayTool} /> : null
}
