import { useTranslation } from "react-i18next"
import { MessageCircleQuestionMark, TerminalSquare } from "lucide-react"

import type { ClineAskUseMcpServer, FollowUpData } from "@roo-code/types"

import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"
import { safeJsonParse } from "@roo-code/core/browser"

import { findMatchingResourceOrTemplate } from "@src/utils/mcp"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import McpResourceRow from "@src/components/mcp/McpResourceRow"
import ErrorRow from "@src/components/chat/ErrorRow"
import { Markdown } from "@src/components/chat/Markdown"
import { McpExecution } from "@src/components/chat/McpExecution"
import { FollowUpSuggest } from "@src/components/chat/FollowUpSuggest"
import { CommandExecution } from "@src/components/chat/CommandExecution"
import { ProgressIndicator } from "@src/components/chat/ProgressIndicator"
import { OpenMarkdownPreviewButton } from "@src/components/chat/OpenMarkdownPreviewButton"
import { AnnotateButton } from "@src/components/chat/AnnotateButton"
import { AutoApprovedRequestLimitWarning } from "@src/components/chat/AutoApprovedRequestLimitWarning"

import { headerStyle, normalColor, successColor } from "../shared"
import type { RowRendererProps } from "../types"

/** The model made too many mistakes in a row and asks how to go on. */
export const MistakeLimitReachedRow = ({ message }: RowRendererProps) => (
	<ErrorRow type="mistake_limit" message={message.text || ""} errorDetails={message.text} />
)

/** A command waiting for approval, or running (with its output) while it is the last row. */
export const CommandAskRow = ({ message, isLast, lastModifiedMessage, isExpanded, toggleExpand }: RowRendererProps) => {
	const { t } = useTranslation()
	const isCommandExecuting =
		isLast && lastModifiedMessage?.ask === "command" && lastModifiedMessage?.text?.includes(COMMAND_OUTPUT_STRING)

	return (
		<CommandExecution
			executionId={message.ts.toString()}
			text={message.text}
			icon={
				isCommandExecuting ? (
					<ProgressIndicator />
				) : (
					<TerminalSquare className="size-4" aria-label="Terminal icon" />
				)
			}
			title={<span style={{ color: normalColor, fontWeight: "bold" }}>{t("chat:commandExecution.running")}</span>}
			isExpanded={isExpanded}
			onToggleExpand={toggleExpand}
		/>
	)
}

