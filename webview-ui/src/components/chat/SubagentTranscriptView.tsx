import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Virtuoso } from "react-virtuoso"
import { Send, Square } from "lucide-react"

import type { ClineMessage, ExtensionMessage } from "@tumble-code/types"
import { parseFollowUpData } from "@tumble-code/types"
import { consolidateApiRequests, consolidateCommands } from "@tumble-code/core/browser"

import { Button, Input, StandardTooltip } from "@/components/ui"
import { cn } from "@/lib/utils"
import { vscode } from "@src/utils/vscode"
import { onExtensionMessage } from "@src/utils/extensionBus"
import { useExtensionSelector } from "@src/context/ExtensionStateContext"

import MarkdownBlock from "../common/MarkdownBlock"
import { Tab, TabHeader, TabTitle } from "../common/Tab"
import ChatRow from "./ChatRow"
import { filterVisible } from "./rows/filterVisible"
import { groupToolAsks } from "./rows/groupToolAsks"
import { computeRowMeta } from "./rows/computeRowMeta"
import { decodeStoredProse } from "./rows/decodeStoredProse"
import { ReadOnlyRowsContext } from "./rows/ReadOnlyRowsContext"
import { StatusIcon, isLive } from "./subagentStatus"

// A transcript has no "rows shown before" to keep: it is read, not worked in.
const NOTHING_EVER_VISIBLE = { has: () => false }
const ROW_DEFAULT_HEIGHT = 120
const noop = () => {}

function findLastIndexByTs(messages: ClineMessage[], ts: number): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].ts === ts) {
			return i
		}
	}
	return -1
}

/**
 * The messages of subagent `taskId`: a snapshot on subscribe, then the
 * messages it streams while it runs. The host reads a finished subagent's
 * messages from its task directory. Unsubscribes on unmount, so the host
 * stops streaming.
 */
function useSubagentMessages(taskId: string): { messages: ClineMessage[]; loaded: boolean } {
	const [messages, setMessages] = useState<ClineMessage[]>([])
	const [loaded, setLoaded] = useState(false)

	useEffect(() => {
		setMessages([])
		setLoaded(false)
		vscode.postMessage({ type: "subscribeSubagentMessages", taskId })
		return () => {
			vscode.postMessage({ type: "unsubscribeSubagentMessages", taskId })
		}
	}, [taskId])

	useEffect(() => {
		const handler = (message: ExtensionMessage) => {
			if (message.sourceTaskId !== taskId) {
				return
			}
			if (message.type === "subagentMessages") {
				setMessages(message.subagentMessages ?? [])
				setLoaded(true)
			} else if (message.type === "messageUpdated" && message.clineMessage) {
				const incoming = message.clineMessage
				setMessages((prev) => {
					const index = findLastIndexByTs(prev, incoming.ts)
					if (index !== -1) {
						const next = [...prev]
						next[index] = incoming
						return next
					}
					return [...prev, incoming]
				})
			}
		}
		return onExtensionMessage(["subagentMessages", "messageUpdated"], handler)
	}, [taskId])

	return { messages, loaded }
}

/**
 * Answering a live subagent from its transcript: Approve / Deny for a
 * permission it waits on, the suggestions of its question, and a text box
 * (an answer while it waits, else guidance queued for its next stopping
 * point).
 */
