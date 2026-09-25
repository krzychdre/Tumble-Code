// The settings the Settings view keeps in its Save buffer: one row per
// setting, saying when the change reaches the extension host and how the
// Save button serializes it (WEB-3).
//
// Adding a setting to the Settings view: add its row here (and its default to
// SETTINGS_DEFAULTS in packages/types when the host has a static one), then
// render its control with `setCachedStateField`. Save picks it up by itself.

import {
	type ExtensionState,
	type GlobalSettings,
	DEFAULT_TERMINAL_OUTPUT_PREVIEW_SIZE,
	PRUNE_CONDENSE_DEFAULTS,
	SETTINGS_DEFAULTS,
} from "@roo-code/types"

/** A setting the extension host stores. */
export type SettingsKey = keyof GlobalSettings

/** A stored setting that is also part of the webview state, so the Save buffer can hold it. */
export type BufferableSettingsKey = SettingsKey & keyof ExtensionState

/**
 * When a change reaches the extension host.
 *
 * - `onSave`: the control writes the Save buffer only; the Save button sends it.
 * - `immediate`: the control also posts it at once (`postImmediateSetting`),
 *   because the change must not wait for Save (a command list the running
 *   task already consults, a per-profile threshold). It stays in the Save
 *   buffer, so Save sends the same value again.
 */
export type ApplyMode = "onSave" | "immediate"

export interface SettingRow<K extends BufferableSettingsKey> {
	apply: ApplyMode
	/** Sent when the buffer holds no value (undefined or null). Without it the value is sent as it is. */
	default?: NonNullable<GlobalSettings[K]>
	/**
	 * Replaces the default handling. Returning undefined leaves the key out of
	 * the message (postMessage drops undefined), so the host keeps its value.
	 */
	serialize?: (value: ExtensionState[K] | undefined) => GlobalSettings[K]
	/** When a new value counts as a change. Default: `Object.is`. */
	equals?: (a: ExtensionState[K] | undefined, b: ExtensionState[K] | undefined) => boolean
}

type SettingsSchema = { [K in BufferableSettingsKey]?: SettingRow<K> }

const onSave = { apply: "onSave" } as const

/** null (never stored for these keys) is sent as undefined, which JSON drops. */
const nullAsUnset = <T>(value: T | null | undefined): T | undefined => value ?? undefined

/**
 * An optional profile id or folder that "" clears: the value is sent as it is,
 * so "" reaches the host and clears it (undefined would be dropped by JSON and
 * the host would keep the old value). A never-set value (undefined) and a
 * cleared one ("") mean the same thing, so switching between them is no change.
 */
const clearableString = {
	apply: "onSave",
	equals: (a: string | undefined, b: string | undefined) => (a || "") === (b || ""),
} as const

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, value), max)

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Every setting the Save button sends, in the order it sends them.
 *
 * Not here, on purpose:
 * - `telemetrySetting`, `debug` and the provider profile (`apiConfiguration`)
 *   are in the Save buffer but go to the host through their own messages.
 * - `mcpEnabled`, `autoApprovalMode`, `showWorktreesInHomeScreen`: their
 *   controls read the live state and post at once; Save must not echo the
 *   buffer's stale copy (see IMMEDIATE_ONLY_SETTINGS).
 * - custom sounds (`selectCustomSound` / `resetCustomSound`), modes and mode
 *   prompts (ModesView) and the enhancement profile: written at once through
 *   their own host messages.
 */
