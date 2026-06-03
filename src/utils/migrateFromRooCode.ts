import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import { fileExistsAtPath } from "./fs"

const MIGRATION_COMPLETED_KEY = "tumble-code.migrationFromRooCodeCompleted"
const LEGACY_PUBLISHER = "RooVeterinaryInc"
const LEGACY_NAME = "roo-cline"
const LEGACY_CONFIG_NAMESPACE = "roo-cline"
const NEW_CONFIG_NAMESPACE = "tumble-code"

// Keys declared in the manifest under contributes.configuration.properties.
// Source of truth: src/package.json. Listed here so we know exactly what to copy.
const CONFIG_KEYS_TO_MIGRATE = [
	"allowedCommands",
	"deniedCommands",
	"commandExecutionTimeout",
	"commandTimeoutAllowlist",
	"preventCompletionWithOpenTodos",
	"vsCodeLmModelSelector",
	"customStoragePath",
	"enableCodeActions",
	"autoImportSettingsPath",
	"maximumIndexedFilesForFileSearch",
	"useAgentRules",
	"apiRequestTimeout",
	"newTaskRequireTodos",
	"codeIndex.embeddingBatchSize",
	"debug",
	"debugProxy.enabled",
	"debugProxy.serverUrl",
	"debugProxy.tlsInsecure",
] as const

/**
 * One-shot migration that imports a user's Roo Code settings into Tumble Code.
 *
 * Why this exists: when the rebrand moved the extension's manifest `name` from
 * `roo-cline` to `tumble-code`, production code switched to reading settings
 * via `vscode.workspace.getConfiguration(Package.name)` -- i.e. the new
 * `tumble-code` namespace. Without this bridge a Roo Code user installing
 * Tumble Code would see all their settings ignored, even though the values
 * are still sitting in their settings.json under `roo-cline.*`.
 *
 * The migration also copies the Roo Code extension's globalStorage directory
 * (chat history, task list, MCP servers, custom modes) into Tumble Code's
 * globalStorage so users don't lose their work. globalState and secrets cannot
 * be read across extensions, so those have to be re-entered (API keys
 * especially).
 *
 * Idempotent: once the migration runs successfully (or the user declines),
 * a flag in globalState prevents it from prompting again.
 */
export async function migrateFromRooCode(
	context: vscode.ExtensionContext,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	if (context.globalState.get<boolean>(MIGRATION_COMPLETED_KEY)) {
		return
	}

	const hasLegacyConfig = detectLegacyConfig()
	const legacyStorageDir = computeLegacyStorageDir(context)
	const hasLegacyStorage = legacyStorageDir ? await fileExistsAtPath(legacyStorageDir) : false

	if (!hasLegacyConfig && !hasLegacyStorage) {
		// Nothing to migrate; mark complete so we don't ask again on subsequent activations.
		await context.globalState.update(MIGRATION_COMPLETED_KEY, true)
		return
	}

	const choice = await vscode.window.showInformationMessage(
		"Tumble Code found settings from a previous Roo Code installation. Import them?",
		{ modal: false },
		"Import",
		"Skip",
	)

	if (choice !== "Import") {
		// User declined; mark complete to avoid re-prompting.
		await context.globalState.update(MIGRATION_COMPLETED_KEY, true)
		outputChannel.appendLine("[migrate-from-roo-code] User declined import; skipping.")
		return
	}

	try {
		if (hasLegacyConfig) {
			await migrateConfigKeys(outputChannel)
		}
		if (hasLegacyStorage && legacyStorageDir) {
			await migrateGlobalStorage(legacyStorageDir, context.globalStorageUri.fsPath, outputChannel)
		}
		await context.globalState.update(MIGRATION_COMPLETED_KEY, true)
		outputChannel.appendLine("[migrate-from-roo-code] Migration complete.")
		vscode.window.showInformationMessage(
			"Tumble Code imported your Roo Code settings. API keys must be re-entered manually.",
		)
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		outputChannel.appendLine(`[migrate-from-roo-code] Migration failed: ${message}`)
		// Leave the flag unset so the user can retry on next activation.
	}
}

function detectLegacyConfig(): boolean {
	const legacy = vscode.workspace.getConfiguration(LEGACY_CONFIG_NAMESPACE)
	if (typeof legacy.inspect !== "function") return false
	return CONFIG_KEYS_TO_MIGRATE.some((key) => {
		const inspected = legacy.inspect(key)
		// Only count values explicitly set by the user (global or workspace),
		// not the JSON-schema default that may still be exposed by the old manifest.
		return inspected?.globalValue !== undefined || inspected?.workspaceValue !== undefined
	})
}

async function migrateConfigKeys(outputChannel: vscode.OutputChannel): Promise<void> {
	const legacy = vscode.workspace.getConfiguration(LEGACY_CONFIG_NAMESPACE)
	const next = vscode.workspace.getConfiguration(NEW_CONFIG_NAMESPACE)
	if (typeof legacy.inspect !== "function") return

	for (const key of CONFIG_KEYS_TO_MIGRATE) {
		const inspected = legacy.inspect(key)
		if (inspected?.globalValue !== undefined) {
			await next.update(key, inspected.globalValue, vscode.ConfigurationTarget.Global)
			outputChannel.appendLine(`[migrate-from-roo-code] copied global ${LEGACY_CONFIG_NAMESPACE}.${key}`)
		}
		if (inspected?.workspaceValue !== undefined) {
			await next.update(key, inspected.workspaceValue, vscode.ConfigurationTarget.Workspace)
			outputChannel.appendLine(`[migrate-from-roo-code] copied workspace ${LEGACY_CONFIG_NAMESPACE}.${key}`)
		}
	}
}

function computeLegacyStorageDir(context: vscode.ExtensionContext): string | undefined {
	// context.globalStorageUri.fsPath is e.g. `.../User/globalStorage/QUB-IT.tumble-code`.
	// The sibling directory for the legacy extension lives at `.../User/globalStorage/<LEGACY_PUBLISHER>.<LEGACY_NAME>`.
	const fsPath = context.globalStorageUri?.fsPath
	if (!fsPath) return undefined
	const parent = path.dirname(fsPath)
	if (!parent) return undefined
	return path.join(parent, `${LEGACY_PUBLISHER}.${LEGACY_NAME}`)
}

async function migrateGlobalStorage(
	legacyDir: string,
	newDir: string,
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	await fs.mkdir(newDir, { recursive: true })
	await copyDirectory(legacyDir, newDir)
	outputChannel.appendLine(`[migrate-from-roo-code] copied globalStorage from ${legacyDir} to ${newDir}`)
}

async function copyDirectory(src: string, dest: string): Promise<void> {
	const entries = await fs.readdir(src, { withFileTypes: true })
	for (const entry of entries) {
		const srcPath = path.join(src, entry.name)
		const destPath = path.join(dest, entry.name)
		if (entry.isDirectory()) {
			await fs.mkdir(destPath, { recursive: true })
			await copyDirectory(srcPath, destPath)
		} else if (entry.isFile()) {
			// Don't overwrite existing files in the destination -- Tumble Code's own
			// state (if any) takes precedence over the legacy copy.
			if (!(await fileExistsAtPath(destPath))) {
				await fs.copyFile(srcPath, destPath)
			}
		}
	}
}