/** An MCP tool call or resource read waiting for approval. */
export const UseMcpServerRow = ({ message, isLast, lastModifiedMessage }: RowRendererProps) => {
	const { t } = useTranslation()
	const { mcpServers, alwaysAllowMcp } = useExtensionState()

	// The header: nothing when the request does not parse.
	const mcpServerUse = safeJsonParse<ClineAskUseMcpServer>(message.text)
	const lastSay = lastModifiedMessage?.say
	const isMcpServerResponding = isLast && lastSay === "mcp_server_request_started"
	const icon =
		mcpServerUse === undefined ? null : isMcpServerResponding ? (
			<ProgressIndicator />
		) : (
			<span className="codicon codicon-server" style={{ color: normalColor, marginBottom: "-1.5px" }}></span>
		)
	const title =
		mcpServerUse === undefined ? null : (
			<span style={{ color: normalColor, fontWeight: "bold" }}>
				{mcpServerUse.type === "use_mcp_tool"
					? t("chat:mcp.wantsToUseTool", { serverName: mcpServerUse.serverName })
					: t("chat:mcp.wantsToAccessResource", { serverName: mcpServerUse.serverName })}
			</span>
		)

	// Parse the message text to get the MCP server request
	const messageJson = safeJsonParse<any>(message.text, {})

	// Extract the response field if it exists
	const { response, ...mcpServerRequest } = messageJson

	// Create the useMcpServer object with the response field
	const useMcpServer: ClineAskUseMcpServer = {
		...mcpServerRequest,
		response,
	}

	if (!useMcpServer) {
		return null
	}

	const server = mcpServers.find((server) => server.name === useMcpServer.serverName)
	// The matched resource or template, for a resource read. Computed here: with
	// this call (optional chaining in its arguments) as the test of the `||` in
	// the JSX below, the React Compiler skipped the whole component.
	const matchedResource =
		useMcpServer.type === "access_mcp_resource"
			? findMatchingResourceOrTemplate(useMcpServer.uri || "", server?.resources, server?.resourceTemplates)
			: undefined

	return (
		<>
			<div style={headerStyle}>
				{icon}
				{title}
			</div>
			<div className="w-full bg-vscode-editor-background border border-vscode-border rounded-xs p-2 mt-2">
				{useMcpServer.type === "access_mcp_resource" && (
					<McpResourceRow
						item={{
							// Use the matched resource/template details, with fallbacks
							...(matchedResource || {
								name: "",
								mimeType: "",
								description: "",
							}),
							// Always use the actual URI from the request
							uri: useMcpServer.uri || "",
						}}
					/>
				)}
				{useMcpServer.type === "use_mcp_tool" && (
					<McpExecution
						executionId={message.ts.toString()}
						text={useMcpServer.arguments !== "{}" ? useMcpServer.arguments : undefined}
						serverName={useMcpServer.serverName}
						toolName={useMcpServer.toolName}
						isArguments={true}
						server={server}
						useMcpServer={useMcpServer}
						alwaysAllowMcp={alwaysAllowMcp}
					/>
				)}
			</div>
		</>
	)
}

/** The task's result, asking the user to accept it or give feedback. Nothing when the text is empty. */
export const CompletionResultAskRow = ({ message }: RowRendererProps) => {
	const { t } = useTranslation()
	if (!message.text) {
		return null // Don't render anything when we get a completion_result ask without text
	}
	return (
		<div className="group">
			<div style={headerStyle}>
				<span className="codicon codicon-check" style={{ color: successColor, marginBottom: "-1.5px" }}></span>
				<span style={{ color: successColor, fontWeight: "bold" }}>{t("chat:taskCompleted")}</span>
				<div style={{ flexGrow: 1 }} />
				<OpenMarkdownPreviewButton markdown={message.text} />
				{!message.partial && <AnnotateButton markdown={message.text} />}
			</div>
			<div style={{ color: "var(--vscode-charts-green)", paddingTop: 10 }}>
				<Markdown markdown={message.text} partial={message.partial} />
			</div>
		</div>
	)
}

/** A question from the model, with suggested answers. */
export const FollowupRow = ({
	message,
	onSuggestionClick,
	onFollowUpUnmount,
	isFollowUpAnswered,
	isFollowUpAutoApprovalPaused,
}: RowRendererProps) => {
	const { t } = useTranslation()
	const followUpData = !message.partial ? safeJsonParse<FollowUpData>(message.text) : null

	return (
		<>
			<div style={headerStyle}>
				<MessageCircleQuestionMark className="w-4 shrink-0" aria-label="Question icon" />
				<span style={{ color: normalColor, fontWeight: "bold" }}>{t("chat:questions.hasQuestion")}</span>
			</div>
			<div className="flex flex-col gap-2 ml-6">
				<Markdown markdown={message.partial === true ? message?.text : followUpData?.question} />
				<FollowUpSuggest
					suggestions={followUpData?.suggest}
					onSuggestionClick={onSuggestionClick}
					ts={message?.ts}
					onCancelAutoApproval={onFollowUpUnmount}
					isAnswered={isFollowUpAnswered}
					isFollowUpAutoApprovalPaused={isFollowUpAutoApprovalPaused}
				/>
			</div>
		</>
	)
}

/** The auto-approved request limit is reached. */
export const AutoApprovalMaxReqReachedRow = ({ message }: RowRendererProps) => (
	<AutoApprovedRequestLimitWarning message={message} />
)
