import { memo, type ReactNode } from "react"
import { Box, Text } from "ink"

import type { IndexingStatus } from "@tumble-code/types"

import type { PermissionMode } from "../../../lib/utils/permissions.js"
import * as theme from "../../theme.js"
import type { Toast } from "../../hooks/useToast.js"
import type { CloudStatus } from "../../types.js"
import ContextGauge from "./ContextGauge.js"

/** Formats a cost as currency with a $ prefix, e.g. 1.5 -> "$1.50". */
function formatCost(cost: number): string {
	return `$${cost.toFixed(2)}`
}

interface InputFooterProps {
	/** Current toast (highest-priority left hint) */
	toast?: Toast | null
	/** Exit hint shown when ctrl+c was pressed once (e.g. "Press ctrl+c again to exit") */
	exitHint?: string | null
	/** Active mode slug (e.g. "code", "ask") */
	mode?: string
	/** The /permissions mode: "allow" runs actions without approval */
	permissionMode?: PermissionMode
	/** Active model id (e.g. "gpt-5") */
	model?: string
	/** Context window usage percent 0-100; null = unknown */
	contextPercent?: number | null
	/** Tokens in the context now, shown next to the percentage */
	contextTokens?: number
	/** Context window size in tokens */
	contextWindow?: number
	/** Cumulative session cost in USD; shown when > 0 */
	cost?: number
	/** Cloud session and bridge; shown only when signed in (UI plan §4) */
	cloud?: CloudStatus | null
	/** The code index of the workspace; shown unless the index is off */
	codeIndex?: IndexingStatus | null
}

/**
 * The cloud segment, or null for a run without a cloud session (the normal
 * local run shows nothing). `●` connected; `○` otherwise, with "connecting"
 * or, in the warning colour, "offline" (the bridge failed and keeps
 * retrying: sharing and remote control do not work meanwhile).
 */
function CloudSegment({ cloud }: { cloud: CloudStatus }) {
	switch (cloud.remoteControl) {
		case "connected":
			return (
				<Text>
					<Text color={theme.success}>●</Text>
					<Text dimColor> cloud</Text>
				</Text>
			)
		case "connecting":
			return <Text dimColor>○ cloud connecting</Text>
		case "offline":
			return <Text color={theme.warning}>○ cloud offline</Text>
		case "off":
			return <Text dimColor>○ cloud</Text>
	}
}

/**
 * The code index segment, or null while the index is off (Standby): `◐ index
 * 42%` while it indexes (the share of the current batch), `● index` once the
 * workspace is indexed, `✗ index` in the error colour.
 */
function CodeIndexSegment({ status }: { status: IndexingStatus }) {
	switch (status.systemStatus) {
		case "Indexing":
			return (
				<Text dimColor>
					◐ index
					{status.totalItems > 0 ? ` ${Math.floor((status.processedItems / status.totalItems) * 100)}%` : ""}
				</Text>
			)
		case "Indexed":
			return (
				<Text>
					<Text color={theme.success}>●</Text>
					<Text dimColor> index</Text>
				</Text>
			)
		case "Error":
			return <Text color={theme.error}>✗ index</Text>
		case "Stopping":
			return <Text dimColor>○ index stopping</Text>
		default:
			return null
	}
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
 * "? for shortcuts" (dim). Right side: the cloud segment (signed-in runs
 * only), `{mode} · permissions: {permissionMode} · {model}` + the context
 * gauge (when the percent is not null, with the tokens out of the window) + ` · {cost}` (when > 0). The gauge
 * owns its own colouring; see ContextGauge.
 */
function InputFooter({
	toast,
	exitHint,
	mode,
	permissionMode,
	model,
	contextPercent,
	contextTokens,
	contextWindow,
	cost,
	cloud,
	codeIndex,
}: InputFooterProps) {
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
	if (codeIndex && codeIndex.systemStatus !== "Standby") {
		rightParts.push(<CodeIndexSegment key="codeIndex" status={codeIndex} />)
		added = true
	}
	if (cloud?.signedIn) {
		if (added) rightParts.push(<DimDot key="sep-cloud" />)
		rightParts.push(<CloudSegment key="cloud" cloud={cloud} />)
		added = true
	}
	if (mode) {
		if (added) rightParts.push(<DimDot key="sep-mode" />)
		rightParts.push(
			<Text key="mode" dimColor>
				{mode}
			</Text>,
		)
		added = true
	}
	if (permissionMode) {
		if (added) rightParts.push(<DimDot key="sep-permissions" />)
		rightParts.push(
			<Text key="permissions" dimColor>
				permissions: {permissionMode}
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
		rightParts.push(
			<ContextGauge key="ctx" percent={contextPercent} tokens={contextTokens} window={contextWindow} />,
		)
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
