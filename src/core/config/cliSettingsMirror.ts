import fs from "fs/promises"
import os from "os"
import path from "path"

import { GLOBAL_SETTINGS_KEYS, type GlobalSettings } from "@tumble-code/types"
import { withLockedJsonTransaction } from "@tumble-code/core"

import { logger } from "../../utils/logging"
import type { ContextProxy } from "./ContextProxy"

/**
 * The editor's settings, mirrored into the `vscode` section of the CLI's
 * settings file, so the CLI runs the engine the way the editor does. The CLI
 * applies the section under its own keys (apps/cli/src/commands/cli/run.ts).
 * The extension writes only this section; the rest of the file is the user's.
 */

type GlobalSettingsKey = keyof GlobalSettings

/** ~/.roo/cli-settings.json, the file the CLI reads (apps/cli/src/lib/storage/settings.ts). */
export const CLI_SETTINGS_PATH = path.join(os.homedir(), ".roo", "cli-settings.json")

/** Global settings that stay out of the CLI. */
const NOT_MIRRORED: ReadonlySet<GlobalSettingsKey> = new Set<GlobalSettingsKey>([
	// Approvals: the CLI has its own (requireApproval, --dangerously-skip-permissions).
	"autoApprovalEnabled",
	"autoApprovalMode",
	"alwaysAllowReadOnly",
	"alwaysAllowReadOnlyOutsideWorkspace",
	"alwaysAllowWrite",
	"alwaysAllowWriteOutsideWorkspace",
	"alwaysAllowWriteProtected",
	"alwaysAllowMcp",
	"alwaysAllowModeSwitch",
	"alwaysAllowSubtasks",
	"alwaysApprovePlan",
	"alwaysAllowExecute",
	"alwaysAllowFollowupQuestions",
	"followupAutoApproveTimeoutMs",
	"allowedCommands",
	"deniedCommands",
	"allowedMaxRequests",
	"allowedMaxCost",
	// Provider profiles and the settings that name one by id: the CLI resolves its own provider.
	"currentApiConfigName",
	"listApiConfigMeta",
	"pinnedApiConfigs",
	"lockedApiConfigModes",
	"memoryWriterApiConfigId",
	"autoCondenseContextApiConfigId",
	"enhancementApiConfigId",
	"profileThresholds",
	// VS Code's integrated terminal: the CLI runs commands in its own shell.
	"terminalShellIntegrationTimeout",
	"terminalShellIntegrationDisabled",
	"terminalCommandDelay",
	"terminalPowershellCounter",
	"terminalZshClearEolMark",
	"terminalZshOhMy",
	"terminalZshP10k",
	"terminalZdotdir",
	"terminalProfile",
	"execaShellPath",
	// The code index: its embedder keys are secrets, so a mirrored config would start an index that fails.
	"codebaseIndexConfig",
	"codebaseIndexModels",
	// Custom modes live in their own file, which the CLI reads from its own store.
	"customModes",
	// The editor's own state and view.
	"mode",
	"lastShownAnnouncementId",
	"dismissedUpsells",
	"soundEnabled",
	"soundVolume",
	"customSoundCelebration",
	"customSoundCelebrationOriginal",
	"customSoundProgressLoop",
	"customSoundProgressLoopOriginal",
	"customSoundNotification",
	"customSoundNotificationOriginal",
	"historyPreviewCollapsed",
	"reasoningBlockCollapsed",
	"enterBehavior",
	"uiDensity",
	"hasOpenedModeSelector",
	"lastModeExportPath",
	"lastModeImportPath",
	"lastSettingsExportPath",
	"lastTaskExportPath",
	"lastImageSavePath",
	"worktreeAutoOpenPath",
	"showWorktreesInHomeScreen",
])

/** What the extension writes under `vscode` in the CLI's settings file. */
export interface VscodeSection {
	/** The editor's global settings the CLI applies, set values only. */
	settings: Partial<GlobalSettings>
}

/** The section for the editor's current settings. */
export function buildVscodeSection(contextProxy: Pick<ContextProxy, "getValue">): VscodeSection {
	const settings: Record<string, unknown> = {}
	for (const key of GLOBAL_SETTINGS_KEYS) {
		const value = contextProxy.getValue(key)
		if (!NOT_MIRRORED.has(key) && value !== undefined) {
			settings[key] = value
		}
	}
	return { settings }
}

/** Replace the `vscode` section of the settings file, keeping every other key; no write when nothing changed. */
export async function writeVscodeSection(settingsPath: string, section: VscodeSection): Promise<void> {
	await withLockedJsonTransaction(settingsPath, settingsPath, async (writeJson) => {
		let existing: Record<string, unknown> = {}
		try {
			existing = JSON.parse(await fs.readFile(settingsPath, "utf-8"))
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error
			}
		}
		if (JSON.stringify(existing.vscode) !== JSON.stringify(section)) {
			// The file may hold an API key: only the user may read it.
			await writeJson({ ...existing, vscode: section }, { prettyPrint: true, mode: 0o600 })
		}
	})
}

/** Settings saved together arrive as many changes: one write after they settle. */
const MIRROR_DELAY_MS = 500

/**
 * Write the section now and after every settings change. A failed write is
 * logged and left for the next change (a malformed file stays as the user
 * wrote it).
 */
export function startCliSettingsMirror(contextProxy: ContextProxy, settingsPath: string): { dispose(): void } {
	const write = () =>
		writeVscodeSection(settingsPath, buildVscodeSection(contextProxy)).catch((error) =>
			logger.error(
				`[cliSettingsMirror] Could not write ${settingsPath}: ${error instanceof Error ? error.message : String(error)}`,
			),
		)
	let timer: NodeJS.Timeout | undefined
	const subscription = contextProxy.onDidChangeValues(() => {
		clearTimeout(timer)
		timer = setTimeout(write, MIRROR_DELAY_MS)
	})
	void write()
	return {
		dispose() {
			clearTimeout(timer)
			subscription.dispose()
		},
	}
}
