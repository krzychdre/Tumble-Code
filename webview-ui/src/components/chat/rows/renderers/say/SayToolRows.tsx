import { useTranslation } from "react-i18next"
import { FileCode2, History } from "lucide-react"

import type { ClineSayTool } from "@roo-code/types"

import { safeJsonParse, toolPayloadReadSummary } from "@roo-code/core/browser"

import { RunSlashCommandToolRow } from "../tool/ExpandableToolRows"
import { headerStyle } from "../shared"
import type { RowRendererProps, SayToolRendererMap, ToolRendererProps } from "../types"

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

/** A read of a task artifact (or, in old histories, of a command's output): the range or the search. */
export const ReadArtifactSayRow = ({ tool: sayTool }: ToolRendererProps) => {
	const { t } = useTranslation()

	const infoText = toolPayloadReadSummary(sayTool)

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
	// The same row as the tool ask: the say kind only changes the title to "ran".
	runSlashCommand: RunSlashCommandToolRow,
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
