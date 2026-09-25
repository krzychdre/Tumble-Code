// Settings writes, VS Code settings, terminal profiles, sounds, telemetry and small UI actions.

import * as vscode from "vscode"
import { TelemetryService } from "@roo-code/telemetry"
import type { Language, TelemetrySetting, AudioType, RooCodeSettings, ExperimentId } from "@roo-code/types"
import { changeLanguage, t } from "../../../i18n"
import {
	deleteCustomSound,
	getCustomSoundOriginalSettingKey,
	getCustomSoundSettingKey,
	selectAndStoreCustomSound,
} from "../../../integrations/misc/custom-sounds"
import { Terminal } from "../../../integrations/terminal/Terminal"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"
import { experimentDefault } from "../../../shared/experiments"
import { Package } from "../../../shared/package"
import { getCommand } from "../../../utils/commands"
import { sanitizeCommandList } from "../../auto-approval/sanitizeCommandList"
import { exportSettings, importSettingsWithFeedback } from "../../config/importExport"
import type { MessageHandlerMap } from "./types"

const ALLOWED_VSCODE_SETTINGS = new Set(["terminal.integrated.inheritEnv"])

export const settingsHandlers: MessageHandlerMap = {
	updateSettings: async (ctx, message) => {
		const { provider, getGlobalState } = ctx
		if (message.updatedSettings) {
			for (const [key, value] of Object.entries(message.updatedSettings)) {
				let newValue = value

				if (key === "language") {
					newValue = value ?? "en"
					changeLanguage(newValue as Language)
				} else if (key === "allowedCommands" || key === "deniedCommands") {
					newValue = sanitizeCommandList(value)

					await vscode.workspace
						.getConfiguration(Package.name)
						.update(key, newValue, vscode.ConfigurationTarget.Global)
				} else if (key === "terminalShellIntegrationTimeout") {
					if (value !== undefined) {
						Terminal.setShellIntegrationTimeout(value as number)
					}
				} else if (key === "terminalShellIntegrationDisabled") {
					if (value !== undefined) {
						Terminal.setShellIntegrationDisabled(value as boolean)
					}
				} else if (key === "terminalCommandDelay") {
					if (value !== undefined) {
						Terminal.setCommandDelay(value as number)
					}
				} else if (key === "terminalPowershellCounter") {
					if (value !== undefined) {
						Terminal.setPowershellCounter(value as boolean)
					}
				} else if (key === "terminalZshClearEolMark") {
					if (value !== undefined) {
						Terminal.setTerminalZshClearEolMark(value as boolean)
					}
				} else if (key === "terminalZshOhMy") {
					if (value !== undefined) {
						Terminal.setTerminalZshOhMy(value as boolean)
					}
				} else if (key === "terminalZshP10k") {
					if (value !== undefined) {
						Terminal.setTerminalZshP10k(value as boolean)
					}
				} else if (key === "terminalZdotdir") {
					if (value !== undefined) {
						Terminal.setTerminalZdotdir(value as boolean)
					}
				} else if (key === "terminalProfile") {
					const previousProfile = Terminal.getTerminalProfile()
					Terminal.setTerminalProfile(typeof value === "string" ? value : undefined)
					newValue = Terminal.getTerminalProfile()

					if (newValue !== previousProfile) {
						// Discard idle terminals so the next command gets a fresh
						// terminal using the new profile's shell instead of reusing
						// a stale one from the previous profile.
						TerminalRegistry.closeIdleTerminals()
					}
				} else if (key === "execaShellPath") {
					Terminal.setExecaShellPath(value as string | undefined)
				} else if (key === "mcpEnabled") {
					newValue = value ?? true
					const mcpHub = provider.getMcpHub()

					if (mcpHub) {
						await mcpHub.handleMcpEnabledChange(newValue as boolean)
					}
				} else if (key === "experiments") {
					if (!value) {
						continue
					}

					newValue = {
						...(getGlobalState("experiments") ?? experimentDefault),
						...(value as Record<ExperimentId, boolean>),
					}
				} else if (key === "customSupportPrompts") {
					if (!value) {
						continue
					}
				}

				await provider.contextProxy.setValue(key as keyof RooCodeSettings, newValue)
			}

			await provider.postStateToWebview()
		}
	},

	selectCustomSound: async (ctx, message) => {
		const { provider, getGlobalState, updateGlobalState } = ctx
		const audioType = message.audioType as AudioType | undefined
		if (!audioType) return
		const settingKey = getCustomSoundSettingKey(audioType)
		const originalKey = getCustomSoundOriginalSettingKey(audioType)
		const previous = getGlobalState(settingKey) as string | undefined
		const globalStoragePath = provider.contextProxy.globalStorageUri.fsPath
		try {
			const result = await selectAndStoreCustomSound(globalStoragePath, audioType, previous)
			if (result) {
				await updateGlobalState(settingKey, result.basename)
				await updateGlobalState(originalKey, result.originalName)
				await provider.postStateToWebview()
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			vscode.window.showErrorMessage(`Failed to set custom sound: ${msg}`)
		}
	},

	resetCustomSound: async (ctx, message) => {
		const { provider, getGlobalState, updateGlobalState } = ctx
		const audioType = message.audioType as AudioType | undefined
		if (!audioType) return
		const settingKey = getCustomSoundSettingKey(audioType)
		const originalKey = getCustomSoundOriginalSettingKey(audioType)
		const previous = getGlobalState(settingKey) as string | undefined
		try {
			await deleteCustomSound(provider.contextProxy.globalStorageUri.fsPath, previous)
		} catch {
			// Best-effort cleanup; still clear the setting.
		}
		await updateGlobalState(settingKey, undefined)
		await updateGlobalState(originalKey, undefined)
		await provider.postStateToWebview()
	},

	importSettings: async (ctx) => {
		const { provider } = ctx
		await importSettingsWithFeedback({
			providerSettingsManager: provider.providerSettingsManager,
			contextProxy: provider.contextProxy,
			customModesManager: provider.customModesManager,
			provider: provider,
		})
	},

	exportSettings: async (ctx) => {
		const { provider } = ctx
		await exportSettings({
			providerSettingsManager: provider.providerSettingsManager,
			contextProxy: provider.contextProxy,
		})
	},

	resetState: async (ctx) => {
		const { provider } = ctx
		await provider.resetState()
	},

	openTerminalProfilePicker: async () => {
		// Open VS Code's native terminal profile picker so the user can set the
		// default shell without leaving VS Code's own settings UI.
		await vscode.commands.executeCommand("workbench.action.terminal.selectDefaultShell")
	},

	openKeyboardShortcuts: async (_ctx, message) => {
		// Open VSCode keyboard shortcuts settings and optionally filter to show the Roo Code commands
		const searchQuery = message.text || ""
		if (searchQuery) {
			// Open with a search query pre-filled
			await vscode.commands.executeCommand("workbench.action.openGlobalKeybindings", searchQuery)
		} else {
			// Just open the keyboard shortcuts settings
			await vscode.commands.executeCommand("workbench.action.openGlobalKeybindings")
		}
	},

	openExtensionLogs: (ctx) => {
		const { provider } = ctx
		// Used by the webview's StorageErrorBanner: the user needs the
		// Output channel entries behind a reported storage failure
		// (Remote SSH storage lives on the server, so the toast alone
		// is rarely enough to diagnose it).
		provider.showOutputChannel()
	},

	updateVSCodeSetting: async (_ctx, message) => {
		const { setting, value } = message

		if (setting !== undefined && value !== undefined) {
			if (ALLOWED_VSCODE_SETTINGS.has(setting)) {
				await vscode.workspace.getConfiguration().update(setting, value, true)
			} else {
				vscode.window.showErrorMessage(`Cannot update restricted VSCode setting: ${setting}`)
			}
		}
	},

	getVSCodeSetting: async (ctx, message) => {
		const { provider } = ctx
		const { setting } = message

		if (setting) {
			try {
				await provider.postMessageToWebview({
					type: "vsCodeSetting",
					setting,
					value: vscode.workspace.getConfiguration().get(setting),
				})
			} catch (error) {
				console.error(`Failed to get VSCode setting ${message.setting}:`, error)

				await provider.postMessageToWebview({
					type: "vsCodeSetting",
					setting,
					error: `Failed to get setting: ${error.message}`,
					value: undefined,
				})
			}
		}
	},

	requestTerminalProfiles: async (ctx) => {
		const { provider } = ctx
		// Allowlisted request: read VS Code's terminal profiles server-side and
		// return only the sanitized profile names. The terminal profile dropdown
		// only needs names, so this avoids routing it through the generic
		// `getVSCodeSetting` handler (which reads any key the webview supplies).
		// Only profiles with a resolvable `path` are returned - source-only
		// profiles (e.g. { source: "PowerShell" }) cannot be mapped to a shell
		// binary by an extension and would silently fall back to the default.
		try {
			await provider.postMessageToWebview({
				type: "terminalProfiles",
				profiles: Terminal.getAvailableProfileNames(),
			})
		} catch (error) {
			console.error("Failed to get terminal profiles:", error)
			await provider.postMessageToWebview({ type: "terminalProfiles", profiles: [] })
		}
	},

	autoApprovalEnabled: async (ctx, message) => {
		const { provider, updateGlobalState } = ctx
		await updateGlobalState("autoApprovalEnabled", message.bool ?? false)
		await provider.postStateToWebview()
	},

	telemetrySetting: async (ctx, message) => {
		const { provider, getGlobalState, updateGlobalState } = ctx
		const telemetrySetting = message.text as TelemetrySetting
		const previousSetting = getGlobalState("telemetrySetting") || "unset"
		const isOptedIn = telemetrySetting !== "disabled"
		const wasPreviouslyOptedIn = previousSetting !== "disabled"

		// If turning telemetry OFF, fire event BEFORE disabling
		if (wasPreviouslyOptedIn && !isOptedIn && TelemetryService.hasInstance()) {
			TelemetryService.instance.captureTelemetrySettingsChanged(previousSetting, telemetrySetting)
		}

		// Update the telemetry state
		await updateGlobalState("telemetrySetting", telemetrySetting)

		if (TelemetryService.hasInstance()) {
			TelemetryService.instance.updateTelemetryState(isOptedIn)
		}

		// If turning telemetry ON, fire event AFTER enabling
		if (!wasPreviouslyOptedIn && isOptedIn && TelemetryService.hasInstance()) {
			TelemetryService.instance.captureTelemetrySettingsChanged(previousSetting, telemetrySetting)
		}

		await provider.postStateToWebview()
	},

	debugSetting: async (ctx, message) => {
		const { provider } = ctx
		await vscode.workspace
			.getConfiguration(Package.name)
			.update("debug", message.bool ?? false, vscode.ConfigurationTarget.Global)
		await provider.postStateToWebview()
	},

	focusPanelRequest: async () => {
		// Execute the focusPanel command to focus the WebView
		await vscode.commands.executeCommand(getCommand("focusPanel"))
	},

	switchTab: async (ctx, message) => {
		const { provider } = ctx
		if (message.tab) {
			// Capture tab shown event for all switchTab messages (which are user-initiated).
			if (TelemetryService.hasInstance()) {
				TelemetryService.instance.captureTabShown(message.tab)
			}

			await provider.postMessageToWebview({
				type: "action",
				action: "switchTab",
				tab: message.tab,
				values: message.values,
			})
		}
	},

	showMdmAuthRequiredNotification: () => {
		// Show notification that organization requires authentication
		vscode.window.showWarningMessage(t("common:mdm.info.organization_requires_auth"))
	},

	dismissUpsell: async (ctx, message) => {
		const { provider, getGlobalState, updateGlobalState } = ctx
		if (message.upsellId) {
			try {
				// Get current list of dismissed upsells
				const dismissedUpsells = getGlobalState("dismissedUpsells") || []

				// Add the new upsell ID if not already present
				let updatedList = dismissedUpsells
				if (!dismissedUpsells.includes(message.upsellId)) {
					updatedList = [...dismissedUpsells, message.upsellId]
					await updateGlobalState("dismissedUpsells", updatedList)
				}

				// Send updated list back to webview (use the already computed updatedList)
				await provider.postMessageToWebview({
					type: "dismissedUpsells",
					list: updatedList,
				})
			} catch (error) {
				// Fail silently as per Bruno's comment - it's OK to fail silently in this case
				provider.log(`Failed to dismiss upsell: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
	},

	getDismissedUpsells: async (ctx) => {
		const { provider, getGlobalState } = ctx
		// Send the current list of dismissed upsells to the webview
		const dismissedUpsells = getGlobalState("dismissedUpsells") || []
		await provider.postMessageToWebview({
			type: "dismissedUpsells",
			list: dismissedUpsells,
		})
	},
}
