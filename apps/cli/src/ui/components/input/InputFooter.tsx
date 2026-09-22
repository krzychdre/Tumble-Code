import { memo, type ReactNode } from "react"
import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import type { Toast } from "../../hooks/useToast.js"
import { formatCost } from "../MetricsDisplay.js"
import ContextGauge from "./ContextGauge.js"

interface InputFooterProps {
	/** Current toast (highest-priority left hint) */
	toast?: Toast | null
	/** Exit hint shown when ctrl+c was pressed once (e.g. "Press ctrl+c again to exit") */
	exitHint?: string | null
	/** Active mode slug (e.g. "code", "ask") */
	mode?: string
	/** Active model id (e.g. "gpt-5") */
	model?: string
	/** Context window usage percent 0-100; null = unknown */
	contextPercent?: number | null
	/** Cumulative session cost in USD; shown when > 0 */
	cost?: number
}

function toastColor(type: Toast["type"]): string {
	switch (type) {
		case "success":
			return theme.success
		case "warning":
			return theme.warning
		case "error":
			return theme.error
		case "info":
		default:
			return theme.suggestion
	}
}

function toastIcon(type: Toast["type"]): string {
	switch (type) {
		case "success":
			return "✓"
		case "warning":
			return "⚠"
		case "error":
			return "✗"
		case "info":
		default:
			return "ℹ"
	}
}

const DimDot = () => <Text dimColor>{" · "}</Text>

/**
 * Single dim line below the input box.
 *
 * Left side (priority order): toast (colored by kind) > exitHint (dim) >
 * "? for shortcuts" (dim). Right side: `{mode} · {model}` + the context
 * gauge (when the percent is not null) + ` · {cost}` (when > 0). The gauge
 * owns its own colouring; see ContextGauge.
 */
function InputFooter({ toast, exitHint, mode, model, contextPercent, cost }: InputFooterProps) {
	let leftHint: ReactNode
	if (toast) {
		leftHint = (
			<Text color={toastColor(toast.type)}>
				{toastIcon(toast.type)} {toast.message}
			</Text>
		)
	} else if (exitHint) {
		leftHint = <Text dimColor>{exitHint}</Text>
	} else {
		leftHint = <Text dimColor>? for shortcuts</Text>
	}

	const rightParts: ReactNode[] = []
	let added = false
	if (mode) {
		if (added) rightParts.push(<DimDot key="sep-mode" />)
		rightParts.push(
			<Text key="mode" dimColor>
				{mode}
			</Text>,
		)
		added = true
	}
	if (model) {
		if (added) rightParts.push(<DimDot key="sep-model" />)
		rightParts.push(
			<Text key="model" dimColor>
				{model}
			</Text>,
		)
		added = true
	}
	if (contextPercent != null) {
		if (added) rightParts.push(<DimDot key="sep-ctx" />)
		rightParts.push(<ContextGauge key="ctx" percent={contextPercent} />)
		added = true
	}
	if (cost != null && cost > 0) {
		if (added) rightParts.push(<DimDot key="sep-cost" />)
		rightParts.push(
			<Text key="cost" dimColor>
				{formatCost(cost)}
			</Text>,
		)
	}

	return (
		<Box>
			<Box flexGrow={1}>{leftHint}</Box>
			<Box>{rightParts.length > 0 ? rightParts : null}</Box>
		</Box>
	)
}

export default memo(InputFooter)