const SubagentControls = ({
	taskId,
	awaitingInput,
	messages,
}: {
	taskId: string
	awaitingInput: boolean
	messages: ClineMessage[]
}) => {
	const { t } = useTranslation()
	const [input, setInput] = useState("")

	// The ask the child is blocked on (status is the source of truth; the
	// message supplies the question and suggestions or the action needing
	// permission).
	const pendingAsk = useMemo(() => {
		if (!awaitingInput) {
			return undefined
		}
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i]
			if (message.type === "ask" && !message.partial) {
				return message
			}
		}
		return undefined
	}, [awaitingInput, messages])

	// Suggestions with a blank, missing or non-string answer are dropped (weak models emit them).
	const usableSuggestions =
		pendingAsk?.ask === "followup" ? parseFollowUpData(decodeStoredProse(pendingAsk).text).suggestions : []
	const pendingPermission =
		pendingAsk && (pendingAsk.ask === "tool" || pendingAsk.ask === "command" || pendingAsk.ask === "use_mcp_server")
			? pendingAsk
			: undefined

	const respondToPermission = useCallback(
		(approve: boolean) => {
			vscode.postMessage({
				type: "askResponse",
				askResponse: approve ? "yesButtonClicked" : "noButtonClicked",
				taskId,
			})
		},
		[taskId],
	)

	const sendAnswer = useCallback(
		(text: string) => {
			const trimmed = text.trim()
			if (!trimmed) {
				return
			}
			if (awaitingInput) {
				vscode.postMessage({ type: "askResponse", askResponse: "messageResponse", text: trimmed, taskId })
			} else {
				vscode.postMessage({ type: "queueSubagentMessage", text: trimmed, taskId })
			}
			setInput("")
		},
		[awaitingInput, taskId],
	)

	return (
		<div className="flex flex-col gap-1 px-3 py-2 border-t border-frame">
			{pendingPermission && (
				<div className="flex items-center gap-1">
					<span className="text-xs text-vscode-descriptionForeground grow truncate">
						{t("chat:subagents.permissionNeeded")}
					</span>
					<Button
						type="button"
						variant="primary"
						size="sm"
						onClick={() => respondToPermission(true)}
						className="h-[22px] text-xs">
						{t("chat:approve.title")}
					</Button>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={() => respondToPermission(false)}
						className="h-[22px] text-xs">
						{t("chat:reject.title")}
					</Button>
				</div>
			)}
			{usableSuggestions.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{usableSuggestions.map((suggestion, index) => (
						<button
							key={index}
							type="button"
							onClick={() => sendAnswer(suggestion.answer)}
							className={cn(
								"text-xs min-h-[22px] px-2 py-0.5 border border-input-frame rounded-control cursor-pointer text-left",
								"bg-surface text-vscode-foreground transition-colors",
								"hover:bg-surface-hover hover:border-input-frame-hover focus-ring",
							)}>
							{suggestion.answer}
						</button>
					))}
				</div>
			)}
			<div className="flex items-center gap-1">
				<Input
					type="text"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.nativeEvent.isComposing) {
							e.preventDefault()
							sendAnswer(input)
						}
					}}
					placeholder={
						awaitingInput ? t("chat:subagents.answerPlaceholder") : t("chat:subagents.guidancePlaceholder")
					}
					className="h-[26px] w-auto grow text-sm px-2 border-input-frame placeholder:text-vscode-input-placeholderForeground"
				/>
				<StandardTooltip content={t("chat:subagents.send")}>
					<button
						aria-label={t("chat:subagents.send")}
						type="button"
						onClick={() => sendAnswer(input)}
						disabled={!input.trim()}
						className={cn(
							"flex items-center justify-center size-[22px] p-0 border-0 rounded-control cursor-pointer bg-transparent",
							"text-vscode-foreground hover:bg-surface-hover focus-ring",
							"disabled:text-vscode-descriptionForeground disabled:cursor-default",
						)}>
						<Send className="size-4" aria-hidden />
					</button>
				</StandardTooltip>
			</div>
		</div>
	)
}

interface SubagentTranscriptViewProps {
	taskId: string
	onDone: () => void
}

/**
 * The whole transcript of one parallel subagent, live while it runs: its
 * subtask message, then every row as the chat shows it (reasoning, tools,
 * diffs, commands with their output, the final answer). Opened from the
 * subagents panel or the subagent's history row; it never changes the open
 * task, so the parent keeps running untouched. Row actions that would reach
 * the open task are hidden (ReadOnlyRowsContext). A running subagent can be
 * stopped, answered and guided from here.
 */
