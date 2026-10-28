import { useTranslation } from "react-i18next"
import { FileCode2, History, Hourglass } from "lucide-react"

import type { ClineSayTool } from "@tumble-code/types"

import { safeJsonParse, toolPayloadReadSummary } from "@tumble-code/core/browser"

import { RunSlashCommandToolRow } from "../tool/ExpandableToolRows"
import { headerStyle } from "../shared"
import type { RowRendererProps, SayToolRendererMap, ToolRendererProps } from "../types"

/** A search of the task history, with the query. */
export const SearchTaskHistorySayRow = ({ tool: sayTool }: ToolRendererProps) => {
	const { t } = useTranslation()
	return (
		<div style={headerStyle}>
			<History className="w-4 shrink-0" aria-hidden="true" />
			<span style={{ fontWeight: "bold" }}>{t("chat:searchTaskHistory.title")}</span>
			{sayTool.query && (
				<span className="text-xs ml-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
					({sayTool.query})
				</span>
			)}
		</div>
	)
}

/** A search of earlier sessions with its query, or a read of one with its title. */
export const PastSessionSayRow = ({ tool: sayTool }: ToolRendererProps) => {
	const { t } = useTranslation()
	const subject = sayTool.tool === "searchPastSessions" ? sayTool.query : sayTool.description
	return (
		<div style={headerStyle}>
			<History className="w-4 shrink-0" aria-hidden="true" />
			<span style={{ fontWeight: "bold" }}>
				{sayTool.tool === "searchPastSessions"
					? t("chat:searchPastSessions.title")
					: t("chat:readPastSession.title")}
			</span>
			{subject && (
				<span className="text-xs ml-1" style={{ color: "var(--vscode-descriptionForeground)" }}>
					({subject})
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
			<FileCode2 className="w-4 shrink-0" aria-hidden="true" />
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

/** The parent task waits for its parallel subagents (wait_for_subagents). */
export const WaitForSubagentsSayRow = () => {
	const { t } = useTranslation()
	return (
		<div style={headerStyle}>
			<Hourglass className="w-4 shrink-0" aria-hidden="true" />
			<span style={{ fontWeight: "bold" }}>{t("chat:waitForSubagents.title")}</span>
		</div>
	)
}

/** Renderers for a say "tool" message, by the payload's `tool`. A tool with no entry renders nothing. */
export const SAY_TOOL_RENDERERS: SayToolRendererMap = {
	// The same row as the tool ask: the say kind only changes the title to "ran".
	runSlashCommand: RunSlashCommandToolRow,
	searchTaskHistory: SearchTaskHistorySayRow,
	searchPastSessions: PastSessionSayRow,
	readPastSession: PastSessionSayRow,
	readArtifact: ReadArtifactSayRow,
	readCommandOutput: ReadArtifactSayRow,
	waitForSubagents: WaitForSubagentsSayRow,
}

/** A say "tool" message: dispatches on the payload's tool name. */
export const SayToolRow = (props: RowRendererProps) => {
	const sayTool = safeJsonParse<ClineSayTool>(props.message.text)
	if (!sayTool) return null
	const Renderer = SAY_TOOL_RENDERERS[sayTool.tool]
	return Renderer ? <Renderer {...props} tool={sayTool} /> : null
}
