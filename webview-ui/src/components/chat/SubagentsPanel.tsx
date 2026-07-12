import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	Bot,
	CheckCircle2,
	ChevronDown,
	ChevronRight,
	CircleSlash,
	Clock,
	MessageCircleQuestion,
	Send,
	Square,
	XCircle,
} from "lucide-react"

import type { ClineMessage, ExtensionMessage, FollowUpData, SubagentSummary } from "@roo-code/types"

import { Collapsible, CollapsibleContent, CollapsibleTrigger, StandardTooltip } from "@/components/ui"
import { cn } from "@/lib/utils"
import { vscode } from "@src/utils/vscode"

import MarkdownBlock from "../common/MarkdownBlock"
import { ProgressIndicator } from "./ProgressIndicator"

interface SubagentsPanelProps {
	subagents: SubagentSummary[] | undefined
	className?: string
}

const LIVE_STATUSES = new Set(["queued", "running", "awaiting_input"])

const isLive = (summary: SubagentSummary) => LIVE_STATUSES.has(summary.status)
const isQueuedPlaceholder = (summary: SubagentSummary) => summary.taskId.startsWith("queued:")

const StatusIcon = ({ status }: { status: SubagentSummary["status"] }) => {
	switch (status) {
		case "queued":
			return <Clock className="size-4 shrink-0 text-vscode-descriptionForeground" aria-hidden />
		case "running":
			return (
				<span className="size-4 shrink-0 flex items-center justify-center">
					<ProgressIndicator />
				</span>
			)
		case "awaiting_input":
			return <MessageCircleQuestion className="size-4 shrink-0 text-vscode-charts-yellow" aria-hidden />
		case "completed":
			return <CheckCircle2 className="size-4 shrink-0 text-vscode-charts-green" aria-hidden />
		case "failed":
			return <XCircle className="size-4 shrink-0 text-vscode-charts-red" aria-hidden />
		case "cancelled":
			return <CircleSlash className="size-4 shrink-0 text-vscode-descriptionForeground" aria-hidden />
	}
}

/** Message types worth showing in a compact live tail. */
function tailEntryFor(message: ClineMessage): { kind: "markdown" | "dim" | "error" | "label"; text: string } | null {
	const text = message.text ?? ""
	if (message.type === "say") {
		switch (message.say) {
			case "text":
			case "completion_result":
				return text ? { kind: "markdown", text } : null
			case "reasoning":
				return text ? { kind: "dim", text } : null
			case "error":
				return text ? { kind: "error", text } : null
			case "command_output":
				return null
			case "tool":
				return { kind: "label", text: toolLabel(text) }
			default:
				return null
		}
	}
	switch (message.ask) {
		case "followup":
			return { kind: "markdown", text: parseFollowUp(text).question ?? text }
		case "tool":
			return { kind: "label", text: toolLabel(text) }
		case "command":
			return { kind: "label", text: text ? `$ ${firstLine(text)}` : "command" }
		case "use_mcp_server":
			return { kind: "label", text: "MCP" }
		default:
			return null
	}
}

function firstLine(text: string): string {
	const line = text.split("\n", 1)[0] ?? text
	return line.length > 120 ? `${line.slice(0, 120)}…` : line
}

function toolLabel(text: string): string {
	try {
		const parsed = JSON.parse(text)
		const tool = typeof parsed?.tool === "string" ? parsed.tool : "tool"
		const path = typeof parsed?.path === "string" && parsed.path ? ` ${parsed.path}` : ""
		return `${tool}${path}`
	} catch {
		return "tool"
	}
}

function parseFollowUp(text: string): FollowUpData {
	try {
		const parsed = JSON.parse(text)
		return typeof parsed === "object" && parsed !== null ? (parsed as FollowUpData) : {}
	} catch {
		return {}
	}
}

function findLastIndexByTs(messages: ClineMessage[], ts: number): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].ts === ts) {
			return i
		}
	}
	return -1
}

