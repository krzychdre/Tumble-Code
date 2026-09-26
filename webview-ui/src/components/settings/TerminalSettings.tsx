import { HTMLAttributes, useState, useCallback, useEffect, useId } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { Trans } from "react-i18next"
import { buildDocLink } from "@src/utils/docLinks"
import { useMount } from "react-use"

import {
	type ExtensionMessage,
	type TerminalOutputPreviewSize,
	DEFAULT_TERMINAL_SHELL_INTEGRATION_TIMEOUT_MS,
} from "@roo-code/types"

import { cn } from "@/lib/utils"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Slider,
	Link,
	LabeledCheckbox,
} from "@/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"
import { SearchableSetting } from "./SearchableSetting"
import { useExtensionMessage } from "@src/utils/extensionBus"

type TerminalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	terminalOutputPreviewSize?: TerminalOutputPreviewSize
	terminalShellIntegrationTimeout?: number
	terminalShellIntegrationDisabled?: boolean
	terminalCommandDelay?: number
	terminalPowershellCounter?: boolean
	terminalZshClearEolMark?: boolean
	terminalZshOhMy?: boolean
	terminalZshP10k?: boolean
	terminalZdotdir?: boolean
	terminalProfile?: string
	onTerminalProfilePickerOpened?: () => void
	setCachedStateField: SetCachedStateField<
		| "terminalOutputPreviewSize"
		| "terminalShellIntegrationTimeout"
		| "terminalShellIntegrationDisabled"
		| "terminalCommandDelay"
		| "terminalPowershellCounter"
		| "terminalZshClearEolMark"
		| "terminalZshOhMy"
		| "terminalZshP10k"
		| "terminalZdotdir"
		| "terminalProfile"
	>
}

// Sentinel value that maps to `undefined` (use VS Code's default shell).
// The Select component cannot accept empty-string item values.
const DEFAULT_PROFILE_VALUE = "__default__"

