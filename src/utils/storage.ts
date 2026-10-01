import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { constants as fsConstants } from "fs"

import { Package } from "../shared/package"
import { t } from "../i18n"
import { logger } from "./logging"

/**
 * Memoized successful storage-root resolutions, keyed by
 * `${defaultPath}\u0000${customStoragePath}`. Only successful (mkdir + access
 * passed) resolutions are stored; failures fall through uncached so the next
 * call retries the fs. Because the config value is part of the key and is
 * re-read on every call, a runtime setting change resolves fresh without a
 * config-change listener.
 */
const storageBasePathCache = new Map<string, string>()

/**
 * Gets the base storage path for conversations
 * If a custom path is configured, uses that path
 * Otherwise uses the default VSCode extension global storage path
 */
/**
 * Reads the `customStoragePath` setting ("" when unset); `undefined` when the
 * VS Code configuration is not accessible (e.g. in some tests).
 */
function readCustomStoragePath(): string | undefined {
	try {
		const config = vscode.workspace.getConfiguration(Package.name)
		return config.get<string>("customStoragePath", "")
	} catch (error) {
		logger.warn("Could not access VSCode configuration - using default path")
		return undefined
	}
}

/**
 * Synchronous counterpart of `getStorageBasePath` for callers that cannot
 * await (the cold read in `modelCache.getModelsFromCache`). It resolves the
 * same directory without touching the file system: the configured custom
 * path when one is set, otherwise `defaultPath`. It does not create or check
 * the custom directory, so a caller must treat a missing file as a miss.
 */
export function getStorageBasePathSync(defaultPath: string): string {
	return readCustomStoragePath() || defaultPath
}

export async function getStorageBasePath(defaultPath: string): Promise<string> {
	// Get user-configured custom storage path
	const customStoragePath = readCustomStoragePath()
	if (customStoragePath === undefined) {
		return defaultPath
	}

	// If no custom path is set, use default path
	if (!customStoragePath) {
		return defaultPath
	}

	const cacheKey = `${defaultPath}\u0000${customStoragePath}`
	const cached = storageBasePathCache.get(cacheKey)
	if (cached !== undefined) {
		return cached
	}

	try {
		// Ensure custom path exists
		await fs.mkdir(customStoragePath, { recursive: true })

		// Check directory write permission without creating temp files
		await fs.access(customStoragePath, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK)

		storageBasePathCache.set(cacheKey, customStoragePath)
		return customStoragePath
	} catch (error) {
		// If path is unusable, report error and fall back to default path
		logger.error(`Custom storage path is unusable: ${error instanceof Error ? error.message : String(error)}`)
		if (vscode.window) {
			vscode.window.showErrorMessage(t("common:errors.custom_storage_path_unusable", { path: customStoragePath }))
		}
		return defaultPath
	}
}

/**
 * Gets the storage directory path for a task
 */
export async function getTaskDirectoryPath(globalStoragePath: string, taskId: string): Promise<string> {
	const basePath = await getStorageBasePath(globalStoragePath)
	const taskDir = path.join(basePath, "tasks", taskId)
	await fs.mkdir(taskDir, { recursive: true })
	return taskDir
}

/**
 * Gets the settings directory path
 */
export async function getSettingsDirectoryPath(globalStoragePath: string): Promise<string> {
	const basePath = await getStorageBasePath(globalStoragePath)
	const settingsDir = path.join(basePath, "settings")
	await fs.mkdir(settingsDir, { recursive: true })
	return settingsDir
}

/**
 * Gets the cache directory path
 */
export async function getCacheDirectoryPath(globalStoragePath: string): Promise<string> {
	const basePath = await getStorageBasePath(globalStoragePath)
	const cacheDir = path.join(basePath, "cache")
	await fs.mkdir(cacheDir, { recursive: true })
	return cacheDir
}

/**
 * Prompts the user to set a custom storage path
 * Displays an input box allowing the user to enter a custom path
 */
export async function promptForCustomStoragePath(): Promise<void> {
	if (!vscode.window || !vscode.workspace) {
		logger.error("VS Code API not available")
		return
	}

	let currentPath = ""
	try {
		const currentConfig = vscode.workspace.getConfiguration(Package.name)
		currentPath = currentConfig.get<string>("customStoragePath", "")
	} catch (error) {
		logger.error("Could not access configuration")
		return
	}

	const result = await vscode.window.showInputBox({
		value: currentPath,
		placeHolder: t("common:storage.path_placeholder"),
		prompt: t("common:storage.prompt_custom_path"),
		validateInput: (input) => {
			if (!input) {
				return null // Allow empty value (use default path)
			}

			try {
				// Validate path format
				path.parse(input)

				// Check if path is absolute
				if (!path.isAbsolute(input)) {
					return t("common:storage.enter_absolute_path")
				}

				return null // Path format is valid
			} catch (e) {
				return t("common:storage.enter_valid_path")
			}
		},
	})

	// If user canceled the operation, result will be undefined
	if (result !== undefined) {
		try {
			const currentConfig = vscode.workspace.getConfiguration(Package.name)
			await currentConfig.update("customStoragePath", result, vscode.ConfigurationTarget.Global)

			if (result) {
				try {
					// Test if path is accessible
					await fs.mkdir(result, { recursive: true })
					await fs.access(result, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK)
					vscode.window.showInformationMessage(t("common:info.custom_storage_path_set", { path: result }))
				} catch (error) {
					vscode.window.showErrorMessage(
						t("common:errors.cannot_access_path", {
							path: result,
							error: error instanceof Error ? error.message : String(error),
						}),
					)
				}
			} else {
				vscode.window.showInformationMessage(t("common:info.default_storage_path"))
			}
		} catch (error) {
			logger.error("Failed to update configuration", error)
		}
	}
}