export const SETTINGS_SCHEMA = {
	language: onSave,
	alwaysAllowReadOnly: { apply: "onSave", serialize: nullAsUnset },
	alwaysAllowReadOnlyOutsideWorkspace: { apply: "onSave", serialize: nullAsUnset },
	alwaysAllowWrite: { apply: "onSave", serialize: nullAsUnset },
	alwaysAllowWriteOutsideWorkspace: { apply: "onSave", serialize: nullAsUnset },
	alwaysAllowWriteProtected: { apply: "onSave", serialize: nullAsUnset },
	alwaysAllowExecute: { apply: "onSave", serialize: nullAsUnset },
	alwaysAllowMcp: onSave,
	alwaysAllowModeSwitch: onSave,
	allowedCommands: { apply: "immediate", serialize: (value) => value ?? [] },
	deniedCommands: { apply: "immediate", serialize: (value) => value ?? [] },
	// null, not undefined: JSON drops undefined, and null clears the limit.
	allowedMaxRequests: { apply: "onSave", serialize: (value) => value ?? null },
	allowedMaxCost: { apply: "onSave", serialize: (value) => value ?? null },
	autoCondenseContext: onSave,
	autoCondenseContextPercent: onSave,
	soundEnabled: { apply: "onSave", default: SETTINGS_DEFAULTS.soundEnabled },
	soundVolume: { apply: "onSave", default: SETTINGS_DEFAULTS.soundVolume },
	enableCheckpoints: { apply: "onSave", default: SETTINGS_DEFAULTS.enableCheckpoints },
	checkpointTimeout: { apply: "onSave", default: SETTINGS_DEFAULTS.checkpointTimeout },
	// The memory defaults live in the host's ContextProxy (first-run migration).
	autoMemoryEnabled: { apply: "onSave", default: true },
	autoMemoryDirectory: clearableString,
	autoMemoryShareWithClaudeCode: onSave,
	memoryRecallEnabled: { apply: "onSave", default: true },
	autoDreamEnabled: { apply: "onSave", default: true },
	autoDreamMinHours: { apply: "onSave", default: 24 },
	autoDreamMinSessions: { apply: "onSave", default: 5 },
	memoryWriterApiConfigId: clearableString,
	autoCondenseContextApiConfigId: clearableString,
	webToolsEnabled: { apply: "onSave", default: SETTINGS_DEFAULTS.webToolsEnabled },
	webSearchBackend: { apply: "onSave", default: SETTINGS_DEFAULTS.webSearchBackend },
	// "" rather than undefined, so clearing the field clears it on the host.
	searxngBaseUrl: { apply: "onSave", default: SETTINGS_DEFAULTS.searxngBaseUrl },
	webSearchMaxResults: { apply: "onSave", default: SETTINGS_DEFAULTS.webSearchMaxResults },
	webFetchMaxBytes: { apply: "onSave", default: SETTINGS_DEFAULTS.webFetchMaxBytes },
	pruneBeforeCondense: { apply: "onSave", default: true },
	pruneToolResultBudget: { apply: "onSave", default: PRUNE_CONDENSE_DEFAULTS.DEFAULT_TOOL_RESULT_BUDGET },
	writeDelayMs: onSave,
	terminalShellIntegrationTimeout: {
		apply: "onSave",
		default: SETTINGS_DEFAULTS.terminalShellIntegrationTimeout,
	},
	terminalShellIntegrationDisabled: onSave,
	terminalCommandDelay: onSave,
	terminalPowershellCounter: onSave,
	terminalZshClearEolMark: onSave,
	terminalZshOhMy: onSave,
	terminalZshP10k: onSave,
	terminalZdotdir: onSave,
	// "" clears a saved profile; undefined would be dropped by JSON.
	terminalProfile: { apply: "onSave", default: "" },
	terminalOutputPreviewSize: { apply: "onSave", default: DEFAULT_TERMINAL_OUTPUT_PREVIEW_SIZE },
	maxOpenTabsContext: {
		apply: "onSave",
		serialize: (value) => clamp(value ?? SETTINGS_DEFAULTS.maxOpenTabsContext, 0, 500),
	},
	maxWorkspaceFiles: {
		apply: "onSave",
		serialize: (value) => clamp(value ?? SETTINGS_DEFAULTS.maxWorkspaceFiles, 0, 500),
	},
	showRooIgnoredFiles: { apply: "onSave", default: SETTINGS_DEFAULTS.showRooIgnoredFiles },
	enableSubfolderRules: { apply: "onSave", default: SETTINGS_DEFAULTS.enableSubfolderRules },
	maxImageFileSize: { apply: "onSave", default: SETTINGS_DEFAULTS.maxImageFileSize },
	maxTotalImageSize: { apply: "onSave", default: SETTINGS_DEFAULTS.maxTotalImageSize },
	includeDiagnosticMessages: { apply: "onSave", default: SETTINGS_DEFAULTS.includeDiagnosticMessages },
	maxDiagnosticMessages: { apply: "onSave", default: SETTINGS_DEFAULTS.maxDiagnosticMessages },
	alwaysAllowSubtasks: onSave,
	alwaysApprovePlan: onSave,
	alwaysAllowFollowupQuestions: { apply: "onSave", default: SETTINGS_DEFAULTS.alwaysAllowFollowupQuestions },
	followupAutoApproveTimeoutMs: onSave,
	includeTaskHistoryInEnhance: { apply: "immediate", default: SETTINGS_DEFAULTS.includeTaskHistoryInEnhance },
	reasoningBlockCollapsed: { apply: "onSave", default: SETTINGS_DEFAULTS.reasoningBlockCollapsed },
	enterBehavior: { apply: "onSave", default: SETTINGS_DEFAULTS.enterBehavior },
	includeCurrentTime: { apply: "onSave", default: SETTINGS_DEFAULTS.includeCurrentTime },
	includeCurrentCost: { apply: "onSave", default: SETTINGS_DEFAULTS.includeCurrentCost },
	maxGitStatusFiles: { apply: "onSave", default: SETTINGS_DEFAULTS.maxGitStatusFiles },
	parallelTasksMaxConcurrency: onSave,
	subagentFollowupTimeoutSec: onSave,
	profileThresholds: { apply: "immediate" },
	imageGenerationProvider: onSave,
	openRouterImageApiKey: onSave,
	openRouterImageGenerationSelectedModel: onSave,
	experiments: onSave,
	customSupportPrompts: { apply: "onSave", equals: sameJson },
} as const satisfies SettingsSchema

