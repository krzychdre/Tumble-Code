import { memo, useMemo } from "react"
import { Box, Text, useInput } from "ink"

import * as theme from "../../theme.js"
import SelectList from "../primitives/SelectList.js"
import { getToolDisplayName } from "../tools/utils.js"
import type { PendingAsk } from "../../types.js"
import { parseMcpAsk } from "../../../lib/utils/mcp-ask.js"

/**
 * Argument lines shown for an MCP tool. The dialog lives in the height-clamped
 * tail, so a long argument list must not push Yes / No out of view.
 */
const MAX_MCP_ARGUMENT_LINES = 12

/** Error lines shown for a failed API request, for the same reason. */
const MAX_API_ERROR_LINES = 12

export interface ApprovalDialogProps {
	/** The pending ask to display (type "command", "tool", "use_mcp_server" or "api_req_failed") */
	ask: PendingAsk
	/** Called when the user approves */
	onApprove: () => void
	/** Called when the user rejects */
	onReject: () => void
	/** When false, the dialog ignores all input (default true) */
	isActive?: boolean
}

/**
 * One body line of an approval dialog.
 */
interface ApprovalLine {
	content: React.ReactNode
	bold?: boolean
	secondary?: boolean
	/** Cut at the dialog's width instead of wrapping onto more rows. */
	truncate?: boolean
}

/**
 * Parsed body content for an approval dialog.
 */
interface ApprovalBody {
	title: string
	lines: ApprovalLine[]
	/** The question above Yes / No (default "Do you want to proceed?"). */
	question?: string
}

/**
 * Parse a tool name from ask.content JSON, if present.
 */
function parseToolInfo(content: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(content) as Record<string, unknown>
		return parsed
	} catch {
		return undefined
	}
}

/**
 * Humanize an ask type for the title fallback.
 * "command" → "Bash command", "tool" → "Tool use", else → capitalize.
 */
function humanizeType(type: string): string {
	switch (type) {
		case "command":
			return "Bash command"
		case "tool":
			return "Tool use"
		case "use_mcp_server":
			return "MCP server"
		default:
			return type.charAt(0).toUpperCase() + type.slice(1)
	}
}

/**
 * MCP tool → "server › tool" plus its arguments; MCP resource → server and URI.
 */
function buildMcpBody(content: string): ApprovalBody | undefined {
	const mcp = parseMcpAsk(content)

	if (!mcp) {
		return undefined
	}

	if (mcp.kind === "resource") {
		const lines: ApprovalLine[] = [{ content: mcp.serverName, bold: true }]

		if (mcp.uri) {
			lines.push({ content: mcp.uri })
		}

		return { title: "MCP resource", lines }
	}

	const lines: ApprovalLine[] = [{ content: `${mcp.serverName} › ${mcp.toolName ?? "unknown tool"}`, bold: true }]
	const shown = mcp.argumentLines.slice(0, MAX_MCP_ARGUMENT_LINES)

	for (const line of shown) {
		lines.push({ content: line, truncate: true })
	}

	const hidden = mcp.argumentLines.length - shown.length

	if (hidden > 0) {
		lines.push({ content: `… +${hidden} lines`, secondary: true })
	}

	return { title: "MCP tool", lines }
}

/**
 * Build the title and body lines for a given ask.
 *
 * For "command" → title "Bash command" + `$ {command}` body line.
 * For "tool" → title via `getToolDisplayName(tool)` + body lines for
 *   path (bold), command, diff stats, mode as present.
 * For "use_mcp_server" → "MCP tool" / "MCP resource", see `buildMcpBody`.
 * Fallback → humanized type title, no body.
 */
function buildBody(ask: PendingAsk): ApprovalBody {
	if (ask.type === "command") {
		// command ask content is the raw command text
		return { title: "Bash command", lines: [{ content: `$ ${ask.content}` }] }
	}

	if (ask.type === "use_mcp_server") {
		const body = buildMcpBody(ask.content)

		if (body) {
			return body
		}
	}

	if (ask.type === "tool") {
		const info = parseToolInfo(ask.content)
		const toolName = info ? (info.tool as string) : undefined
		const title = toolName ? getToolDisplayName(toolName) : "Tool use"
		const lines: ApprovalLine[] = []

		if (info) {
			if (typeof info.path === "string" && info.path.length > 0) {
				lines.push({ content: info.path, bold: true })
			}
			if (typeof info.command === "string" && info.command.length > 0) {
				lines.push({ content: `$ ${info.command}` })
			}
			if (info.diffStats && typeof info.diffStats === "object") {
				const stats = info.diffStats as { added: number; removed: number }
				lines.push({ content: `+${stats.added} -${stats.removed}` })
			}
			if (typeof info.mode === "string" && info.mode.length > 0) {
				lines.push({ content: info.mode })
			}
		}

		return { title, lines }
	}

	if (ask.type === "api_req_failed") {
		// The content is the provider's error message; Yes retries the request.
		const errorLines = ask.content.split("\n").filter((line) => line.trim().length > 0)
		const shown = errorLines.slice(0, MAX_API_ERROR_LINES)
		const lines: ApprovalLine[] = shown.map((content) => ({ content }))
		const hidden = errorLines.length - shown.length

		if (hidden > 0) {
			lines.push({ content: `… +${hidden} lines`, secondary: true })
		}

		return { title: "API request failed", lines, question: "Retry the request?" }
	}

	return { title: humanizeType(ask.type), lines: [] }
}

/**
 * Permission-bordered approval dialog for tool/command approval.
 *
 * Renders a round-bordered box in `theme.permission` with a bold title,
 * parsed body lines, a "Do you want to proceed?" question, and a
 * SelectList of Yes / No. Legacy `y`/`n` keyboard accelerators are kept
 * (isActive-gated) so existing muscle memory continues to work alongside
 * the SelectList's arrow + Enter flow.
 */
function ApprovalDialog({ ask, onApprove, onReject, isActive = true }: ApprovalDialogProps) {
	const { title, lines, question = "Do you want to proceed?" } = useMemo(() => buildBody(ask), [ask])

	// Legacy y/n accelerators — preserve existing muscle memory.
	useInput(
		(input) => {
			if (!isActive) return
			const lower = input.toLowerCase()
			if (lower === "y") {
				onApprove()
			} else if (lower === "n") {
				onReject()
			}
		},
		{ isActive },
	)

	return (
		<Box borderStyle="round" borderColor={theme.permission} paddingX={1} flexDirection="column">
			<Text bold color={theme.permission}>
				{title}
			</Text>
			{lines.map((line, i) => (
				<Box key={i}>
					<Text
						color={line.secondary ? theme.secondaryText : theme.text}
						bold={line.bold}
						wrap={line.truncate ? "truncate-end" : "wrap"}>
						{line.content}
					</Text>
				</Box>
			))}
			<Text color={theme.secondaryText}>{question}</Text>
			<SelectList
				items={[
					{ label: "Yes", value: "yes" },
					{ label: "No", value: "no" },
				]}
				onSelect={(v) => (v === "yes" ? onApprove() : onReject())}
				onCancel={onReject}
				isActive={isActive}
			/>
		</Box>
	)
}

export default memo(ApprovalDialog)
