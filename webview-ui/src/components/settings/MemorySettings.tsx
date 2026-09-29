import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"

import type { ProviderSettingsEntry } from "@roo-code/types"

import { useSetting } from "./SettingsDraftContext"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Slider,
	LabeledCheckbox,
	ThemedTextField,
} from "@/components/ui"

type MemorySettingsProps = HTMLAttributes<HTMLDivElement> & {
	listApiConfigMeta: ProviderSettingsEntry[]
}

// Radix Select rejects empty-string item values; "-" is safe because profile
// ids are nanoid-generated (same sentinel as PromptsSettings).
const UNSET_PROFILE = "-"

const MIN_DREAM_HOURS = 1
const MAX_DREAM_HOURS = 168 // 1 week
const DEFAULT_DREAM_HOURS = 24

const MIN_DREAM_SESSIONS = 1
const MAX_DREAM_SESSIONS = 100
const DEFAULT_DREAM_SESSIONS = 5

export const MemorySettings = ({ listApiConfigMeta, ...props }: MemorySettingsProps) => {
	const { t } = useAppTranslation()
	const [autoMemoryEnabled, setAutoMemoryEnabled] = useSetting("autoMemoryEnabled")
	const [autoMemoryDirectory, setAutoMemoryDirectory] = useSetting("autoMemoryDirectory")
	const [autoMemoryShareWithClaudeCode, setAutoMemoryShareWithClaudeCode] = useSetting(
		"autoMemoryShareWithClaudeCode",
	)
	const [memoryRecallEnabled, setMemoryRecallEnabled] = useSetting("memoryRecallEnabled")
	const [autoDreamEnabled, setAutoDreamEnabled] = useSetting("autoDreamEnabled")
	const [autoDreamMinHours, setAutoDreamMinHours] = useSetting("autoDreamMinHours")
	const [autoDreamMinSessions, setAutoDreamMinSessions] = useSetting("autoDreamMinSessions")
	const [memoryWriterApiConfigId, setMemoryWriterApiConfigId] = useSetting("memoryWriterApiConfigId")
	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.memory")}</SectionHeader>

			<Section>
				<SearchableSetting settingId="memory-enable" section="memory" label={t("settings:memory.enable.label")}>
					<LabeledCheckbox
						checked={autoMemoryEnabled ?? true}
						onChange={(e: any) => {
							setAutoMemoryEnabled(e.target.checked)
						}}>
						<span className="font-medium">{t("settings:memory.enable.label")}</span>
					</LabeledCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:memory.enable.description")}
					</div>
				</SearchableSetting>

				{autoMemoryEnabled && (
					<>
						<SearchableSetting
							settingId="memory-recall"
							section="memory"
							label={t("settings:memory.recall.label")}
							className="mt-4">
							<LabeledCheckbox
								checked={memoryRecallEnabled ?? true}
								onChange={(e: any) => {
									setMemoryRecallEnabled(e.target.checked)
								}}>
								<span className="font-medium">{t("settings:memory.recall.label")}</span>
							</LabeledCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:memory.recall.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="memory-directory"
							section="memory"
							label={t("settings:memory.directory.label")}
							className="mt-4">
							<label className="block text-sm font-medium mb-2">
								{t("settings:memory.directory.label")}
							</label>
							<ThemedTextField
								value={autoMemoryDirectory ?? ""}
								placeholder={t("settings:memory.directory.placeholder")}
								onInput={(e: any) => {
									// "" (not undefined) so Save clears the host's value.
									setAutoMemoryDirectory(e.target.value)
								}}
								className="w-full"
								data-testid="memory-directory-input"
							/>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:memory.directory.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="memory-share-claude-code"
							section="memory"
							label={t("settings:memory.shareWithClaudeCode.label")}
							className="mt-4">
							<LabeledCheckbox
								checked={autoMemoryShareWithClaudeCode ?? false}
								disabled={!!autoMemoryDirectory}
								onChange={(e: any) => {
									setAutoMemoryShareWithClaudeCode(e.target.checked)
								}}
								data-testid="memory-share-claude-code-checkbox">
								<span className="font-medium">{t("settings:memory.shareWithClaudeCode.label")}</span>
							</LabeledCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{autoMemoryDirectory
									? t("settings:memory.shareWithClaudeCode.overridden")
									: t("settings:memory.shareWithClaudeCode.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="memory-writer-profile"
							section="memory"
							label={t("settings:memory.writerProfile.label")}
							className="mt-4">
							<label className="block text-sm font-medium mb-2">
								{t("settings:memory.writerProfile.label")}
							</label>
							<Select
								value={memoryWriterApiConfigId || UNSET_PROFILE}
								onValueChange={(value) => {
									// "" (not undefined) so Save clears the host's value.
									setMemoryWriterApiConfigId(value === UNSET_PROFILE ? "" : value)
								}}
								data-testid="memory-writer-profile-select">
								<SelectTrigger className="w-full">
									<SelectValue placeholder={t("settings:memory.writerProfile.useCurrent")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={UNSET_PROFILE}>
										{t("settings:memory.writerProfile.useCurrent")}
									</SelectItem>
									{listApiConfigMeta.map((config) => (
										<SelectItem key={config.id} value={config.id}>
											{config.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:memory.writerProfile.description")}
							</div>
						</SearchableSetting>

						<SearchableSetting
							settingId="memory-dream-enable"
							section="memory"
							label={t("settings:memory.dream.enable.label")}
							className="mt-4">
							<LabeledCheckbox
								checked={autoDreamEnabled ?? true}
								onChange={(e: any) => {
									setAutoDreamEnabled(e.target.checked)
								}}>
								<span className="font-medium">{t("settings:memory.dream.enable.label")}</span>
							</LabeledCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:memory.dream.enable.description")}
							</div>
						</SearchableSetting>

						{autoDreamEnabled && (
							<>
								<SearchableSetting
									settingId="memory-dream-hours"
									section="memory"
									label={t("settings:memory.dream.minHours.label")}
									className="mt-4">
									<label className="block text-sm font-medium mb-2">
										{t("settings:memory.dream.minHours.label")}
									</label>
									<div className="flex items-center gap-2">
										<Slider
											min={MIN_DREAM_HOURS}
											max={MAX_DREAM_HOURS}
											step={1}
											defaultValue={[autoDreamMinHours ?? DEFAULT_DREAM_HOURS]}
											onValueChange={([value]) => {
												setAutoDreamMinHours(value)
											}}
											className="flex-1"
											data-testid="memory-dream-hours-slider"
										/>
										<span className="w-12 text-center">
											{autoDreamMinHours ?? DEFAULT_DREAM_HOURS}
										</span>
									</div>
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										{t("settings:memory.dream.minHours.description")}
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="memory-dream-sessions"
									section="memory"
									label={t("settings:memory.dream.minSessions.label")}
									className="mt-4">
									<label className="block text-sm font-medium mb-2">
										{t("settings:memory.dream.minSessions.label")}
									</label>
									<div className="flex items-center gap-2">
										<Slider
											min={MIN_DREAM_SESSIONS}
											max={MAX_DREAM_SESSIONS}
											step={1}
											defaultValue={[autoDreamMinSessions ?? DEFAULT_DREAM_SESSIONS]}
											onValueChange={([value]) => {
												setAutoDreamMinSessions(value)
											}}
											className="flex-1"
											data-testid="memory-dream-sessions-slider"
										/>
										<span className="w-12 text-center">
											{autoDreamMinSessions ?? DEFAULT_DREAM_SESSIONS}
										</span>
									</div>
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										{t("settings:memory.dream.minSessions.description")}
									</div>
								</SearchableSetting>
							</>
						)}
					</>
				)}
			</Section>
		</div>
	)
}
