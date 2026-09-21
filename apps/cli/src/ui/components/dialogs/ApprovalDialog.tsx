import { memo, useMemo } from "react"
import { Box, Text, useInput } from "ink"

import * as theme from "../../theme.js"
import SelectList from "../primitives/SelectList.js"
import { getToolDisplayName } from "../tools/utils.js"
import type { PendingAsk } from "../../types.js"

export interface ApprovalDialogProps {
	/** The pending ask to display (type "command" or "tool") */
	ask: PendingAsk
	/** Called when the user approves */
	onApprove: () => void
	/** Called when the user rejects */
	onReject: () => void
	/** When false, the dialog ignores all input (default true) */
	isActive?: boolean
}

/**
 * Parsed body content for an approval dialog.
 */
interface ApprovalBody {
	title: string
	lines: React.ReactNode[]
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
		default:
			return type.charAt(0).toUpperCase() + type.slice(1)
	}
}

/**
 * Build the title and body lines for a given ask.
 *
 * For "command" → title "Bash command" + `$ {command}` body line.
 * For "tool" → title via `getToolDisplayName(tool)` + body lines for
 *   path (bold), command, diff stats, mode as present.
 * Fallback → humanized type title, no body.
 */
function buildBody(ask: PendingAsk): ApprovalBody {
	if (ask.type === "command") {
		// command ask content is the raw command text
		const lines: React.ReactNode[] = [<Text key="cmd">$ {ask.content}</Text>]
		return { title: "Bash command", lines }
	}

	if (ask.type === "tool") {
		const info = parseToolInfo(ask.content)
		const toolName = info ? (info.tool as string) : undefined
		const title = toolName ? getToolDisplayName(toolName) : "Tool use"
		const lines: React.ReactNode[] = []

		if (info) {
			if (typeof info.path === "string" && info.path.length > 0) {
				lines.push(
					<Text key="path" bold>
						{info.path}
					</Text>,
				)
			}
			if (typeof info.command === "string" && info.command.length > 0) {
				lines.push(<Text key="command">$ {info.command}</Text>)
			}
			if (info.diffStats && typeof info.diffStats === "object") {
				const stats = info.diffStats as { added: number; removed: number }
				lines.push(
					<Text key="diff">
						+{stats.added} -{stats.removed}
					</Text>,
				)
			}
			if (typeof info.mode === "string" && info.mode.length > 0) {
				lines.push(<Text key="mode">{info.mode}</Text>)
			}
		}

		return { title, lines }
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
	const { title, lines } = useMemo(() => buildBody(ask), [ask])

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
					<Text color={theme.text}>{line}</Text>
				</Box>
			))}
			<Text color={theme.secondaryText}>Do you want to proceed?</Text>
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