/**
 * Live message tail of one subagent plus its interaction affordances.
 * Subscribes on mount (and whenever the queued placeholder is replaced by the
 * real task id), streams incremental `messageUpdated` pushes scoped by
 * `sourceTaskId`, and unsubscribes on unmount so the extension stops
 * streaming. While the child runs the user can send guidance (queued for the
 * next ask boundary); when it is blocked on a followup question, suggestion
 * buttons and the input answer it directly.
 */
const SubagentTail = ({ summary }: { summary: SubagentSummary }) => {
	const { t } = useTranslation()
	const [messages, setMessages] = useState<ClineMessage[]>([])
	const [input, setInput] = useState("")
	const containerRef = useRef<HTMLDivElement>(null)
	// Follow-output contract (same as ChatView's Virtuoso): auto-scroll only
	// while the user is at the bottom; scrolling up pauses following, and
	// scrolling back down re-engages it. Ref, not state — scroll position
	// tracking must not re-render the tail on every wheel tick.
	const atBottomRef = useRef(true)
	const taskId = summary.taskId
	const awaitingInput = summary.status === "awaiting_input"

	useEffect(() => {
		setMessages([])
		// A freshly (re)opened tail starts pinned to the latest output.
		atBottomRef.current = true
		vscode.postMessage({ type: "subscribeSubagentMessages", taskId })
		return () => {
			vscode.postMessage({ type: "unsubscribeSubagentMessages", taskId })
		}
	}, [taskId])

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			if (message.sourceTaskId !== taskId) {
				return
			}
			if (message.type === "subagentMessages") {
				setMessages(message.subagentMessages ?? [])
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
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [taskId])

	// Pin the tail to the latest output — but only while the user is at the
	// bottom. New content must never yank the view away from text the user
	// scrolled up to read.
	useEffect(() => {
		const el = containerRef.current
		if (el && atBottomRef.current) {
			el.scrollTop = el.scrollHeight
		}
	}, [messages])

	const handleScroll = useCallback(() => {
		const el = containerRef.current
		if (el) {
			// Small threshold so sub-pixel rounding and momentum scrolling
			// still count as "at the bottom".
			atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
		}
	}, [])

	const entries = useMemo(
		() =>
			messages
				.map((message) => ({ ts: message.ts, entry: tailEntryFor(message) }))
				.filter((item): item is { ts: number; entry: NonNullable<ReturnType<typeof tailEntryFor>> } =>
					Boolean(item.entry),
				),
		[messages],
	)

	// The ask the child is currently blocked on (status is the source of
	// truth; the message supplies question/suggestions or the action needing
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

	const pendingFollowUp = pendingAsk?.ask === "followup" ? parseFollowUp(pendingAsk.text ?? "") : undefined
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

	const showInput = isLive(summary) && !isQueuedPlaceholder(summary)

	return (
		<div>
			{entries.length === 0 ? (
				summary.finalMessage ? (
					// Disposed children have no live messages — fall back to the
					// summary's terminal payload so "what happened" survives teardown.
					<div className="px-2 py-1 text-sm">
						<MarkdownBlock markdown={summary.finalMessage} />
					</div>
				) : (
					<div className="px-2 py-1 text-sm text-vscode-descriptionForeground">
						{t("chat:subagents.noOutput")}
					</div>
				)
			) : (
				<div
					ref={containerRef}
					onScroll={handleScroll}
					className="max-h-64 overflow-y-auto px-2 py-1 flex flex-col gap-1">
					{entries.map(({ ts, entry }) => {
						switch (entry.kind) {
							case "markdown":
								return (
									<div key={ts} className="text-sm">
										<MarkdownBlock markdown={entry.text} />
									</div>
								)
							case "dim":
								return (
									<div
										key={ts}
										className="text-xs italic text-vscode-descriptionForeground line-clamp-3">
										{entry.text}
									</div>
								)
							case "error":
								return (
									<div key={ts} className="text-sm text-vscode-errorForeground">
										{entry.text}
									</div>
								)
							case "label":
								return (
									<div
										key={ts}
										className="text-xs font-mono text-vscode-descriptionForeground truncate">
										• {entry.text}
									</div>
								)
						}
					})}
				</div>
			)}
			{pendingPermission && (
				<div className="flex items-center gap-1 px-2 pb-1">
					<span className="text-xs text-vscode-descriptionForeground grow truncate">
						{t("chat:subagents.permissionNeeded")}
					</span>
					<button
						type="button"
						onClick={() => respondToPermission(true)}
						className={cn(
							"text-xs px-2 py-1 rounded border-0 cursor-pointer",
							"bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground",
						)}>
						{t("chat:approve.title")}
					</button>
					<button
						type="button"
						onClick={() => respondToPermission(false)}
						className={cn(
							"text-xs px-2 py-1 rounded border border-vscode-button-border cursor-pointer",
							"bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground",
							"hover:bg-vscode-button-secondaryHoverBackground",
						)}>
						{t("chat:reject.title")}
					</button>
				</div>
			)}
			{pendingFollowUp?.suggest && pendingFollowUp.suggest.length > 0 && (
				<div className="flex flex-wrap gap-1 px-2 pb-1">
					{pendingFollowUp.suggest.map((suggestion, index) => (
						<button
							key={index}
							type="button"
							onClick={() => sendAnswer(suggestion.answer)}
							className={cn(
								"text-xs px-2 py-1 rounded border border-vscode-button-border cursor-pointer",
								"bg-vscode-button-secondaryBackground text-vscode-button-secondaryForeground",
								"hover:bg-vscode-button-secondaryHoverBackground",
							)}>
							{suggestion.answer}
						</button>
					))}
				</div>
			)}
			{showInput && (
				<div className="flex items-center gap-1 px-2 pb-2">
					<input
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
							awaitingInput
								? t("chat:subagents.answerPlaceholder")
								: t("chat:subagents.guidancePlaceholder")
						}
						className={cn(
							"grow text-sm px-2 py-1 rounded border",
							"bg-vscode-input-background text-vscode-input-foreground border-vscode-input-border",
							"placeholder:text-vscode-input-placeholderForeground focus:outline-none",
						)}
					/>
					<StandardTooltip content={t("chat:subagents.send")}>
						<button
							type="button"
							onClick={() => sendAnswer(input)}
							disabled={!input.trim()}
							className={cn(
								"p-1 rounded border-0 cursor-pointer bg-transparent",
								"text-vscode-foreground hover:bg-vscode-list-hoverBackground",
								"disabled:opacity-40 disabled:cursor-default",
							)}>
							<Send className="size-4" aria-hidden />
						</button>
					</StandardTooltip>
				</div>
			)}
		</div>
	)
}