export const TerminalSettings = ({
	terminalOutputPreviewSize,
	terminalShellIntegrationTimeout,
	terminalShellIntegrationDisabled,
	terminalCommandDelay,
	terminalPowershellCounter,
	terminalZshClearEolMark,
	terminalZshOhMy,
	terminalZshP10k,
	terminalZdotdir,
	terminalProfile,
	onTerminalProfilePickerOpened,
	setCachedStateField,
	className,
	...props
}: TerminalSettingsProps) => {
	const { t } = useAppTranslation()

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
			setCachedStateField("terminalProfile", undefined)
		}
	}, [isProfilesLoaded, profileNames, setCachedStateField, terminalProfile])

	return (
		<div className={cn("flex flex-col", className)} {...props}>
			<SectionHeader>{t("settings:sections.terminal")}</SectionHeader>

			<Section>
				{/* Basic Settings */}
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 font-bold">
							<span className="codicon codicon-settings-gear" />
							<div>{t("settings:terminal.basic.label")}</div>
						</div>
					</div>
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
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
									setCachedStateField("terminalOutputPreviewSize", value as TerminalOutputPreviewSize)
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
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:terminal.outputPreviewSize.description")}
							</div>
						</SearchableSetting>
					</div>
				</div>

				{/* Advanced Settings */}
				<div className="flex flex-col gap-3">
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-2 font-bold">
							<span className="codicon codicon-tools" />
							<div>{t("settings:terminal.advanced.label")}</div>
						</div>
						<div className="text-vscode-descriptionForeground">
							{t("settings:terminal.advanced.description")}
						</div>
					</div>
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						{/* Profile override — only applies when VS Code integrated terminal is active
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
										onChange={() => setCachedStateField("terminalProfile", undefined)}
										data-testid="terminal-profile-default-radio"
									/>
									<label htmlFor={defaultProfileId} className="cursor-pointer">
										{t("settings:terminal.profile.default")}
									</label>
									<VSCodeButton
										appearance="secondary"
										onClick={() => {
											onTerminalProfilePickerOpened?.()
											vscode.postMessage({ type: "openTerminalProfilePicker" })
										}}
										data-testid="terminal-profile-configure-button">
										{t("settings:terminal.profile.configureButton")}
									</VSCodeButton>
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
												setCachedStateField("terminalProfile", profileNames[0])
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
											setCachedStateField(
												"terminalProfile",
												value === DEFAULT_PROFILE_VALUE ? undefined : value,
											)
										}>
										<SelectTrigger className="w-full ml-6">
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

								<div className="text-vscode-descriptionForeground text-sm mt-1">
									<Trans i18nKey="settings:terminal.profile.description">
										<Link
											href={buildDocLink(
												"features/shell-integration",
												"settings_terminal_profile",
											)}
											style={{ display: "inline" }}>
											{" "}
										</Link>
									</Trans>
								</div>
							</SearchableSetting>
						)}

						<SearchableSetting
							settingId="terminal-shell-integration-disabled"
							section="terminal"
							label={t("settings:terminal.shellIntegrationDisabled.label")}>
							<LabeledCheckbox
								checked={terminalShellIntegrationDisabled ?? true}
								onChange={(e: any) =>
									setCachedStateField("terminalShellIntegrationDisabled", e.target.checked)
								}>
								<span className="font-medium">
									{t("settings:terminal.shellIntegrationDisabled.label")}
								</span>
							</LabeledCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								<Trans i18nKey="settings:terminal.shellIntegrationDisabled.description">
									<Link
										href={buildDocLink(
											"features/shell-integration#use-inline-terminal-recommended",
											"settings_terminal_shell_integration_disabled",
										)}
										style={{ display: "inline" }}>
										{" "}
									</Link>
								</Trans>
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
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										<Trans i18nKey="settings:terminal.inheritEnv.description">
											<Link
												href={buildDocLink(
													"features/shell-integration#inherit-environment-variables",
													"settings_terminal_inherit_env",
												)}
												style={{ display: "inline" }}>
												{" "}
											</Link>
										</Trans>
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
												setCachedStateField(
													"terminalShellIntegrationTimeout",
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
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										<Trans i18nKey="settings:terminal.shellIntegrationTimeout.description">
											<Link
												href={buildDocLink(
													"features/shell-integration#terminal-shell-integration-timeout",
													"settings_terminal_shell_integration_timeout",
												)}
												style={{ display: "inline" }}>
												{" "}
											</Link>
										</Trans>
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
											value={[terminalCommandDelay ?? 0]}
											onValueChange={([value]) =>
												setCachedStateField(
													"terminalCommandDelay",
													Math.min(1000, Math.max(0, value)),
												)
											}
										/>
										<span className="w-10">{terminalCommandDelay ?? 50}ms</span>
									</div>
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										<Trans i18nKey="settings:terminal.commandDelay.description">
											<Link
												href={buildDocLink(
													"features/shell-integration#terminal-command-delay",
													"settings_terminal_command_delay",
												)}
												style={{ display: "inline" }}>
												{" "}
											</Link>
										</Trans>
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-powershell-counter"
									section="terminal"
									label={t("settings:terminal.powershellCounter.label")}>
									<LabeledCheckbox
										checked={terminalPowershellCounter ?? false}
										onChange={(e: any) =>
											setCachedStateField("terminalPowershellCounter", e.target.checked)
										}
										data-testid="terminal-powershell-counter-checkbox">
										<span className="font-medium">
											{t("settings:terminal.powershellCounter.label")}
										</span>
									</LabeledCheckbox>
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										<Trans i18nKey="settings:terminal.powershellCounter.description">
											<Link
												href={buildDocLink(
													"features/shell-integration#enable-powershell-counter-workaround",
													"settings_terminal_powershell_counter",
												)}
												style={{ display: "inline" }}>
												{" "}
											</Link>
										</Trans>
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-zsh-clear-eol-mark"
									section="terminal"
									label={t("settings:terminal.zshClearEolMark.label")}>
									<LabeledCheckbox
										checked={terminalZshClearEolMark ?? true}
										onChange={(e: any) =>
											setCachedStateField("terminalZshClearEolMark", e.target.checked)
										}
										data-testid="terminal-zsh-clear-eol-mark-checkbox">
										<span className="font-medium">
											{t("settings:terminal.zshClearEolMark.label")}
										</span>
									</LabeledCheckbox>
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										<Trans i18nKey="settings:terminal.zshClearEolMark.description">
											<Link
												href={buildDocLink(
													"features/shell-integration#clear-zsh-eol-mark",
													"settings_terminal_zsh_clear_eol_mark",
												)}
												style={{ display: "inline" }}>
												{" "}
											</Link>
										</Trans>
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-zsh-oh-my"
									section="terminal"
									label={t("settings:terminal.zshOhMy.label")}>
									<LabeledCheckbox
										checked={terminalZshOhMy ?? false}
										onChange={(e: any) => setCachedStateField("terminalZshOhMy", e.target.checked)}
										data-testid="terminal-zsh-oh-my-checkbox">
										<span className="font-medium">{t("settings:terminal.zshOhMy.label")}</span>
									</LabeledCheckbox>
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										<Trans i18nKey="settings:terminal.zshOhMy.description">
											<Link
												href={buildDocLink(
													"features/shell-integration#enable-oh-my-zsh-integration",
													"settings_terminal_zsh_oh_my",
												)}
												style={{ display: "inline" }}>
												{" "}
											</Link>
										</Trans>
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-zsh-p10k"
									section="terminal"
									label={t("settings:terminal.zshP10k.label")}>
									<LabeledCheckbox
										checked={terminalZshP10k ?? false}
										onChange={(e: any) => setCachedStateField("terminalZshP10k", e.target.checked)}
										data-testid="terminal-zsh-p10k-checkbox">
										<span className="font-medium">{t("settings:terminal.zshP10k.label")}</span>
									</LabeledCheckbox>
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										<Trans i18nKey="settings:terminal.zshP10k.description">
											<Link
												href={buildDocLink(
													"features/shell-integration#enable-powerlevel10k-integration",
													"settings_terminal_zsh_p10k",
												)}
												style={{ display: "inline" }}>
												{" "}
											</Link>
										</Trans>
									</div>
								</SearchableSetting>

								<SearchableSetting
									settingId="terminal-zdotdir"
									section="terminal"
									label={t("settings:terminal.zdotdir.label")}>
									<LabeledCheckbox
										checked={terminalZdotdir ?? false}
										onChange={(e: any) => setCachedStateField("terminalZdotdir", e.target.checked)}
										data-testid="terminal-zdotdir-checkbox">
										<span className="font-medium">{t("settings:terminal.zdotdir.label")}</span>
									</LabeledCheckbox>
									<div className="text-vscode-descriptionForeground text-sm mt-1">
										<Trans i18nKey="settings:terminal.zdotdir.description">
											<Link
												href={buildDocLink(
													"features/shell-integration#enable-zdotdir-handling",
													"settings_terminal_zdotdir",
												)}
												style={{ display: "inline" }}>
												{" "}
											</Link>
										</Trans>
									</div>
								</SearchableSetting>
							</>
						)}
					</div>
				</div>
			</Section>
		</div>
	)
}
