import { HTMLAttributes } from "react"
import { Bot } from "lucide-react"

import {
	DEFAULT_PARALLEL_TASKS_MAX_CONCURRENCY,
	DEFAULT_SUBAGENT_FOLLOWUP_TIMEOUT_SEC,
	MAX_PARALLEL_TASKS_MAX_CONCURRENCY,
	MIN_PARALLEL_TASKS_CONCURRENCY,
} from "@roo-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { Slider } from "@/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"

type SubagentSettingsProps = HTMLAttributes<HTMLDivElement> & {
	parallelTasksMaxConcurrency?: number
	subagentFollowupTimeoutSec?: number
	setCachedStateField: SetCachedStateField<"parallelTasksMaxConcurrency" | "subagentFollowupTimeoutSec">
}

/**
 * Settings for parallel background subagents (`run_parallel_tasks` fan-outs):
 * the hard concurrency cap and how long an interactive followup question
 * waits for the user before auto-approving.
 */
export const SubagentSettings = ({
	parallelTasksMaxConcurrency,
	subagentFollowupTimeoutSec,
	setCachedStateField,
	...props
}: SubagentSettingsProps) => {
	const { t } = useAppTranslation()

	const concurrency = parallelTasksMaxConcurrency ?? DEFAULT_PARALLEL_TASKS_MAX_CONCURRENCY
	const followupTimeout = subagentFollowupTimeoutSec ?? DEFAULT_SUBAGENT_FOLLOWUP_TIMEOUT_SEC

	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Bot className="w-4" />
					<div>{t("settings:sections.subagents")}</div>
				</div>
			</SectionHeader>

			<Section>
				<SearchableSetting
					settingId="subagents-max-concurrency"
					section="subagents"
					label={t("settings:subagents.maxConcurrency.label")}>
					<span className="block font-medium mb-1">{t("settings:subagents.maxConcurrency.label")}</span>
					<div className="flex items-center gap-2">
						<Slider
							min={1}
							max={MAX_PARALLEL_TASKS_MAX_CONCURRENCY}
							step={1}
							value={[concurrency]}
							onValueChange={([value]) => setCachedStateField("parallelTasksMaxConcurrency", value)}
							data-testid="subagents-max-concurrency-slider"
						/>
						<span className="w-10">
							{concurrency < MIN_PARALLEL_TASKS_CONCURRENCY
								? t("settings:subagents.maxConcurrency.off")
								: concurrency}
						</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:subagents.maxConcurrency.description")}
					</div>
				</SearchableSetting>

				<SearchableSetting
					settingId="subagents-followup-timeout"
					section="subagents"
					label={t("settings:subagents.followupTimeout.label")}>
					<span className="block font-medium mb-1">{t("settings:subagents.followupTimeout.label")}</span>
					<div className="flex items-center gap-2">
						<Slider
							min={0}
							max={1800}
							step={30}
							value={[followupTimeout]}
							onValueChange={([value]) => setCachedStateField("subagentFollowupTimeoutSec", value)}
							data-testid="subagents-followup-timeout-slider"
						/>
						<span className="w-14">
							{followupTimeout === 0
								? t("settings:subagents.followupTimeout.immediate")
								: `${followupTimeout}s`}
						</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:subagents.followupTimeout.description")}
					</div>
				</SearchableSetting>
			</Section>
		</div>
	)
}