const SubagentRow = ({ summary }: { summary: SubagentSummary }) => {
	const { t } = useTranslation()
	const [expanded, setExpanded] = useState(false)

	// A child that needs input should be one click away from answering.
	useEffect(() => {
		if (summary.status === "awaiting_input") {
			setExpanded(true)
		}
	}, [summary.status])

	const cancel = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation()
			vscode.postMessage({ type: "cancelSubagent", taskId: summary.taskId })
		},
		[summary.taskId],
	)

	const tokens = summary.tokensIn + summary.tokensOut
	const showCost = summary.totalCost > 0
	const cancellable = isLive(summary) && !isQueuedPlaceholder(summary)

	return (
		<div className="rounded border border-vscode-panel-border overflow-hidden">
			<div className="flex items-center">
				<button
					type="button"
					onClick={() => setExpanded((prev) => !prev)}
					className={cn(
						"flex items-center gap-2 grow min-w-0 px-2 py-1.5 text-left bg-transparent border-0 cursor-pointer",
						"text-vscode-foreground hover:bg-vscode-list-hoverBackground",
					)}
					aria-expanded={expanded}>
					{expanded ? (
						<ChevronDown className="size-3 shrink-0" aria-hidden />
					) : (
						<ChevronRight className="size-3 shrink-0" aria-hidden />
					)}
					<StatusIcon status={summary.status} />
					<span className="text-xs px-1 py-0.5 rounded bg-vscode-badge-background text-vscode-badge-foreground shrink-0">
						{summary.mode}
					</span>
					{summary.apiConfigName && (
						<span
							className="text-xs text-vscode-descriptionForeground shrink-0 max-w-24 truncate"
							title={t("chat:subagents.apiConfig", { name: summary.apiConfigName })}>
							{summary.apiConfigName}
						</span>
					)}
					<span className="text-sm truncate grow" title={summary.description}>
						{summary.description}
					</span>
					<span
						className="text-xs text-vscode-descriptionForeground shrink-0"
						title={t("chat:subagents.tokens")}>
						{tokens > 0 ? `${(tokens / 1000).toFixed(1)}k` : ""}
						{showCost ? ` · $${summary.totalCost.toFixed(2)}` : ""}
					</span>
					<span className="text-xs text-vscode-descriptionForeground shrink-0">
						{t(`chat:subagents.status.${summary.status}`)}
					</span>
				</button>
				{cancellable && (
					<StandardTooltip content={t("chat:subagents.cancel")}>
						<button
							type="button"
							onClick={cancel}
							className={cn(
								"p-1.5 mr-1 rounded border-0 cursor-pointer bg-transparent shrink-0",
								"text-vscode-descriptionForeground hover:text-vscode-errorForeground hover:bg-vscode-list-hoverBackground",
							)}>
							<Square className="size-3.5" aria-hidden />
						</button>
					</StandardTooltip>
				)}
			</div>
			{expanded && (
				<div className="border-t border-vscode-panel-border bg-vscode-editor-background">
					<SubagentTail summary={summary} />
				</div>
			)}
		</div>
	)
}

