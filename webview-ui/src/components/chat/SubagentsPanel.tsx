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
	XCircle,
} from "lucide-react"

import type { ClineMessage, ExtensionMessage, SubagentSummary } from "@roo-code/types"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui"
import { cn } from "@/lib/utils"
import { vscode } from "@src/utils/vscode"

import MarkdownBlock from "../common/MarkdownBlock"
import { ProgressIndicator } from "./ProgressIndicator"

interface SubagentsPanelProps {
	subagents: SubagentSummary[] | undefined
	className?: string
}

const LIVE_STATUSES = new Set(["queued", "running", "awaiting_input"])

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
			return { kind: "markdown", text: followupQuestion(text) }
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

function followupQuestion(text: string): string {
	try {
		const parsed = JSON.parse(text)
		return typeof parsed?.question === "string" ? parsed.question : text
	} catch {
		return text
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
 * Live message tail of one subagent. Subscribes on mount (and whenever the
 * queued placeholder is replaced by the real task id), streams incremental
 * `messageUpdated` pushes scoped by `sourceTaskId`, and unsubscribes on
 * unmount so the extension stops streaming.
 */
const SubagentTail = ({ summary }: { summary: SubagentSummary }) => {
	const { t } = useTranslation()
	const [messages, setMessages] = useState<ClineMessage[]>([])
	const containerRef = useRef<HTMLDivElement>(null)
	const taskId = summary.taskId

	useEffect(() => {
		setMessages([])
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

	// Pin the tail to the latest output.
	useEffect(() => {
		const el = containerRef.current
		if (el) {
			el.scrollTop = el.scrollHeight
		}
	}, [messages])

	const entries = useMemo(
		() =>
			messages
				.map((message) => ({ ts: message.ts, entry: tailEntryFor(message) }))
				.filter((item): item is { ts: number; entry: NonNullable<ReturnType<typeof tailEntryFor>> } =>
					Boolean(item.entry),
				),
		[messages],
	)

	if (entries.length === 0) {
		// Disposed children have no live messages — fall back to the summary's
		// terminal payload so "what happened" survives task teardown.
		if (summary.finalMessage) {
			return (
				<div className="px-2 py-1 text-sm">
					<MarkdownBlock markdown={summary.finalMessage} />
				</div>
			)
		}
		return <div className="px-2 py-1 text-sm text-vscode-descriptionForeground">{t("chat:subagents.noOutput")}</div>
	}

	return (
		<div ref={containerRef} className="max-h-64 overflow-y-auto px-2 py-1 flex flex-col gap-1">
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
							<div key={ts} className="text-xs italic text-vscode-descriptionForeground line-clamp-3">
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
							<div key={ts} className="text-xs font-mono text-vscode-descriptionForeground truncate">
								• {entry.text}
							</div>
						)
				}
			})}
		</div>
	)
}

const SubagentRow = ({ summary }: { summary: SubagentSummary }) => {
	const { t } = useTranslation()
	const [expanded, setExpanded] = useState(false)

	const tokens = summary.tokensIn + summary.tokensOut
	const showCost = summary.totalCost > 0

	return (
		<div className="rounded border border-vscode-panel-border overflow-hidden">
			<button
				type="button"
				onClick={() => setExpanded((prev) => !prev)}
				className={cn(
					"flex items-center gap-2 w-full px-2 py-1.5 text-left bg-transparent border-0 cursor-pointer",
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
				<span className="text-sm truncate grow" title={summary.description}>
					{summary.description}
				</span>
				<span className="text-xs text-vscode-descriptionForeground shrink-0" title={t("chat:subagents.tokens")}>
					{tokens > 0 ? `${(tokens / 1000).toFixed(1)}k` : ""}
					{showCost ? ` · $${summary.totalCost.toFixed(2)}` : ""}
				</span>
				<span className="text-xs text-vscode-descriptionForeground shrink-0">
					{t(`chat:subagents.status.${summary.status}`)}
				</span>
			</button>
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
 * latest `run_parallel_tasks` fan-out: live status per child plus an
 * expandable streaming tail. Renders nothing when no fan-out is registered.
 */
const SubagentsPanel = memo(({ subagents, className }: SubagentsPanelProps) => {
	const { t } = useTranslation()
	const [panelExpanded, setPanelExpanded] = useState(true)

	const active = useMemo(() => (subagents ?? []).filter((s) => LIVE_STATUSES.has(s.status)).length, [subagents])

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
