import { HTMLAttributes } from "react"
import { Bot } from "lucide-react"

import {
	DEFAULT_PARALLEL_TASKS_MAX_CONCURRENCY,
	DEFAULT_SUBAGENT_FOLLOWUP_TIMEOUT_SEC,
	MAX_PARALLEL_TASKS_MAX_CONCURRENCY,
	MIN_PARALLEL_TASKS_CONCURRENCY,
	PARALLEL_TASKS_NO_LIMIT,
	SETTINGS_DEFAULTS,
	isCompactProfile,
} from "@tumble-code/types"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { Slider } from "@/components/ui"

import { useSetting } from "./SettingsDraftContext"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { SettingsCard, settingDescription } from "./SettingsCard"

type SubagentSettingsProps = HTMLAttributes<HTMLDivElement>

/** The slider's last step, past the highest number: "No limit". */
const NO_LIMIT_STEP = MAX_PARALLEL_TASKS_MAX_CONCURRENCY + 1

/** Step of both context-limit sliders; the reminder stays at least one step below the stop. */
const CONTEXT_PERCENT_STEP = 5

/**
 * Settings for parallel background subagents (`run_parallel_tasks` fan-outs):
 * the hard concurrency cap and how long an interactive followup question
 * waits for the user before auto-approving. The context limits apply to every
 * delegated task (`new_task` children too).
 */
export const SubagentSettings = (props: SubagentSettingsProps) => {
	const { t } = useAppTranslation()
	const [parallelTasksMaxConcurrency, setParallelTasksMaxConcurrency] = useSetting("parallelTasksMaxConcurrency")
	const [subagentFollowupTimeoutSec, setSubagentFollowupTimeoutSec] = useSetting("subagentFollowupTimeoutSec")
	const [reminderSetting, setReminderPercent] = useSetting("subtaskContextReminderPercent")
	const [stopSetting, setStopPercent] = useSetting("subtaskContextStopPercent")
	// The profile being edited. A compact profile never starts subagents (its
	// tasks refuse new_task and run_parallel_tasks), whatever these global
	// settings say, so the tab says so instead of changing them for everyone.
	const [apiConfiguration] = useSetting("apiConfiguration")

	const concurrency =
		parallelTasksMaxConcurrency === PARALLEL_TASKS_NO_LIMIT
			? NO_LIMIT_STEP
			: (parallelTasksMaxConcurrency ?? DEFAULT_PARALLEL_TASKS_MAX_CONCURRENCY)
	const followupTimeout = subagentFollowupTimeoutSec ?? DEFAULT_SUBAGENT_FOLLOWUP_TIMEOUT_SEC
	const reminderPercent = reminderSetting ?? SETTINGS_DEFAULTS.subtaskContextReminderPercent
	const stopPercent = stopSetting ?? SETTINGS_DEFAULTS.subtaskContextStopPercent

	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Bot className="w-4" />
					<div>{t("settings:sections.subagents")}</div>
				</div>
			</SectionHeader>

			<Section>
				<SettingsCard>
					{isCompactProfile(apiConfiguration) && (
						<div className={settingDescription} data-testid="subagents-compact-note">
							{t("settings:subagents.compactNote")}
						</div>
					)}
					<SearchableSetting
						settingId="subagents-max-concurrency"
						section="subagents"
						label={t("settings:subagents.maxConcurrency.label")}>
						<span className="block font-medium mb-1">{t("settings:subagents.maxConcurrency.label")}</span>
						<div className="flex items-center gap-2">
							<Slider
								min={1}
								max={NO_LIMIT_STEP}
								step={1}
								value={[concurrency]}
								onValueChange={([value]) =>
									setParallelTasksMaxConcurrency(
										value === NO_LIMIT_STEP ? PARALLEL_TASKS_NO_LIMIT : value,
									)
								}
								data-testid="subagents-max-concurrency-slider"
							/>
							<span className="w-20">
								{concurrency < MIN_PARALLEL_TASKS_CONCURRENCY
									? t("settings:subagents.maxConcurrency.off")
									: concurrency === NO_LIMIT_STEP
										? t("settings:subagents.maxConcurrency.noLimit")
										: concurrency}
							</span>
						</div>
						<div className={settingDescription}>{t("settings:subagents.maxConcurrency.description")}</div>
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
								onValueChange={([value]) => setSubagentFollowupTimeoutSec(value)}
								data-testid="subagents-followup-timeout-slider"
							/>
							<span className="w-14">
								{followupTimeout === 0
									? t("settings:subagents.followupTimeout.immediate")
									: `${followupTimeout}s`}
							</span>
						</div>
						<div className={settingDescription}>{t("settings:subagents.followupTimeout.description")}</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="subagents-context-reminder"
						section="subagents"
						label={t("settings:subagents.contextReminder.label")}>
						<span className="block font-medium mb-1">{t("settings:subagents.contextReminder.label")}</span>
						<div className="flex items-center gap-2">
							<Slider
								min={10}
								max={stopPercent - CONTEXT_PERCENT_STEP}
								step={CONTEXT_PERCENT_STEP}
								value={[reminderPercent]}
								onValueChange={([value]) => setReminderPercent(value)}
								data-testid="subagents-context-reminder-slider"
							/>
							<span className="w-14">{`${reminderPercent}%`}</span>
						</div>
						<div className={settingDescription}>{t("settings:subagents.contextReminder.description")}</div>
					</SearchableSetting>

					<SearchableSetting
						settingId="subagents-context-stop"
						section="subagents"
						label={t("settings:subagents.contextStop.label")}>
						<span className="block font-medium mb-1">{t("settings:subagents.contextStop.label")}</span>
						<div className="flex items-center gap-2">
							<Slider
								min={reminderPercent + CONTEXT_PERCENT_STEP}
								max={100}
								step={CONTEXT_PERCENT_STEP}
								value={[stopPercent]}
								onValueChange={([value]) => setStopPercent(value)}
								data-testid="subagents-context-stop-slider"
							/>
							<span className="w-14">{`${stopPercent}%`}</span>
						</div>
						<div className={settingDescription}>{t("settings:subagents.contextStop.description")}</div>
					</SearchableSetting>
				</SettingsCard>
			</Section>
		</div>
	)
}
