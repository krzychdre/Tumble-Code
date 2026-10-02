import { useMemo } from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import type { IndexingStatus } from "@tumble-code/types"

import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@src/lib/utils"

type CodeIndexStatusSectionProps = {
	indexingStatus: IndexingStatus
}

/** The indexing state with its colored dot and message, and a progress bar while indexing. */
export const CodeIndexStatusSection = ({ indexingStatus }: CodeIndexStatusSectionProps) => {
	const { t } = useAppTranslation()

	const progressPercentage = useMemo(
		() =>
			indexingStatus.totalItems > 0
				? Math.round((indexingStatus.processedItems / indexingStatus.totalItems) * 100)
				: 0,
		[indexingStatus.processedItems, indexingStatus.totalItems],
	)

	const transformStyleString = `translateX(-${100 - progressPercentage}%)`

	return (
		<div className="space-y-2">
			<h4 className="text-sm font-medium">{t("settings:codeIndex.statusTitle")}</h4>
			<div className="text-sm text-vscode-descriptionForeground">
				<span
					className={cn("inline-block w-3 h-3 mr-2", {
						"bg-vscode-descriptionForeground": indexingStatus.systemStatus === "Standby",
						"bg-[var(--status-running)] animate-pulse": indexingStatus.systemStatus === "Indexing",
						"bg-[var(--status-done)]": indexingStatus.systemStatus === "Indexed",
						"bg-[var(--status-failed)]": indexingStatus.systemStatus === "Error",
					})}
				/>
				{t(`settings:codeIndex.indexingStatuses.${indexingStatus.systemStatus.toLowerCase()}`)}
				{indexingStatus.message ? ` - ${indexingStatus.message}` : ""}
			</div>

			{indexingStatus.systemStatus === "Indexing" && (
				<div className="mt-2">
					<ProgressPrimitive.Root
						className="relative h-2 w-full overflow-hidden bg-secondary"
						value={progressPercentage}>
						<ProgressPrimitive.Indicator
							className="h-full w-full flex-1 bg-primary transition-transform duration-300 ease-in-out"
							style={{
								transform: transformStyleString,
							}}
						/>
					</ProgressPrimitive.Root>
				</div>
			)}
		</div>
	)
}
