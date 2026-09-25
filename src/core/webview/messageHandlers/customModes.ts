// Custom modes: create, update, delete, import and export.

import * as path from "path"
import * as os from "os"
import * as fs from "fs/promises"
import * as vscode from "vscode"
import { TelemetryService } from "@roo-code/telemetry"
import { t } from "../../../i18n"
import { openFile } from "../../../integrations/misc/open-file"
import { defaultModeSlug } from "../../../shared/modes"
import { resolveDefaultSaveUri, saveLastExportPath } from "../../../utils/export"
import { fileExistsAtPath } from "../../../utils/fs"
import { getWorkspacePath } from "../../../utils/path"
import type { MessageHandlerMap } from "./types"

export const customModesHandlers: MessageHandlerMap = {
	openCustomModesSettings: async (ctx) => {
		const { provider } = ctx
		const customModesFilePath = await provider.customModesManager.getCustomModesFilePath()

		if (customModesFilePath) {
			openFile(customModesFilePath)
		}
	},

	updateCustomMode: async (ctx, message) => {
		const { provider, updateGlobalState } = ctx
		if (message.modeConfig) {
			try {
				// Check if this is a new mode or an update to an existing mode
				const existingModes = await provider.customModesManager.getCustomModes()
				const isNewMode = !existingModes.some((mode) => mode.slug === message.modeConfig?.slug)

				await provider.customModesManager.updateCustomMode(message.modeConfig.slug, message.modeConfig)
				// Update state after saving the mode
				const customModes = await provider.customModesManager.getCustomModes()
				await updateGlobalState("customModes", customModes)
				await updateGlobalState("mode", message.modeConfig.slug)
				await provider.postStateToWebview()

				// Track telemetry for custom mode creation or update
				if (TelemetryService.hasInstance()) {
					if (isNewMode) {
						// This is a new custom mode
						TelemetryService.instance.captureCustomModeCreated(
							message.modeConfig.slug,
							message.modeConfig.name,
						)
					} else {
						// Determine which setting was changed by comparing objects
						const existingMode = existingModes.find((mode) => mode.slug === message.modeConfig?.slug)
						const changedSettings = existingMode
							? Object.keys(message.modeConfig).filter(
									(key) =>
										JSON.stringify((existingMode as Record<string, unknown>)[key]) !==
										JSON.stringify((message.modeConfig as Record<string, unknown>)[key]),
								)
							: []

						if (changedSettings.length > 0) {
							TelemetryService.instance.captureModeSettingChanged(changedSettings[0])
						}
					}
				}
			} catch (error) {
				// Error already shown to user by updateCustomMode
				// Just prevent unhandled rejection and skip state updates
			}
		}
	},

	deleteCustomMode: async (ctx, message) => {
		const { provider } = ctx
		if (message.slug) {
			// Get the mode details to determine source and rules folder path
			const customModes = await provider.customModesManager.getCustomModes()
			const modeToDelete = customModes.find((mode) => mode.slug === message.slug)

			if (!modeToDelete) {
				return
			}

			// Determine the scope based on source (project or global)
			const scope = modeToDelete.source || "global"

			// Determine the rules folder path
			let rulesFolderPath: string
			if (scope === "project") {
				const workspacePath = getWorkspacePath()
				if (workspacePath) {
					rulesFolderPath = path.join(workspacePath, ".roo", `rules-${message.slug}`)
				} else {
					rulesFolderPath = path.join(".roo", `rules-${message.slug}`)
				}
			} else {
				// Global scope - use OS home directory
				const homeDir = os.homedir()
				rulesFolderPath = path.join(homeDir, ".roo", `rules-${message.slug}`)
			}

			// Check if the rules folder exists
			const rulesFolderExists = await fileExistsAtPath(rulesFolderPath)

			// If this is a check request, send back the folder info
			if (message.checkOnly) {
				await provider.postMessageToWebview({
					type: "deleteCustomModeCheck",
					slug: message.slug,
					rulesFolderPath: rulesFolderExists ? rulesFolderPath : undefined,
				})
				return
			}

			// Delete the mode
			await provider.customModesManager.deleteCustomMode(message.slug)

			// Delete the rules folder if it exists
			if (rulesFolderExists) {
				try {
					await fs.rm(rulesFolderPath, { recursive: true, force: true })
					provider.log(`Deleted rules folder for mode ${message.slug}: ${rulesFolderPath}`)
				} catch (error) {
					provider.log(`Failed to delete rules folder for mode ${message.slug}: ${error}`)
					// Notify the user about the failure
					vscode.window.showErrorMessage(
						t("common:errors.delete_rules_folder_failed", {
							rulesFolderPath,
							error: error instanceof Error ? error.message : String(error),
						}),
					)
					// Continue with mode deletion even if folder deletion fails
				}
			}

			// Switch back to default mode after deletion. Go through handleModeSwitch
			// (like the mode selector) so the running task follows: it reads its own
			// mode, not the shared "mode" state, and must not stay in a deleted mode.
			await provider.handleModeSwitch(defaultModeSlug)
		}
	},

	exportMode: async (ctx, message) => {
		const { provider, getGlobalState } = ctx
		if (message.slug) {
			try {
				// Get custom mode prompts to check if built-in mode has been customized
				const customModePrompts = getGlobalState("customModePrompts") || {}
				const customPrompt = customModePrompts[message.slug]

				// Export the mode with any customizations merged directly
				const result = await provider.customModesManager.exportModeWithRules(message.slug, customPrompt)

				if (result.success && result.yaml) {
					const defaultUri = await resolveDefaultSaveUri(
						provider.contextProxy,
						"lastModeExportPath",
						`${message.slug}-export.yaml`,
						{
							useWorkspace: true,
							fallbackDir: path.join(os.homedir(), "Downloads"),
						},
					)

					// Show save dialog
					const saveUri = await vscode.window.showSaveDialog({
						defaultUri,
						filters: {
							"YAML files": ["yaml", "yml"],
						},
						title: "Save mode export",
					})

					if (saveUri && result.yaml) {
						// Save the directory for next time
						await saveLastExportPath(provider.contextProxy, "lastModeExportPath", saveUri)

						// Write the file to the selected location
						await fs.writeFile(saveUri.fsPath, result.yaml, "utf-8")

						// Send success message to webview
						provider.postMessageToWebview({
							type: "exportModeResult",
							success: true,
							slug: message.slug,
						})

						// Show info message
						vscode.window.showInformationMessage(t("common:info.mode_exported", { mode: message.slug }))
					} else {
						// User cancelled the save dialog
						provider.postMessageToWebview({
							type: "exportModeResult",
							success: false,
							error: "Export cancelled",
							slug: message.slug,
						})
					}
				} else {
					// Send error message to webview
					provider.postMessageToWebview({
						type: "exportModeResult",
						success: false,
						error: result.error,
						slug: message.slug,
					})
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				provider.log(`Failed to export mode ${message.slug}: ${errorMessage}`)

				// Send error message to webview
				provider.postMessageToWebview({
					type: "exportModeResult",
					success: false,
					error: errorMessage,
					slug: message.slug,
				})
			}
		}
	},

	importMode: async (ctx, message) => {
		const { provider, getGlobalState, updateGlobalState } = ctx
		try {
			// Get last used directory for import
			const lastImportPath = getGlobalState("lastModeImportPath")
			let defaultUri: vscode.Uri | undefined

			if (lastImportPath) {
				// Use the directory from the last import
				const lastDir = path.dirname(lastImportPath)
				defaultUri = vscode.Uri.file(lastDir)
			} else {
				// Default to workspace or home directory
				const workspaceFolders = vscode.workspace.workspaceFolders
				if (workspaceFolders && workspaceFolders.length > 0) {
					defaultUri = vscode.Uri.file(workspaceFolders[0].uri.fsPath)
				}
			}

			// Show file picker to select YAML file
			const fileUri = await vscode.window.showOpenDialog({
				canSelectFiles: true,
				canSelectFolders: false,
				canSelectMany: false,
				defaultUri,
				filters: {
					"YAML files": ["yaml", "yml"],
				},
				title: "Select mode export file to import",
			})

			if (fileUri && fileUri[0]) {
				// Save the directory for next time
				await updateGlobalState("lastModeImportPath", fileUri[0].fsPath)

				// Read the file content
				const yamlContent = await fs.readFile(fileUri[0].fsPath, "utf-8")

				// Import the mode with the specified source level
				const result = await provider.customModesManager.importModeWithRules(
					yamlContent,
					message.source || "project", // Default to project if not specified
				)

				if (result.success) {
					// Update state after importing
					const customModes = await provider.customModesManager.getCustomModes()
					await updateGlobalState("customModes", customModes)
					await provider.postStateToWebview()

					// Send success message to webview, include the imported slug so UI can switch
					provider.postMessageToWebview({
						type: "importModeResult",
						success: true,
						slug: result.slug,
					})

					// Show success message
					vscode.window.showInformationMessage(t("common:info.mode_imported"))
				} else {
					// Send error message to webview
					provider.postMessageToWebview({
						type: "importModeResult",
						success: false,
						error: result.error,
					})

					// Show error message
					vscode.window.showErrorMessage(t("common:errors.mode_import_failed", { error: result.error }))
				}
			} else {
				// User cancelled the file dialog - reset the importing state
				provider.postMessageToWebview({
					type: "importModeResult",
					success: false,
					error: "cancelled",
				})
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			provider.log(`Failed to import mode: ${errorMessage}`)

			// Send error message to webview
			provider.postMessageToWebview({
				type: "importModeResult",
				success: false,
				error: errorMessage,
			})

			// Show error message
			vscode.window.showErrorMessage(t("common:errors.mode_import_failed", { error: errorMessage }))
		}
	},

	checkRulesDirectory: async (ctx, message) => {
		const { provider } = ctx
		if (message.slug) {
			const hasContent = await provider.customModesManager.checkRulesDirectoryHasContent(message.slug)

			provider.postMessageToWebview({
				type: "checkRulesDirectoryResult",
				slug: message.slug,
				hasContent: hasContent,
			})
		}
	},
}