/** A setting the Save button sends. */
export type SavedSettingsKey = keyof typeof SETTINGS_SCHEMA

export const SAVED_SETTINGS_KEYS = Object.freeze(Object.keys(SETTINGS_SCHEMA) as SavedSettingsKey[])

/**
 * Settings whose control posts them at once and reads the live state, never
 * the Save buffer; Save does not send them.
 */
export const IMMEDIATE_ONLY_SETTINGS = [
	"autoApprovalMode",
	"mcpEnabled",
	"showWorktreesInHomeScreen",
] as const satisfies readonly SettingsKey[]

/** The settings a control may post at once with `postImmediateSetting`. */
export type ImmediateSettingsKey =
	| {
			[K in SavedSettingsKey]: (typeof SETTINGS_SCHEMA)[K]["apply"] extends "immediate" ? K : never
	  }[SavedSettingsKey]
	| (typeof IMMEDIATE_ONLY_SETTINGS)[number]

/** The keys the Save buffer holds: the saved settings plus those sent by their own messages. */
export const BUFFERED_KEYS = Object.freeze([
	...SAVED_SETTINGS_KEYS,
	"telemetrySetting",
	"debug",
	"apiConfiguration",
] as const satisfies readonly (keyof ExtensionState)[])

export type BufferedKey = (typeof BUFFERED_KEYS)[number]

/**
 * The Save buffer: the part of the webview state the Settings view edits.
 * Typed like the state it is copied from; like that state before the first
 * host push, it can lack keys at runtime (hence the Save fallbacks).
 */
export type CachedSettings = Pick<ExtensionState, BufferedKey>

/**
 * Copies the buffered keys the state has (an absent key stays absent, so a
 * merge keeps the buffer's value for it). Chat messages, task history and the
 * context setters never enter the buffer.
 */
export const pickCachedSettings = (state: Partial<ExtensionState>): CachedSettings => {
	const picked: Record<string, unknown> = {}
	for (const key of BUFFERED_KEYS) {
		if (key in state) {
			picked[key] = state[key]
		}
	}
	return picked as CachedSettings
}

/** Whether `next` is a change of `key` compared with `previous`. */
export const isSettingChange = <K extends BufferedKey>(
	key: K,
	previous: CachedSettings[K],
	next: CachedSettings[K],
): boolean => {
	const row = (SETTINGS_SCHEMA as Partial<Record<BufferedKey, SettingRow<BufferableSettingsKey>>>)[key]
	const equals = row?.equals as ((a: unknown, b: unknown) => boolean) | undefined
	return !(equals ? equals(previous, next) : Object.is(previous, next))
}

/** The `updatedSettings` payload of the Save button, built from the Save buffer. */
export const buildUpdatedSettings = (cached: CachedSettings): Partial<GlobalSettings> => {
	const updated: Record<string, unknown> = {}
	for (const key of SAVED_SETTINGS_KEYS) {
		const row = SETTINGS_SCHEMA[key] as SettingRow<BufferableSettingsKey>
		const value = cached[key]
		if (row.serialize) {
			updated[key] = (row.serialize as (value: unknown) => unknown)(value)
		} else if (row.default !== undefined) {
			updated[key] = value ?? row.default
		} else {
			updated[key] = value
		}
	}
	return updated as Partial<GlobalSettings>
}
