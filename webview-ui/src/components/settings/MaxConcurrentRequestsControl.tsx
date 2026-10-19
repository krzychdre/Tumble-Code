import { subagentSlotsForProfile } from "@tumble-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"

import { FormattedTextField, unlimitedIntegerFormatter } from "../common/FormattedTextField"

interface MaxConcurrentRequestsControlProps {
	value: number | undefined
	onChange: (value: number | undefined) => void
}

/**
 * The profile's `maxConcurrentRequests`: how many requests this provider and
 * model take at once. Each subagent on the profile takes one, and the main task
 * takes one when it runs on the same profile. Empty means no per-profile limit
 * (only the global "Max parallel subagents" applies); 0 is not a valid value,
 * so the formatter turns it into empty too. A set limit also shows how many
 * subagents fit beside a main task on the same profile.
 */
export const MaxConcurrentRequestsControl = ({ value, onChange }: MaxConcurrentRequestsControlProps) => {
	const { t } = useAppTranslation()
	const slotsWithMainTask = subagentSlotsForProfile(value, true)

	return (
		<div className="flex flex-col gap-1">
			<label htmlFor="max-concurrent-requests" className="block font-medium mb-1">
				{t("settings:providers.maxConcurrentRequests.label")}
			</label>
			<FormattedTextField
				id="max-concurrent-requests"
				value={value}
				onValueChange={onChange}
				formatter={unlimitedIntegerFormatter}
				placeholder={t("settings:providers.maxConcurrentRequests.unlimited")}
				className="max-w-[200px]"
				data-testid="max-concurrent-requests-input"
			/>
			<div className="text-sm text-vscode-descriptionForeground">
				{t("settings:providers.maxConcurrentRequests.description")}
			</div>
			{slotsWithMainTask !== undefined && (
				<div className="text-sm text-vscode-descriptionForeground" data-testid="max-concurrent-requests-slots">
					{t("settings:providers.maxConcurrentRequests.slotsWithMainTask", { slots: slotsWithMainTask })}
				</div>
			)}
		</div>
	)
}
