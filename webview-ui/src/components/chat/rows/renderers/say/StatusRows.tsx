import { useTranslation } from "react-i18next"

import type { TodoItem } from "@roo-code/types"

import { safeJsonParse } from "@roo/core"

import { useExtensionState } from "@src/context/ExtensionStateContext"
import ErrorRow from "@src/components/chat/ErrorRow"
import WarningRow from "@src/components/chat/WarningRow"
import { ReasoningBlock } from "@src/components/chat/ReasoningBlock"
import { CheckpointSaved } from "@src/components/chat/checkpoints/CheckpointSaved"
import { CommandExecutionError } from "@src/components/chat/CommandExecutionError"
import UpdateTodoListToolBlock from "@src/components/chat/UpdateTodoListToolBlock"
import CodebaseSearchResultsDisplay from "@src/components/chat/CodebaseSearchResultsDisplay"
import {
	InProgressRow,
	CondensationResultRow,
	CondensationErrorRow,
	TruncationResultRow,
	PruneResultRow,
} from "@src/components/chat/context-management"

import type { RowRendererProps } from "../types"

/** A say kind that is never shown. */
export const NoRow = () => null

/** An edit that could not be applied. */
export const DiffErrorRow = ({ message }: RowRendererProps) => (
	<ErrorRow type="diff_error" message={message.text || ""} expandable={true} showCopyButton={true} />
)

/** An error, with the two model-response markers the backend sends spelled out. */
export const ErrorSayRow = ({ message }: RowRendererProps) => {
	const { t } = useTranslation()

	// Check if this is a model response error based on marker strings from backend
	const isNoToolsUsedError = message.text === "MODEL_NO_TOOLS_USED"
	const isNoAssistantMessagesError = message.text === "MODEL_NO_ASSISTANT_MESSAGES"

	if (isNoToolsUsedError) {
		return (
			<ErrorRow
				type="error"
				title={t("chat:modelResponseIncomplete")}
				message={t("chat:modelResponseErrors.noToolsUsed")}
				errorDetails={t("chat:modelResponseErrors.noToolsUsedDetails")}
			/>
		)
	}

	if (isNoAssistantMessagesError) {
		return (
			<ErrorRow
				type="error"
				title={t("chat:modelResponseIncomplete")}
				message={t("chat:modelResponseErrors.noAssistantMessages")}
				errorDetails={t("chat:modelResponseErrors.noAssistantMessagesDetails")}
			/>
		)
	}

	// Fallback for generic errors
	return <ErrorRow type="error" message={message.text || t("chat:error")} errorDetails={message.text} />
}

/** The model's reasoning, collapsible, with how long it took. */
export const ReasoningRow = ({ message, meta }: RowRendererProps) => (
	<ReasoningBlock content={message.text || ""} ts={message.ts} endTs={meta.nextTs} />
)

/** The terminal has no shell integration, so command output cannot be read. */
export const ShellIntegrationWarningRow = () => <CommandExecutionError />

/** A checkpoint, with its restore and diff menu. */
export const CheckpointSavedRow = ({ message, onJumpToPreviousCheckpoint }: RowRendererProps) => {
	const { currentCheckpoint } = useExtensionState()
	return (
		<CheckpointSaved
			ts={message.ts!}
			commitHash={message.text!}
			currentHash={currentCheckpoint}
			checkpoint={message.checkpoint}
			onJumpToPreviousCheckpoint={onJumpToPreviousCheckpoint}
		/>
	)
}

/** Context condensing: in progress, then its result. */
export const CondenseContextRow = ({ message }: RowRendererProps) => {
	// In-progress state
	if (message.partial) {
		return <InProgressRow eventType="condense_context" />
	}
	// Completed state
	if (message.contextCondense) {
		return <CondensationResultRow data={message.contextCondense} />
	}
	return null
}

export const CondenseContextErrorRow = ({ message }: RowRendererProps) => (
	<CondensationErrorRow errorText={message.text} />
)

/** Sliding-window truncation: in progress, then its result. */
export const SlidingWindowTruncationRow = ({ message }: RowRendererProps) => {
	// In-progress state
	if (message.partial) {
		return <InProgressRow eventType="sliding_window_truncation" />
	}
	// Completed state
	if (message.contextTruncation) {
		return <TruncationResultRow data={message.contextTruncation} />
	}
	return null
}

/**
 * Deterministic prune: old oversized tool results moved to task artifacts.
 * There is no in-progress state, the pass is local and finishes in milliseconds.
 */
export const ContextPrunedRow = ({ message }: RowRendererProps) => {
	if (message.contextPrune) {
		return <PruneResultRow data={message.contextPrune} />
	}
	return null
}

/** The results of a code index search. */
export const CodebaseSearchResultRow = ({ message }: RowRendererProps) => {
	let parsed: {
		content: {
			query: string
			results: Array<{
				filePath: string
				score: number
				startLine: number
				endLine: number
				codeChunk: string
			}>
		}
	} | null = null

	try {
		if (message.text) {
			parsed = JSON.parse(message.text)
		}
	} catch (error) {
		console.error("Failed to parse codebaseSearch content:", error)
	}

	if (parsed && !parsed?.content) {
		console.error("Invalid codebaseSearch content structure:", parsed.content)
		return <div>Error displaying search results.</div>
	}

	const { results = [] } = parsed?.content || {}

	return <CodebaseSearchResultsDisplay results={results} />
}

/**
 * The user edited the todo list while approving an update. UpdateTodoListTool
 * says {tool: "updateTodoList", todos} with the list as the user left it.
 */
export const UserEditTodosRow = ({ message, meta }: RowRendererProps) => {
	const parsed = safeJsonParse<{ todos?: unknown }>(message.text || "{}")
	const todos = Array.isArray(parsed?.todos) ? (parsed.todos as TodoItem[]) : undefined
	return (
		<UpdateTodoListToolBlock
			userEdited
			todos={todos}
			onChange={() => {}}
			startTs={message.ts}
			endTs={meta.nextTs}
		/>
	)
}

/** Too many MCP tools are enabled, with a shortcut to the MCP settings. */
export const TooManyToolsWarningRow = ({ message }: RowRendererProps) => {
	const { t } = useTranslation()
	const warningData = safeJsonParse<{
		toolCount: number
		serverCount: number
		threshold: number
	}>(message.text || "{}")
	if (!warningData) return null
	const toolsPart = t("chat:tooManyTools.toolsPart", { count: warningData.toolCount })
	const serversPart = t("chat:tooManyTools.serversPart", { count: warningData.serverCount })
	return (
		<WarningRow
			title={t("chat:tooManyTools.title")}
			message={t("chat:tooManyTools.messageTemplate", {
				tools: toolsPart,
				servers: serversPart,
				threshold: warningData.threshold,
			})}
			actionText={t("chat:tooManyTools.openMcpSettings")}
			onAction={() =>
				window.postMessage({ type: "action", action: "settingsButtonClicked", values: { section: "mcp" } }, "*")
			}
		/>
	)
}