/**
 * Panel above the chat input listing the parallel background subagents of the
 * latest `run_parallel_tasks` fan-out: live status per child, an expandable
 * streaming tail, question answering, mid-run guidance, and per-child cancel.
 * Renders nothing when no fan-out is registered.
 */
const SubagentsPanel = memo(({ subagents, className }: SubagentsPanelProps) => {
	const { t } = useTranslation()
	const [panelExpanded, setPanelExpanded] = useState(true)

	const active = useMemo(() => (subagents ?? []).filter(isLive).length, [subagents])

	const handleOpenChange = useCallback((open: boolean) => setPanelExpanded(open), [])

	if (!subagents || subagents.length === 0) {
		return null
	}

	return (
		<Collapsible open={panelExpanded} onOpenChange={handleOpenChange} className={cn("px-3", className)}>
			<CollapsibleTrigger
				className={cn(
					"flex items-center gap-2 w-full py-2 rounded-md text-left text-vscode-foreground",
					"hover:bg-vscode-list-hoverBackground",
				)}>
				{panelExpanded ? (
					<ChevronDown className="size-4 shrink-0" aria-hidden />
				) : (
					<ChevronRight className="size-4 shrink-0" aria-hidden />
				)}
				<Bot className="size-4 shrink-0" aria-hidden />
				<span className="text-sm font-medium">
					{active > 0
						? t("chat:subagents.headerActive", { active, total: subagents.length })
						: t("chat:subagents.headerDone", { total: subagents.length })}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div className="flex flex-col gap-1 pb-2 pl-6">
					{subagents.map((summary) => (
						<SubagentRow key={`${summary.parentTaskId}:${summary.index}`} summary={summary} />
					))}
				</div>
			</CollapsibleContent>
		</Collapsible>
	)
})

SubagentsPanel.displayName = "SubagentsPanel"

export default SubagentsPanel
