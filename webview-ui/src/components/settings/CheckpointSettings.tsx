import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Slider, LabeledCheckbox } from "@/components/ui"

import { useSetting } from "./SettingsDraftContext"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { SettingsCard, checkboxDescription, settingDescription } from "./SettingsCard"
import {
	DEFAULT_CHECKPOINT_TIMEOUT_SECONDS,
	MAX_CHECKPOINT_TIMEOUT_SECONDS,
	MIN_CHECKPOINT_TIMEOUT_SECONDS,
} from "@tumble-code/types"

type CheckpointSettingsProps = HTMLAttributes<HTMLDivElement>

export const CheckpointSettings = (props: CheckpointSettingsProps) => {
	const { t } = useAppTranslation()
	const [enableCheckpoints, setEnableCheckpoints] = useSetting("enableCheckpoints")
	const [checkpointTimeout, setCheckpointTimeout] = useSetting("checkpointTimeout")
	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.checkpoints")}</SectionHeader>

			<Section>
				<SettingsCard>
				<SearchableSetting
					settingId="checkpoints-enable"
					section="checkpoints"
					label={t("settings:checkpoints.enable.label")}>
					<LabeledCheckbox
						checked={enableCheckpoints}
						onChange={(e: any) => {
							setEnableCheckpoints(e.target.checked)
						}}>
						<span className="font-medium">{t("settings:checkpoints.enable.label")}</span>
					</LabeledCheckbox>
					<div className={checkboxDescription}>
						{t("settings:checkpoints.enable.description")}
					</div>
				</SearchableSetting>

				{enableCheckpoints && (
					<SearchableSetting
						settingId="checkpoints-timeout"
						section="checkpoints"
						label={t("settings:checkpoints.timeout.label")}>
						<label className="block font-medium mb-1">
							{t("settings:checkpoints.timeout.label")}
						</label>
						<div className="flex items-center gap-2">
							<Slider
								min={MIN_CHECKPOINT_TIMEOUT_SECONDS}
								max={MAX_CHECKPOINT_TIMEOUT_SECONDS}
								step={1}
								defaultValue={[checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS]}
								onValueChange={([value]) => {
									setCheckpointTimeout(value)
								}}
								className="flex-1"
								data-testid="checkpoint-timeout-slider"
							/>
							<span className="w-12 text-center">
								{checkpointTimeout ?? DEFAULT_CHECKPOINT_TIMEOUT_SECONDS}
							</span>
						</div>
						<div className={settingDescription}>
							{t("settings:checkpoints.timeout.description")}
						</div>
					</SearchableSetting>
				)}
				</SettingsCard>
			</Section>
		</div>
	)
}
