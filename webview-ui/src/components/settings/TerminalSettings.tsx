import { HTMLAttributes, useState, useCallback, useEffect, useId } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { useMount } from "react-use"

import {
	type ExtensionMessage,
	type TerminalOutputPreviewSize,
	DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS,
	SETTINGS_DEFAULTS,
} from "@tumble-code/types"

import { cn } from "@/lib/utils"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Slider,
	LabeledCheckbox,
	Button,
} from "@/components/ui"

import { useSetting } from "./SettingsDraftContext"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { SettingsCard, checkboxDescription, settingDescription } from "./SettingsCard"
import { useExtensionMessage } from "@src/utils/extensionBus"

type TerminalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	onTerminalProfilePickerOpened?: () => void
}

// Sentinel value that maps to `undefined` (use VS Code's default shell).
// The Select component cannot accept empty-string item values.
const DEFAULT_PROFILE_VALUE = "__default__"

export const TerminalSettings = ({ onTerminalProfilePickerOpened, className, ...props }: TerminalSettingsProps) => {
	const { t } = useAppTranslation()
	const [terminalOutputPreviewSize, setTerminalOutputPreviewSize] = useSetting("terminalOutputPreviewSize")
	const [terminalShellIntegrationTimeout, setTerminalShellIntegrationTimeout] = useSetting(
		"terminalShellIntegrationTimeout",
	)
	const [terminalShellIntegrationDisabled, setTerminalShellIntegrationDisabled] = useSetting(
		"terminalShellIntegrationDisabled",
	)
	const [terminalCommandDelay, setTerminalCommandDelay] = useSetting("terminalCommandDelay")
	const [terminalPowershellCounter, setTerminalPowershellCounter] = useSetting("terminalPowershellCounter")
	const [terminalZshClearEolMark, setTerminalZshClearEolMark] = useSetting("terminalZshClearEolMark")
	const [terminalZshOhMy, setTerminalZshOhMy] = useSetting("terminalZshOhMy")
	const [terminalZshP10k, setTerminalZshP10k] = useSetting("terminalZshP10k")
	const [terminalZdotdir, setTerminalZdotdir] = useSetting("terminalZdotdir")
	const [terminalProfile, setTerminalProfile] = useSetting("terminalProfile")

	const [inheritEnv, setInheritEnv] = useState<boolean>(true)
	const [profileNames, setProfileNames] = useState<string[]>([])
	const [isProfilesLoaded, setIsProfilesLoaded] = useState(false)
	const profileModeId = useId()
	const defaultProfileId = `${profileModeId}-default`
	const overrideProfileId = `${profileModeId}-override`
	const isProfileOverrideSelected = !!terminalProfile && (!isProfilesLoaded || profileNames.includes(terminalProfile))
	const isVSCodeTerminalEnabled = terminalShellIntegrationDisabled === false

	useMount(() => {
		vscode.postMessage({ type: "getVSCodeSetting", setting: "terminal.integrated.inheritEnv" })
		// Request the terminal profile names through a dedicated, allowlisted message
		// (the extension reads the profiles and returns only sanitized names).
		vscode.postMessage({ type: "requestTerminalProfiles" })
	})

	const onMessage = useCallback((message: ExtensionMessage) => {
		switch (message.type) {
			case "vsCodeSetting":
				if (message.setting === "terminal.integrated.inheritEnv") {
					setInheritEnv(message.value ?? true)
				}
				break
			case "terminalProfiles":
				setProfileNames(message.profiles ?? [])
				setIsProfilesLoaded(true)
				break
			default:
				break
		}
	}, [])

	useExtensionMessage(["vsCodeSetting", "terminalProfiles"], onMessage)

	useEffect(() => {
		if (isProfilesLoaded && terminalProfile && !profileNames.includes(terminalProfile)) {
			setTerminalProfile(undefined)
		}
	}, [isProfilesLoaded, profileNames, setTerminalProfile, terminalProfile])

	return (
		<div className={cn("flex flex-col", className)} {...props}>
			<SectionHeader>{t("settings:sections.terminal")}</SectionHeader>

			<Section>
				{/* Basic Settings */}
				<SettingsCard title={t("settings:terminal.basic.label")}>
						<SearchableSetting
							settingId="terminal-output-preview-size"
							section="terminal"
							label={t("settings:terminal.outputPreviewSize.label")}>
							<label className="block font-medium mb-1">
								{t("settings:terminal.outputPreviewSize.label")}
							</label>
							<Select
								value={terminalOutputPreviewSize || "medium"}
								onValueChange={(value) =>
									setTerminalOutputPreviewSize(value as TerminalOutputPreviewSize)
								}>
								<SelectTrigger className="w-full" data-testid="terminal-output-preview-size-dropdown">
									<SelectValue placeholder={t("settings:common.select")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="small">
										{t("settings:terminal.outputPreviewSize.options.small")}
									</SelectItem>
									<SelectItem value="medium">
										{t("settings:terminal.outputPreviewSize.options.medium")}
									</SelectItem>
									<SelectItem value="large">
										{t("settings:terminal.outputPreviewSize.options.large")}
									</SelectItem>
								</SelectContent>
							</Select>
							<div className={settingDescription}>
								{t("settings:terminal.outputPreviewSize.description")}
							</div>
						</SearchableSetting>
				</SettingsCard>

				{/* Advanced Settings */}
				<SettingsCard
					title={t("settings:terminal.advanced.label")}
					description={t("settings:terminal.advanced.description")}>
						{/* Profile override: only applies when VS Code integrated terminal is active
						    (shell integration enabled). Hidden in Execa/inline mode since getProfileShell()
						    is not wired there. */}
						{isVSCodeTerminalEnabled && (
							<SearchableSetting
								settingId="terminal-profile"
								section="terminal"
								label={t("settings:terminal.profile.label")}>
								<label className="block font-medium mb-1">{t("settings:terminal.profile.label")}</label>

								{/* Level 1: Default (recommended) */}
								<div className="flex items-center gap-2 mb-2">
									<input
										type="radio"
										id={defaultProfileId}
										name={profileModeId}
										checked={!isProfileOverrideSelected}
										onChange={() => setTerminalProfile(undefined)}
										data-testid="terminal-profile-default-radio"
									/>
									<label htmlFor={defaultProfileId} className="cursor-pointer">
										{t("settings:terminal.profile.default")}
									</label>
									<Button
										variant="secondary"
										onClick={() => {
											onTerminalProfilePickerOpened?.()
											vscode.postMessage({ type: "openTerminalProfilePicker" })
										}}
										data-testid="terminal-profile-configure-button">
										{t("settings:terminal.profile.configureButton")}
									</Button>
								</div>

								{/* Level 2: Override */}
								<div className="flex items-center gap-2 mb-2">
									<input
										type="radio"
										id={overrideProfileId}
										name={profileModeId}
										checked={isProfileOverrideSelected}
										disabled={profileNames.length === 0}
										onChange={() => {
											if (!terminalProfile && profileNames.length > 0) {
												setTerminalProfile(profileNames[0])
											}
										}}
										data-testid="terminal-profile-override-radio"
									/>
									<label
										htmlFor={overrideProfileId}
										className={
											profileNames.length === 0
												? "cursor-not-allowed text-vscode-disabledForeground"
												: "cursor-pointer"
										}>
										{t("settings:terminal.profile.overrideLabel")}
									</label>
									{profileNames.length === 0 && (
										<span
											className="text-vscode-descriptionForeground text-xs"
											data-testid="terminal-profile-no-profiles-hint">
											{t("settings:terminal.profile.noProfiles")}
										</span>
									)}
								</div>

								{isProfileOverrideSelected && profileNames.length > 0 && (
									<Select
										value={terminalProfile || DEFAULT_PROFILE_VALUE}
										data-testid="terminal-profile-dropdown"
										onValueChange={(value) =>
											setTerminalProfile(value === DEFAULT_PROFILE_VALUE ? undefined : value)
										}>
										<SelectTrigger className="w-[calc(100%-1.5rem)] ml-6">
											<SelectValue placeholder={t("settings:common.select")} />
										</SelectTrigger>
										<SelectContent>
											{profileNames.map((name) => (
												<SelectItem key={name} value={name}>
													{name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}

								<div className={settingDescription}>
									{t("settings:terminal.profile.description")}
								</div>
							</SearchableSetting>
						)}

						<SearchableSetting
							settingId="terminal-shell-integration-disabled"
							section="terminal"
							label={t("settings:terminal.shellIntegrationDisabled.label")}>
							<LabeledCheckbox
								checked={
									terminalShellIntegrationDisabled ??
									SETTINGS_DEFAULTS.terminalShellIntegrationDisabled
								}
								onChange={(e: any) => setTerminalShellIntegrationDisabled(e.target.checked)}>
								<span className="font-medium">
									{t("settings:terminal.shellIntegrationDisabled.label")}
								</span>
							</LabeledCheckbox>
							<div className={checkboxDescription}>
								{t("settings:terminal.shellIntegrationDisabled.description")}
							</div>
						</SearchableSetting>

						{isVSCodeTerminalEnabled && (
							<>
								<SearchableSetting
									settingId="terminal-inherit-env"
									section="terminal"
									label={t("settings:terminal.inheritEnv.label")}>
									<LabeledCheckbox
										checked={inheritEnv}
										onChange={(e: any) => {
											setInheritEnv(e.target.checked)
											vscode.postMessage({
												type: "updateVSCodeSetting",
												setting: "terminal.integrated.inheritEnv",
												value: e.target.checked,
											})
										}}
										data-testid="terminal-inherit-env-checkbox">
										<span className="font-medium">{t("settings:terminal.inheritEnv.label")}</span>
									</LabeledCheckbox>
									<div className={checkboxDescription}>
										{t("settings:terminal.inheritEnv.description")}
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-shell-integration-timeout"
									section="terminal"
									label={t("settings:terminal.shellIntegrationTimeout.label")}>
									<label className="block font-medium mb-1">
										{t("settings:terminal.shellIntegrationTimeout.label")}
									</label>
									<div className="flex items-center gap-2">
										<Slider
											min={1000}
											max={60000}
											step={1000}
											value={[
												terminalShellIntegrationTimeout ??
													DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS,
											]}
											onValueChange={([value]) =>
												setTerminalShellIntegrationTimeout(
													Math.min(60000, Math.max(1000, value)),
												)
											}
										/>
										<span className="w-10">
											{(terminalShellIntegrationTimeout ??
												DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS) / 1000}
											s
										</span>
									</div>
									<div className={settingDescription}>
										{t("settings:terminal.shellIntegrationTimeout.description")}
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-command-delay"
									section="terminal"
									label={t("settings:terminal.commandDelay.label")}>
									<label className="block font-medium mb-1">
										{t("settings:terminal.commandDelay.label")}
									</label>
									<div className="flex items-center gap-2">
										<Slider
											min={0}
											max={1000}
											step={10}
											value={[terminalCommandDelay ?? SETTINGS_DEFAULTS.terminalCommandDelay]}
											onValueChange={([value]) =>
												setTerminalCommandDelay(Math.min(1000, Math.max(0, value)))
											}
										/>
										<span className="w-10">
											{terminalCommandDelay ?? SETTINGS_DEFAULTS.terminalCommandDelay}ms
										</span>
									</div>
									<div className={settingDescription}>
										{t("settings:terminal.commandDelay.description")}
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-powershell-counter"
									section="terminal"
									label={t("settings:terminal.powershellCounter.label")}>
									<LabeledCheckbox
										checked={
											terminalPowershellCounter ?? SETTINGS_DEFAULTS.terminalPowershellCounter
										}
										onChange={(e: any) => setTerminalPowershellCounter(e.target.checked)}
										data-testid="terminal-powershell-counter-checkbox">
										<span className="font-medium">
											{t("settings:terminal.powershellCounter.label")}
										</span>
									</LabeledCheckbox>
									<div className={checkboxDescription}>
										{t("settings:terminal.powershellCounter.description")}
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-zsh-clear-eol-mark"
									section="terminal"
									label={t("settings:terminal.zshClearEolMark.label")}>
									<LabeledCheckbox
										checked={terminalZshClearEolMark ?? SETTINGS_DEFAULTS.terminalZshClearEolMark}
										onChange={(e: any) => setTerminalZshClearEolMark(e.target.checked)}
										data-testid="terminal-zsh-clear-eol-mark-checkbox">
										<span className="font-medium">
											{t("settings:terminal.zshClearEolMark.label")}
										</span>
									</LabeledCheckbox>
									<div className={checkboxDescription}>
										{t("settings:terminal.zshClearEolMark.description")}
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-zsh-oh-my"
									section="terminal"
									label={t("settings:terminal.zshOhMy.label")}>
									<LabeledCheckbox
										checked={terminalZshOhMy ?? SETTINGS_DEFAULTS.terminalZshOhMy}
										onChange={(e: any) => setTerminalZshOhMy(e.target.checked)}
										data-testid="terminal-zsh-oh-my-checkbox">
										<span className="font-medium">{t("settings:terminal.zshOhMy.label")}</span>
									</LabeledCheckbox>
									<div className={checkboxDescription}>
										{t("settings:terminal.zshOhMy.description")}
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-zsh-p10k"
									section="terminal"
									label={t("settings:terminal.zshP10k.label")}>
									<LabeledCheckbox
										checked={terminalZshP10k ?? SETTINGS_DEFAULTS.terminalZshP10k}
										onChange={(e: any) => setTerminalZshP10k(e.target.checked)}
										data-testid="terminal-zsh-p10k-checkbox">
										<span className="font-medium">{t("settings:terminal.zshP10k.label")}</span>
									</LabeledCheckbox>
									<div className={checkboxDescription}>
										{t("settings:terminal.zshP10k.description")}
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-zdotdir"
									section="terminal"
									label={t("settings:terminal.zdotdir.label")}>
									<LabeledCheckbox
										checked={terminalZdotdir ?? SETTINGS_DEFAULTS.terminalZdotdir}
										onChange={(e: any) => setTerminalZdotdir(e.target.checked)}
										data-testid="terminal-zdotdir-checkbox">
										<span className="font-medium">{t("settings:terminal.zdotdir.label")}</span>
									</LabeledCheckbox>
									<div className={checkboxDescription}>
										{t("settings:terminal.zdotdir.description")}
									</div>
								</SearchableSetting>
							</>
						)}
				</SettingsCard>
			</Section>
		</div>
	)
}
