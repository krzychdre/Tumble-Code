import React, { useState, useEffect, useMemo } from "react"
import { Database } from "lucide-react"

import type { IndexingStatus } from "@tumble-code/types"

import { cn } from "@src/lib/utils"
import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@/i18n/TranslationContext"

import { useExtensionSelector } from "@src/context/ExtensionStateContext"
import { PopoverTrigger, StandardTooltip, Button } from "@src/components/ui"

import { CodeIndexPopover } from "@src/components/code-index/CodeIndexPopover"
import { onExtensionMessage } from "@src/utils/extensionBus"

interface IndexingStatusBadgeProps {
	className?: string
}

export const IndexingStatusBadge: React.FC<IndexingStatusBadgeProps> = ({ className }) => {
	const { t } = useAppTranslation()
	// P1: narrow slice.
	const cwd = useExtensionSelector((s) => s.cwd)

	const [indexingStatus, setIndexingStatus] = useState<IndexingStatus>({
		systemStatus: "Standby",
		processedItems: 0,
		totalItems: 0,
		currentItemUnit: "items",
	})

	useEffect(() => {
		// Request initial indexing status.
		vscode.postMessage({ type: "requestIndexingStatus" })

		// Set up message listener for status updates.
		return onExtensionMessage("indexingStatusUpdate", (message) => {
			const status = message.values as IndexingStatus
			if (!status.workspacePath || status.workspacePath === cwd) {
				setIndexingStatus(status)
			}
		})
	}, [cwd])

	const progressPercentage = useMemo(
		() =>
			indexingStatus.totalItems > 0
				? Math.round((indexingStatus.processedItems / indexingStatus.totalItems) * 100)
				: 0,
		[indexingStatus.processedItems, indexingStatus.totalItems],
	)

	const tooltipText = useMemo(() => {
		switch (indexingStatus.systemStatus) {
			case "Standby":
				return t("chat:indexingStatus.ready")
			case "Indexing":
				return t("chat:indexingStatus.indexing", { percentage: progressPercentage })
			case "Indexed":
				return t("chat:indexingStatus.indexed")
			case "Stopping":
				return t("chat:indexingStatus.stopping")
			case "Error":
				return t("chat:indexingStatus.error")
			default:
				return t("chat:indexingStatus.status")
		}
	}, [indexingStatus.systemStatus, progressPercentage, t])

	const statusIconClass = useMemo(() => {
		const statusClasses = {
			Standby: "text-vscode-descriptionForeground",
			Indexing: "text-vscode-charts-yellow animate-pulse",
			Indexed: "text-vscode-charts-green",
			Stopping: "text-vscode-charts-yellow animate-pulse",
			Error: "text-vscode-charts-red",
		}

		return statusClasses[indexingStatus.systemStatus as keyof typeof statusClasses] || statusClasses.Standby
	}, [indexingStatus.systemStatus])

	return (
		<CodeIndexPopover indexingStatus={indexingStatus}>
			<StandardTooltip content={tooltipText}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						aria-label={tooltipText}
						className={cn(
							"relative size-[22px] p-0 rounded-control",
							"bg-transparent border border-frame hover:border-frame-hover hover:bg-surface-hover",
							"focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-vscode-focusBorder",
							className,
						)}>
						<Database className={cn("size-3.5 transition-colors duration-200", statusIconClass)} />
					</Button>
				</PopoverTrigger>
			</StandardTooltip>
		</CodeIndexPopover>
	)
}
