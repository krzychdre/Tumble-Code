import { memo } from "react"
import { useTranslation } from "react-i18next"
import { Brain } from "lucide-react"

import { SETTINGS_DEFAULTS } from "@tumble-code/types"

import { cn } from "@/lib/utils"
import { useExtensionSelector } from "@src/context/ExtensionStateContext"
import { StandardTooltip } from "@src/components/ui"

/**
 * Brain icon next to the indexing icon in the composer toolbar. Grey while the memory system is
 * enabled and idle, green while recall prefetches or background writers (extraction/dream) are
 * running. Renders nothing when memory is disabled. The label is only a tooltip.
 */
const MemoryActivityBadge = memo(() => {
	const { t } = useTranslation()
	const memoryActivity = useExtensionSelector((s) => s.memoryActivity)
	const enabled = useExtensionSelector((s) => s.autoMemoryEnabled ?? SETTINGS_DEFAULTS.autoMemoryEnabled)

	if (!enabled) {
		return null
	}

	const recalling = (memoryActivity?.recall ?? 0) > 0
	const writing = (memoryActivity?.write ?? 0) > 0
	const busy = recalling || writing

	const label = busy
		? recalling && writing
			? t("chat:memoryActivity.both")
			: writing
				? t("chat:memoryActivity.writing")
				: t("chat:memoryActivity.recalling")
		: t("chat:memoryActivity.idle")

	return (
		<StandardTooltip content={label}>
			<span
				role="status"
				aria-label={label}
				data-busy={busy}
				className="relative h-5 w-5 flex items-center justify-center opacity-85">
				<Brain
					className={cn(
						"w-4 h-4 transition-colors duration-200",
						busy ? "text-vscode-charts-green" : "text-vscode-descriptionForeground",
					)}
					aria-hidden
				/>
			</span>
		</StandardTooltip>
	)
})

MemoryActivityBadge.displayName = "MemoryActivityBadge"

export default MemoryActivityBadge