const SubagentTranscriptView = ({ taskId, onDone }: SubagentTranscriptViewProps) => {
	const { t } = useTranslation()
	const subagents = useExtensionSelector((s) => s.subagents)
	const taskHistory = useExtensionSelector((s) => s.taskHistory)
	const summary = useMemo(() => subagents?.find((s) => s.taskId === taskId), [subagents, taskId])
	const historyItem = useMemo(() => taskHistory.find((item) => item.id === taskId), [taskHistory, taskId])
	const { messages, loaded } = useSubagentMessages(taskId)
	const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({})

	const live = summary ? isLive(summary) : false
	const taskMessage = messages.at(0)
	const rows = useMemo(() => {
		const combined = consolidateApiRequests(consolidateCommands(messages.slice(1)))
		return groupToolAsks(filterVisible(combined, NOTHING_EVER_VISIBLE))
	}, [messages])
	const { byTs: rowMetaByTs } = useMemo(() => computeRowMeta(messages, rows), [messages, rows])
	const isStreaming = live && messages.at(-1)?.partial === true

	// The subtask message the subagent was given heads the list. One object
	// per message: Virtuoso remounts the header when the component changes.
	const subtaskText = taskMessage ? (decodeStoredProse(taskMessage).text ?? "") : undefined
	const listComponents = useMemo(
		() => ({
			Header: () =>
				subtaskText === undefined ? null : (
					<div className="mx-3 mt-3 mb-1 p-2 border border-frame bg-surface rounded-control max-h-48 overflow-y-auto text-sm">
						<div className="text-xs text-vscode-descriptionForeground mb-1">
							{t("chat:subagents.transcript.subtask")}
						</div>
						<MarkdownBlock markdown={subtaskText} />
					</div>
				),
		}),
		[subtaskText, t],
	)

	const toggleRowExpansion = useCallback((ts: number, expand?: boolean) => {
		setExpandedRows((prev) => ({ ...prev, [ts]: expand ?? !prev[ts] }))
	}, [])

	const cancel = useCallback(() => {
		vscode.postMessage({ type: "cancelSubagent", taskId })
	}, [taskId])

	const description = summary?.description ?? historyItem?.task.split("\n", 1)[0] ?? taskId
	const mode = summary?.mode ?? historyItem?.mode
	const apiConfigName = summary?.apiConfigName ?? historyItem?.apiConfigName
	const tokens =
		(summary?.tokensIn ?? historyItem?.tokensIn ?? 0) + (summary?.tokensOut ?? historyItem?.tokensOut ?? 0)
	const totalCost = summary?.totalCost ?? historyItem?.totalCost ?? 0
	const stopReason =
		summary && (summary.status === "failed" || summary.status === "cancelled") ? summary.finalMessage : undefined

	return (
		<Tab data-testid="subagent-transcript">
			<TabHeader className="flex flex-col gap-1">
				<div className="flex items-center justify-between gap-2">
					<TabTitle
						title={description}
						backLabel={t("chat:subagents.transcript.back")}
						onBack={onDone}
						backTestId="subagent-transcript-back"
					/>
					{live && (
						<StandardTooltip content={t("chat:subagents.cancel")}>
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("chat:subagents.cancel")}
								onClick={cancel}>
								<Square className="size-4" aria-hidden />
							</Button>
						</StandardTooltip>
					)}
				</div>
				<div className="flex items-center gap-2 text-xs text-vscode-descriptionForeground min-w-0">
					{summary && <StatusIcon status={summary.status} />}
					{mode && (
						<span className="px-1 py-0.5 bg-vscode-badge-background text-vscode-badge-foreground rounded-control shrink-0">
							{mode}
						</span>
					)}
					{apiConfigName && <span className="truncate">{apiConfigName}</span>}
					{tokens > 0 && <span className="shrink-0">{`${(tokens / 1000).toFixed(1)}k`}</span>}
					{totalCost > 0 && <span className="shrink-0">{`$${totalCost.toFixed(2)}`}</span>}
					{summary && <span className="shrink-0">{t(`chat:subagents.status.${summary.status}`)}</span>}
				</div>
				{stopReason && (
					<div className="text-sm text-vscode-errorForeground" data-testid="subagent-stop-reason">
						{stopReason}
					</div>
				)}
			</TabHeader>
			<ReadOnlyRowsContext.Provider value={true}>
				{!loaded ? (
					<div className="p-5 text-sm text-vscode-descriptionForeground">{t("common:loading")}</div>
				) : messages.length === 0 ? (
					<div className="p-5 text-sm text-vscode-descriptionForeground">
						{summary?.finalMessage ? (
							// A fan-out from before transcripts were kept has only the
							// summary's terminal payload.
							<MarkdownBlock markdown={summary.finalMessage} />
						) : (
							t("chat:subagents.noOutput")
						)}
					</div>
				) : (
					<Virtuoso
						className="scrollable grow overflow-y-scroll"
						data={rows}
						defaultItemHeight={ROW_DEFAULT_HEIGHT}
						followOutput={(atBottom) => (atBottom ? "auto" : false)}
						computeItemKey={(index, row) => `${row.ts}-${index}`}
						components={listComponents}
						itemContent={(index, row) => (
							<ChatRow
								message={row}
								isExpanded={expandedRows[row.ts] ?? false}
								onToggleExpand={toggleRowExpansion}
								isLast={index === rows.length - 1}
								lastModifiedMessage={index === rows.length - 1 ? messages.at(-1) : undefined}
								isStreaming={isStreaming}
								onHeightChange={noop}
								isFollowUpAnswered={row.isAnswered === true || !live}
								meta={rowMetaByTs.get(row.ts)}
							/>
						)}
					/>
				)}
			</ReadOnlyRowsContext.Provider>
			{live && summary && (
				<SubagentControls
					taskId={taskId}
					awaitingInput={summary.status === "awaiting_input"}
					messages={messages}
				/>
			)}
		</Tab>
	)
}

export default SubagentTranscriptView
