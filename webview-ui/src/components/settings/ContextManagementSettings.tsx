import { HTMLAttributes } from "react"
import React from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { FoldVertical } from "lucide-react"

import { PRUNE_CONDENSE_DEFAULTS, SETTINGS_DEFAULTS, type ProviderSettingsEntry } from "@tumble-code/types"

import { supportPrompt } from "@shared/support-prompt"

import { cn } from "@/lib/utils"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Slider,
	Button,
	StandardTooltip,
	Textarea,
} from "@/components/ui"

import { useSetting } from "./SettingsDraftContext"
import { CheckboxRow, NumberRow, SliderRow } from "./SettingRows"
import { postImmediateSetting } from "./postImmediateSetting"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { SettingsCard, SettingsNested, settingDescription } from "./SettingsCard"

const UNSET_PROFILE = "-"

type ContextManagementSettingsProps = HTMLAttributes<HTMLDivElement> & {
	listApiConfigMeta: ProviderSettingsEntry[]
}

// The diagnostics slider's top position stands for "no limit", stored as -1 (0 and below also mean no limit).
const DIAGNOSTICS_SLIDER_UNLIMITED = 100

export const ContextManagementSettings = ({
	listApiConfigMeta,
	className,
	...props
}: ContextManagementSettingsProps) => {
	const { t } = useAppTranslation()
	const [autoCondenseContext, setAutoCondenseContext] = useSetting("autoCondenseContext")
	const [autoCondenseContextPercent, setAutoCondenseContextPercent] = useSetting("autoCondenseContextPercent")
	const [autoCondenseContextApiConfigId, setAutoCondenseContextApiConfigId] = useSetting(
		"autoCondenseContextApiConfigId",
	)
	const [pruneBeforeCondense, setPruneBeforeCondense] = useSetting("pruneBeforeCondense")
	const [pruneToolResultBudget, setPruneToolResultBudget] = useSetting("pruneToolResultBudget")
	const [maxOpenTabsContext, setMaxOpenTabsContext] = useSetting("maxOpenTabsContext")
	const [maxWorkspaceFiles, setMaxWorkspaceFiles] = useSetting("maxWorkspaceFiles")
	const [showRooIgnoredFiles, setShowRooIgnoredFiles] = useSetting("showRooIgnoredFiles")
	const [enableSubfolderRules, setEnableSubfolderRules] = useSetting("enableSubfolderRules")
	const [maxImageFileSize, setMaxImageFileSize] = useSetting("maxImageFileSize")
	const [maxTotalImageSize, setMaxTotalImageSize] = useSetting("maxTotalImageSize")
	const [profileThresholds = {}, setProfileThresholds] = useSetting("profileThresholds")
	const [includeDiagnosticMessages, setIncludeDiagnosticMessages] = useSetting("includeDiagnosticMessages")
	const [maxDiagnosticMessages, setMaxDiagnosticMessages] = useSetting("maxDiagnosticMessages")
	const [writeDelayMs, setWriteDelayMs] = useSetting("writeDelayMs")
	const [includeCurrentTime, setIncludeCurrentTime] = useSetting("includeCurrentTime")
	const [includeCurrentCost, setIncludeCurrentCost] = useSetting("includeCurrentCost")
	const [maxGitStatusFiles, setMaxGitStatusFiles] = useSetting("maxGitStatusFiles")
	const [customSupportPromptsSetting, setCustomSupportPrompts] = useSetting("customSupportPrompts")
	const customSupportPrompts = customSupportPromptsSetting || {}
	const [selectedThresholdProfile, setSelectedThresholdProfile] = React.useState<string>("default")

	const diagnosticsUnlimited =
		(maxDiagnosticMessages !== undefined && maxDiagnosticMessages <= 0) ||
		maxDiagnosticMessages === DIAGNOSTICS_SLIDER_UNLIMITED
	const diagnosticsSliderValue = diagnosticsUnlimited
		? DIAGNOSTICS_SLIDER_UNLIMITED
		: (maxDiagnosticMessages ?? SETTINGS_DEFAULTS.maxDiagnosticMessages)
	const unlimitedLabel = t("settings:contextManagement.diagnostics.maxMessages.unlimitedLabel")

	const setCondensePrompt = (value: string) => setCustomSupportPrompts({ ...customSupportPrompts, CONDENSE: value })

	const handleCondenseReset = () => {
		const updatedPrompts = { ...customSupportPrompts }
		delete updatedPrompts["CONDENSE"]
		setCustomSupportPrompts(updatedPrompts)
	}

	// Helper function to get the current threshold value based on selected profile
	const getCurrentThresholdValue = () => {
		if (selectedThresholdProfile === "default") {
			return autoCondenseContextPercent
		}
		const profileThreshold = profileThresholds[selectedThresholdProfile]
		if (profileThreshold === undefined || profileThreshold === -1) {
			return autoCondenseContextPercent // Use default if profile not configured or set to -1
		}
		return profileThreshold
	}

	// Helper function to handle threshold changes
	const handleThresholdChange = (value: number) => {
		if (selectedThresholdProfile === "default") {
			setAutoCondenseContextPercent(value)
		} else {
			const newThresholds = {
				...profileThresholds,
				[selectedThresholdProfile]: value,
			}

			setProfileThresholds(newThresholds)
			postImmediateSetting("profileThresholds", newThresholds)
		}
	}
	return (
		<div className={cn("flex flex-col", className)} {...props}>
			<SectionHeader description={t("settings:contextManagement.description")}>
				{t("settings:sections.contextManagement")}
			</SectionHeader>

			<Section>
				<SettingsCard>
					<SliderRow
						section="contextManagement"
						settingId="context-open-tabs"
						label={t("settings:contextManagement.openTabs.label")}
						description={t("settings:contextManagement.openTabs.description")}
						min={0}
						max={500}
						step={1}
						value={maxOpenTabsContext ?? SETTINGS_DEFAULTS.maxOpenTabsContext}
						onChange={setMaxOpenTabsContext}
						testId="open-tabs-limit-slider"
					/>
					<SliderRow
						section="contextManagement"
						settingId="context-workspace-files"
						label={t("settings:contextManagement.workspaceFiles.label")}
						description={t("settings:contextManagement.workspaceFiles.description")}
						min={0}
						max={500}
						step={1}
						value={maxWorkspaceFiles ?? SETTINGS_DEFAULTS.maxWorkspaceFiles}
						onChange={setMaxWorkspaceFiles}
						testId="workspace-files-limit-slider"
					/>
					<SliderRow
						section="contextManagement"
						settingId="context-max-git-status-files"
						label={t("settings:contextManagement.maxGitStatusFiles.label")}
						description={t("settings:contextManagement.maxGitStatusFiles.description")}
						min={0}
						max={50}
						step={1}
						value={maxGitStatusFiles ?? SETTINGS_DEFAULTS.maxGitStatusFiles}
						onChange={setMaxGitStatusFiles}
						testId="max-git-status-files-slider"
					/>
					<CheckboxRow
						section="contextManagement"
						settingId="context-show-rooignored-files"
						label={t("settings:contextManagement.rooignore.label")}
						description={t("settings:contextManagement.rooignore.description")}
						checked={showRooIgnoredFiles}
						onChange={setShowRooIgnoredFiles}
						testId="show-rooignored-files-checkbox"
					/>
					<CheckboxRow
						section="contextManagement"
						settingId="context-enable-subfolder-rules"
						label={t("settings:contextManagement.enableSubfolderRules.label")}
						description={t("settings:contextManagement.enableSubfolderRules.description")}
						checked={enableSubfolderRules}
						onChange={setEnableSubfolderRules}
						testId="enable-subfolder-rules-checkbox"
					/>
					<NumberRow
						section="contextManagement"
						settingId="context-max-image-file-size"
						label={t("settings:contextManagement.maxImageFileSize.label")}
						description={t("settings:contextManagement.maxImageFileSize.description")}
						unit={t("settings:contextManagement.maxImageFileSize.mb")}
						min={1}
						max={100}
						value={maxImageFileSize ?? SETTINGS_DEFAULTS.maxImageFileSize}
						onChange={setMaxImageFileSize}
						testId="max-image-file-size-input"
					/>
					<NumberRow
						section="contextManagement"
						settingId="context-max-total-image-size"
						label={t("settings:contextManagement.maxTotalImageSize.label")}
						description={t("settings:contextManagement.maxTotalImageSize.description")}
						unit={t("settings:contextManagement.maxTotalImageSize.mb")}
						min={1}
						max={500}
						value={maxTotalImageSize ?? SETTINGS_DEFAULTS.maxTotalImageSize}
						onChange={setMaxTotalImageSize}
						testId="max-total-image-size-input"
					/>
					<CheckboxRow
						section="contextManagement"
						settingId="context-include-diagnostic-messages"
						label={t("settings:contextManagement.diagnostics.includeMessages.label")}
						description={t("settings:contextManagement.diagnostics.includeMessages.description")}
						checked={includeDiagnosticMessages}
						onChange={setIncludeDiagnosticMessages}
						testId="include-diagnostic-messages-checkbox"
					/>

					<SearchableSetting
						settingId="context-max-diagnostic-messages"
						section="contextManagement"
						label={t("settings:contextManagement.diagnostics.maxMessages.label")}>
						<span className="block font-medium mb-1">
							{t("settings:contextManagement.diagnostics.maxMessages.label")}
						</span>
						<div className="flex items-center gap-2">
							<Slider
								min={1}
								max={DIAGNOSTICS_SLIDER_UNLIMITED}
								step={1}
								value={[diagnosticsSliderValue]}
								onValueChange={([value]) => {
									setMaxDiagnosticMessages(value === DIAGNOSTICS_SLIDER_UNLIMITED ? -1 : value)
								}}
								data-testid="max-diagnostic-messages-slider"
								aria-label={t("settings:contextManagement.diagnostics.maxMessages.label")}
								aria-valuemin={1}
								aria-valuemax={DIAGNOSTICS_SLIDER_UNLIMITED}
								aria-valuenow={diagnosticsSliderValue}
								aria-valuetext={
									diagnosticsUnlimited
										? unlimitedLabel
										: `${diagnosticsSliderValue} ${t("settings:contextManagement.diagnostics.maxMessages.label")}`
								}
							/>
							<span className="w-20 text-sm font-medium">
								{diagnosticsUnlimited ? unlimitedLabel : diagnosticsSliderValue}
							</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setMaxDiagnosticMessages(50)}
								title={t("settings:contextManagement.diagnostics.maxMessages.resetTooltip")}
								className="p-1 h-[22px] w-[22px]"
								disabled={maxDiagnosticMessages === 50}>
								<span className="codicon codicon-discard" aria-hidden="true" />
							</Button>
						</div>
						<div className={settingDescription}>
							{t("settings:contextManagement.diagnostics.maxMessages.description")}
						</div>
					</SearchableSetting>

					<SliderRow
						section="contextManagement"
						settingId="context-write-delay"
						label={t("settings:contextManagement.diagnostics.delayAfterWrite.label")}
						description={t("settings:contextManagement.diagnostics.delayAfterWrite.description")}
						min={0}
						max={5000}
						step={100}
						value={writeDelayMs}
						onChange={setWriteDelayMs}
						testId="write-delay-slider"
						valueText={`${writeDelayMs}ms`}
					/>
					<CheckboxRow
						section="contextManagement"
						settingId="context-include-current-time"
						label={t("settings:contextManagement.includeCurrentTime.label")}
						description={t("settings:contextManagement.includeCurrentTime.description")}
						checked={includeCurrentTime}
						onChange={setIncludeCurrentTime}
						testId="include-current-time-checkbox"
					/>
					<CheckboxRow
						section="contextManagement"
						settingId="context-include-current-cost"
						label={t("settings:contextManagement.includeCurrentCost.label")}
						description={t("settings:contextManagement.includeCurrentCost.description")}
						checked={includeCurrentCost}
						onChange={setIncludeCurrentCost}
						testId="include-current-cost-checkbox"
					/>
				</SettingsCard>
			</Section>
			<Section className="pt-0">
				<SettingsCard>
					{/* Context Condensing Prompt Editor */}
					<SearchableSetting
						settingId="context-condense-prompt"
						section="contextManagement"
						label={t("prompts:supportPrompts.types.CONDENSE.label")}>
						<div className="flex justify-between items-center mb-1">
							<label className="block font-medium">
								{t("prompts:supportPrompts.types.CONDENSE.label")}
							</label>
							<StandardTooltip
								content={t("prompts:supportPrompts.resetPrompt", { promptType: "CONDENSE" })}>
								<Button
									aria-label={t("prompts:supportPrompts.resetPrompt", { promptType: "CONDENSE" })}
									variant="ghost"
									size="icon"
									onClick={handleCondenseReset}>
									<span className="codicon codicon-discard"></span>
								</Button>
							</StandardTooltip>
						</div>
						<div className={cn(settingDescription, "mt-0 mb-2")}>
							{t("prompts:supportPrompts.types.CONDENSE.description")}
						</div>
						<Textarea
							value={supportPrompt.get(customSupportPrompts, "CONDENSE")}
							onChange={(e) => setCondensePrompt(e.target.value)}
							rows={6}
							className="w-full resize-y"
							data-testid="condense-prompt-textarea"
						/>
					</SearchableSetting>

					<CheckboxRow
						section="contextManagement"
						settingId="context-auto-condense"
						label={t("settings:contextManagement.autoCondenseContext.name")}
						checked={autoCondenseContext}
						onChange={setAutoCondenseContext}
						testId="auto-condense-context-checkbox"
					/>
					{autoCondenseContext && (
						<SettingsNested>
							<div className="flex items-center gap-2 font-medium">
								<FoldVertical size={16} />
								<div>{t("settings:contextManagement.condensingThreshold.label")}</div>
							</div>
							<div>
								<Select
									value={selectedThresholdProfile || "default"}
									onValueChange={(value) => {
										setSelectedThresholdProfile(value)
									}}
									data-testid="threshold-profile-select">
									<SelectTrigger className="w-full">
										<SelectValue
											placeholder={t(
												"settings:contextManagement.condensingThreshold.selectProfile",
											)}
										/>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="default">
											{t("settings:contextManagement.condensingThreshold.defaultProfile")}
										</SelectItem>
										{listApiConfigMeta.map((config) => {
											const profileThreshold = profileThresholds[config.id]
											const thresholdDisplay =
												profileThreshold !== undefined
													? profileThreshold === -1
														? ` ${t(
																"settings:contextManagement.condensingThreshold.usesGlobal",
																{
																	threshold: autoCondenseContextPercent,
																},
															)}`
														: ` (${profileThreshold}%)`
													: ""
											return (
												<SelectItem key={config.id} value={config.id}>
													{config.name}
													{thresholdDisplay}
												</SelectItem>
											)
										})}
									</SelectContent>
								</Select>
							</div>

							{/* Threshold Slider */}
							<div>
								<div className="flex items-center gap-2">
									<Slider
										min={10}
										max={100}
										step={1}
										value={[getCurrentThresholdValue()]}
										onValueChange={([value]) => handleThresholdChange(value)}
										data-testid="condense-threshold-slider"
									/>
									<span className="w-20">{getCurrentThresholdValue()}%</span>
								</div>
								<div className={settingDescription}>
									{selectedThresholdProfile === "default"
										? t("settings:contextManagement.condensingThreshold.defaultDescription", {
												threshold: autoCondenseContextPercent,
											})
										: t("settings:contextManagement.condensingThreshold.profileDescription")}
								</div>
							</div>

							{/* Compaction API profile (background model with fallback) */}
							<SearchableSetting
								settingId="context-condense-profile"
								section="contextManagement"
								label={t("settings:contextManagement.condenseProfile.label")}>
								<label className="block font-medium mb-1">
									{t("settings:contextManagement.condenseProfile.label")}
								</label>
								<Select
									value={autoCondenseContextApiConfigId || UNSET_PROFILE}
									onValueChange={(value) => {
										// "" (not undefined) so Save clears the host's value.
										setAutoCondenseContextApiConfigId(value === UNSET_PROFILE ? "" : value)
									}}
									data-testid="condense-profile-select">
									<SelectTrigger className="w-full">
										<SelectValue
											placeholder={t("settings:contextManagement.condenseProfile.useCurrent")}
										/>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={UNSET_PROFILE}>
											{t("settings:contextManagement.condenseProfile.useCurrent")}
										</SelectItem>
										{listApiConfigMeta.map((config) => (
											<SelectItem key={config.id} value={config.id}>
												{config.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<div className={settingDescription}>
									{t("settings:contextManagement.condenseProfile.description")}
								</div>
							</SearchableSetting>
						</SettingsNested>
					)}

					<CheckboxRow
						section="contextManagement"
						settingId="context-prune-before-condense"
						label={t("settings:contextManagement.pruneBeforeCondense.label")}
						description={t("settings:contextManagement.pruneBeforeCondense.description")}
						checked={pruneBeforeCondense !== false}
						onChange={setPruneBeforeCondense}
						testId="prune-before-condense-checkbox"
					/>

					{pruneBeforeCondense !== false && (
						<SettingsNested>
							<NumberRow
								section="contextManagement"
								settingId="context-prune-tool-result-budget"
								label={t("settings:contextManagement.pruneToolResultBudget.label")}
								description={t("settings:contextManagement.pruneToolResultBudget.description")}
								unit={t("settings:contextManagement.pruneToolResultBudget.bytes")}
								min={PRUNE_CONDENSE_DEFAULTS.MIN_TOOL_RESULT_BUDGET}
								max={PRUNE_CONDENSE_DEFAULTS.MAX_TOOL_RESULT_BUDGET}
								value={pruneToolResultBudget ?? PRUNE_CONDENSE_DEFAULTS.DEFAULT_TOOL_RESULT_BUDGET}
								onChange={setPruneToolResultBudget}
								testId="prune-tool-result-budget-input"
								inputWidth="w-28"
							/>
						</SettingsNested>
					)}
				</SettingsCard>
			</Section>
		</div>
	)
}
