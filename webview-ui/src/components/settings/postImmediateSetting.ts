import type { GlobalSettings } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

import type { ImmediateSettingsKey } from "./schema"

/**
 * Writes one setting to the extension host at once, outside the Save button.
 * Only the settings the schema marks as immediate are accepted, so a control
 * cannot bypass the Save buffer by accident.
 */
export function postImmediateSetting<K extends ImmediateSettingsKey>(key: K, value: GlobalSettings[K]): void {
	vscode.postMessage({ type: "updateSettings", updatedSettings: { [key]: value } as Partial<GlobalSettings> })
}
