import { HTMLAttributes, useState } from "react"
import { X } from "lucide-react"
import { Trans } from "react-i18next"
import { Package } from "@roo/package"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { Button, Input, Slider, LabeledCheckbox } from "@/components/ui"

import { useSetting, useSettingsDraft } from "./SettingsDraftContext"
import { postImmediateSetting } from "./postImmediateSetting"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { AutoApproveToggle } from "./AutoApproveToggle"
import { AutoApproveModeSelector } from "./AutoApproveModeSelector"
import { MaxLimitInputs } from "./MaxLimitInputs"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAutoApprovalState } from "@/hooks/useAutoApprovalState"
import { useAutoApprovalToggles } from "@/hooks/useAutoApprovalToggles"

type AutoApproveSettingsProps = HTMLAttributes<HTMLDivElement>

export const AutoApproveSettings = (props: AutoApproveSettingsProps) => {
	const { t } = useAppTranslation()
	const [alwaysAllowReadOnly] = useSetting("alwaysAllowReadOnly")
	const [alwaysAllowReadOnlyOutsideWorkspace, setAlwaysAllowReadOnlyOutsideWorkspace] = useSetting(
		"alwaysAllowReadOnlyOutsideWorkspace",
	)
	const [alwaysAllowWrite] = useSetting("alwaysAllowWrite")
	const [alwaysAllowWriteOutsideWorkspace, setAlwaysAllowWriteOutsideWorkspace] = useSetting(
		"alwaysAllowWriteOutsideWorkspace",
	)
	const [alwaysAllowWriteProtected, setAlwaysAllowWriteProtected] = useSetting("alwaysAllowWriteProtected")
	const [alwaysAllowMcp] = useSetting("alwaysAllowMcp")
	const [alwaysAllowModeSwitch] = useSetting("alwaysAllowModeSwitch")
	const [alwaysAllowSubtasks] = useSetting("alwaysAllowSubtasks")
	const [alwaysApprovePlan] = useSetting("alwaysApprovePlan")
	const [alwaysAllowExecute] = useSetting("alwaysAllowExecute")
	const [alwaysAllowFollowupQuestions] = useSetting("alwaysAllowFollowupQuestions")
	const [followupAutoApproveTimeoutMs = 60000, setFollowupAutoApproveTimeoutMs] =
		useSetting("followupAutoApproveTimeoutMs")
	const [allowedCommands, setAllowedCommands] = useSetting("allowedCommands")
	const [allowedMaxRequestsSetting, setAllowedMaxRequests] = useSetting("allowedMaxRequests")
	const [allowedMaxCostSetting, setAllowedMaxCost] = useSetting("allowedMaxCost")
	const allowedMaxRequests = allowedMaxRequestsSetting ?? undefined
	const allowedMaxCost = allowedMaxCostSetting ?? undefined
	const draft = useSettingsDraft()
	const [deniedCommands, setDeniedCommands] = useSetting("deniedCommands")
	const [commandInput, setCommandInput] = useState("")
	const [deniedCommandInput, setDeniedCommandInput] = useState("")
	const {
		autoApprovalEnabled,
		setAutoApprovalEnabled,
		autoApprovalMode = "default",
		setAutoApprovalMode,
	} = useExtensionState()

	const handleModeChange = (mode: typeof autoApprovalMode) => {
		setAutoApprovalMode(mode)
		postImmediateSetting("autoApprovalMode", mode)

		if (mode !== "default" && !autoApprovalEnabled) {
			setAutoApprovalEnabled(true)
			vscode.postMessage({ type: "autoApprovalEnabled", bool: true })
		}
	}

	const toggles = useAutoApprovalToggles()

	const { effectiveAutoApprovalEnabled } = useAutoApprovalState(toggles, autoApprovalEnabled)

	const handleAddCommand = () => {
		const currentCommands = allowedCommands ?? []

		if (commandInput && !currentCommands.includes(commandInput)) {
			const newCommands = [...currentCommands, commandInput]
			setAllowedCommands(newCommands)
			setCommandInput("")
			postImmediateSetting("allowedCommands", newCommands)
		}
	}

	const handleAddDeniedCommand = () => {
		const currentCommands = deniedCommands ?? []

		if (deniedCommandInput && !currentCommands.includes(deniedCommandInput)) {
			const newCommands = [...currentCommands, deniedCommandInput]
			setDeniedCommands(newCommands)
			setDeniedCommandInput("")
			postImmediateSetting("deniedCommands", newCommands)
		}
	}

	return (
		<div {...props}>
			<SectionHeader>{t("settings:sections.autoApprove")}</SectionHeader>

			<Section>
				<div className="space-y-4">
					<SearchableSetting
						settingId="auto-approve-enabled"
						section="autoApprove"
						label={t("settings:autoApprove.enabled")}>
						<LabeledCheckbox
							checked={effectiveAutoApprovalEnabled}
							aria-label={t("settings:autoApprove.toggleAriaLabel")}
							onChange={() => {
								const newValue = !(autoApprovalEnabled ?? false)
								setAutoApprovalEnabled(newValue)
								vscode.postMessage({ type: "autoApprovalEnabled", bool: newValue })
							}}>
							<span className="font-medium">{t("settings:autoApprove.enabled")}</span>
						</LabeledCheckbox>
						<div className="text-vscode-descriptionForeground text-sm mt-1">
							<p>{t("settings:autoApprove.description")}</p>
							<p>
								<Trans
									i18nKey="settings:autoApprove.toggleShortcut"
									components={{
										SettingsLink: (
											<a
												href="#"
												className="text-vscode-textLink-foreground hover:underline cursor-pointer"
												onClick={(e) => {
													e.preventDefault()
													// Send message to open keyboard shortcuts with search for toggle command
													vscode.postMessage({
														type: "openKeyboardShortcuts",
														text: `${Package.name}.toggleAutoApprove`,
													})
												}}
											/>
										),
									}}
								/>
							</p>
						</div>
					</SearchableSetting>

					<AutoApproveModeSelector mode={autoApprovalMode} onChange={handleModeChange} />

					<AutoApproveToggle
						alwaysAllowReadOnly={alwaysAllowReadOnly}
						alwaysAllowWrite={alwaysAllowWrite}
						alwaysAllowMcp={alwaysAllowMcp}
						alwaysAllowModeSwitch={alwaysAllowModeSwitch}
						alwaysAllowSubtasks={alwaysAllowSubtasks}
						alwaysApprovePlan={alwaysApprovePlan}
						alwaysAllowExecute={alwaysAllowExecute}
						alwaysAllowFollowupQuestions={alwaysAllowFollowupQuestions}
						mode={autoApprovalMode}
						onToggle={(key, value) => draft.setField(key, value)}
					/>

					<MaxLimitInputs
						allowedMaxRequests={allowedMaxRequests}
						allowedMaxCost={allowedMaxCost}
						onMaxRequestsChange={(value) => setAllowedMaxRequests(value)}
						onMaxCostChange={(value) => setAllowedMaxCost(value)}
					/>
				</div>

				{/* ADDITIONAL SETTINGS */}

				{alwaysAllowReadOnly && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-eye" aria-hidden="true" />
							<div>{t("settings:autoApprove.readOnly.label")}</div>
						</div>
						<SearchableSetting
							settingId="auto-approve-readonly-outside-workspace"
							section="autoApprove"
							label={t("settings:autoApprove.readOnly.outsideWorkspace.label")}>
							<LabeledCheckbox
								checked={alwaysAllowReadOnlyOutsideWorkspace}
								onChange={(e: any) => setAlwaysAllowReadOnlyOutsideWorkspace(e.target.checked)}
								data-testid="always-allow-readonly-outside-workspace-checkbox">
								<span className="font-medium">
									{t("settings:autoApprove.readOnly.outsideWorkspace.label")}
								</span>
							</LabeledCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.readOnly.outsideWorkspace.description")}
							</div>
						</SearchableSetting>
					</div>
				)}

				{alwaysAllowWrite && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-edit" aria-hidden="true" />
							<div>{t("settings:autoApprove.write.label")}</div>
						</div>
						<SearchableSetting
							settingId="auto-approve-write-outside-workspace"
							section="autoApprove"
							label={t("settings:autoApprove.write.outsideWorkspace.label")}>
							<LabeledCheckbox
								checked={alwaysAllowWriteOutsideWorkspace}
								onChange={(e: any) => setAlwaysAllowWriteOutsideWorkspace(e.target.checked)}
								data-testid="always-allow-write-outside-workspace-checkbox">
								<span className="font-medium">
									{t("settings:autoApprove.write.outsideWorkspace.label")}
								</span>
							</LabeledCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.write.outsideWorkspace.description")}
							</div>
						</SearchableSetting>
						<SearchableSetting
							settingId="auto-approve-write-protected"
							section="autoApprove"
							label={t("settings:autoApprove.write.protected.label")}>
							<LabeledCheckbox
								checked={alwaysAllowWriteProtected}
								onChange={(e: any) => setAlwaysAllowWriteProtected(e.target.checked)}
								data-testid="always-allow-write-protected-checkbox">
								<span className="font-medium">{t("settings:autoApprove.write.protected.label")}</span>
							</LabeledCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1 mb-3">
								{t("settings:autoApprove.write.protected.description")}
							</div>
						</SearchableSetting>
					</div>
				)}

				{alwaysAllowFollowupQuestions && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-question" aria-hidden="true" />
							<div>{t("settings:autoApprove.followupQuestions.label")}</div>
						</div>
						<SearchableSetting
							settingId="auto-approve-followup-timeout"
							section="autoApprove"
							label={t("settings:autoApprove.followupQuestions.timeoutLabel")}>
							<div className="flex items-center gap-2">
								<Slider
									min={1000}
									max={300000}
									step={1000}
									value={[followupAutoApproveTimeoutMs]}
									onValueChange={([value]) => setFollowupAutoApproveTimeoutMs(value)}
									data-testid="followup-timeout-slider"
								/>
								<span className="w-20">{followupAutoApproveTimeoutMs / 1000}s</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.followupQuestions.timeoutLabel")}
							</div>
						</SearchableSetting>
					</div>
				)}

				{alwaysAllowExecute && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div className="flex items-center gap-4 font-bold">
							<span className="codicon codicon-terminal" aria-hidden="true" />
							<div>{t("settings:autoApprove.execute.label")}</div>
						</div>

						<SearchableSetting
							settingId="auto-approve-allowed-commands"
							section="autoApprove"
							label={t("settings:autoApprove.execute.allowedCommands")}>
							<label className="block font-medium mb-1" data-testid="allowed-commands-heading">
								{t("settings:autoApprove.execute.allowedCommands")}
							</label>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.execute.allowedCommandsDescription")}
							</div>
						</SearchableSetting>

						<div className="flex gap-2">
							<Input
								value={commandInput}
								onChange={(e: any) => setCommandInput(e.target.value)}
								onKeyDown={(e: any) => {
									if (e.key === "Enter") {
										e.preventDefault()
										handleAddCommand()
									}
								}}
								placeholder={t("settings:autoApprove.execute.commandPlaceholder")}
								className="grow"
								data-testid="command-input"
							/>
							<Button className="h-8" onClick={handleAddCommand} data-testid="add-command-button">
								{t("settings:autoApprove.execute.addButton")}
							</Button>
						</div>

						<div className="flex flex-wrap gap-2">
							{(allowedCommands ?? []).map((cmd, index) => (
								<Button
									key={index}
									variant="secondary"
									data-testid={`remove-command-${index}`}
									onClick={() => {
										const newCommands = (allowedCommands ?? []).filter((_, i) => i !== index)
										setAllowedCommands(newCommands)
										postImmediateSetting("allowedCommands", newCommands)
									}}>
									<div className="flex flex-row items-center gap-1">
										<div>{cmd}</div>
										<X className="text-foreground scale-75" />
									</div>
								</Button>
							))}
						</div>

						{/* Denied Commands Section */}
						<SearchableSetting
							settingId="auto-approve-denied-commands"
							section="autoApprove"
							label={t("settings:autoApprove.execute.deniedCommands")}
							className="mt-6">
							<label className="block font-medium mb-1" data-testid="denied-commands-heading">
								{t("settings:autoApprove.execute.deniedCommands")}
							</label>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:autoApprove.execute.deniedCommandsDescription")}
							</div>
						</SearchableSetting>

						<div className="flex gap-2">
							<Input
								value={deniedCommandInput}
								onChange={(e: any) => setDeniedCommandInput(e.target.value)}
								onKeyDown={(e: any) => {
									if (e.key === "Enter") {
										e.preventDefault()
										handleAddDeniedCommand()
									}
								}}
								placeholder={t("settings:autoApprove.execute.deniedCommandPlaceholder")}
								className="grow"
								data-testid="denied-command-input"
							/>
							<Button
								className="h-8"
								onClick={handleAddDeniedCommand}
								data-testid="add-denied-command-button">
								{t("settings:autoApprove.execute.addButton")}
							</Button>
						</div>

						<div className="flex flex-wrap gap-2">
							{(deniedCommands ?? []).map((cmd, index) => (
								<Button
									key={index}
									variant="secondary"
									data-testid={`remove-denied-command-${index}`}
									onClick={() => {
										const newCommands = (deniedCommands ?? []).filter((_, i) => i !== index)
										setDeniedCommands(newCommands)
										postImmediateSetting("deniedCommands", newCommands)
									}}>
									<div className="flex flex-row items-center gap-1">
										<div>{cmd}</div>
										<X className="text-foreground scale-75" />
									</div>
								</Button>
							))}
						</div>
					</div>
				)}
			</Section>
		</div>
	)
}
